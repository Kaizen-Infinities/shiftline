import type { Request, Response } from "express";

import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { auditTrailService } from "./audit-trail.service";
import { auditTrailQuerySchema } from "./audit-trail.types";

const parseQuery = (req: Request) => {
  const parsed = auditTrailQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid query");
  }
  return parsed.data;
};

export const auditTrailController = {
  list: async (req: Request, res: Response) => {
    res.json(new ApiResponse("Audit trail", await auditTrailService.list(parseQuery(req))));
  },

  filters: async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Audit trail filters", await auditTrailService.filters()));
  },

  exportCsv: async (req: Request, res: Response) => {
    const { csv, rows, truncated } = await auditTrailService.exportCsv(parseQuery(req));
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-trail-${stamp}.csv"`);
    res.setHeader("X-Row-Count", String(rows));
    if (truncated) res.setHeader("X-Truncated", "true");
    res.send(csv);
  },
};
