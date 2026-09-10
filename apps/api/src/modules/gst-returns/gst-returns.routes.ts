import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { assertMonth, gstr1Service } from "./gstr1.service";

/** /api/gst-returns (P1-13): returns computed from the books, per GSTIN and period. */
const router = Router();
router.use(authMiddleware);
const periodQuery = z.object({
  period: z.string().transform(assertMonth),
  gstin: z.string().trim().toUpperCase().length(15).optional(),
});
const fileBody = periodQuery.extend({
  submissionRef: z.string().trim().max(120).optional().nullable(),
});
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get(
  "/gstins",
  requirePermission("gst-returns.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    const scopes = await gstr1Service.scopes();
    res.json(
      new ApiResponse(
        "Registrations",
        scopes.map((s) => ({
          gstin: s.gstin,
          name: s.name,
          stateCode: s.stateCode,
          businessPlaceId: s.filingPlaceId === null ? null : String(s.filingPlaceId),
        }))
      )
    );
  })
);
router.get(
  "/gstr1",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    res.json(new ApiResponse("GSTR-1", await gstr1Service.build(q.period, q.gstin)));
  })
);
router.get(
  "/gstr1/json",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    const ret = await gstr1Service.build(q.period, q.gstin);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="GSTR1_${ret.gstin}_${ret.fp}.json"`
    );
    res.json(ret.json);
  })
);
router.post(
  "/gstr1/register",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-1 registered for approval",
        await gstr1Service.register(q.period, q.gstin, actorOf(req))
      )
    );
  })
);
router.post(
  "/gstr1/filed",
  requirePermission("gst-returns.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const b = fileBody.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-1 marked filed",
        await gstr1Service.markFiled(b.period, b.gstin, b.submissionRef ?? null, actorOf(req))
      )
    );
  })
);

export default router;
