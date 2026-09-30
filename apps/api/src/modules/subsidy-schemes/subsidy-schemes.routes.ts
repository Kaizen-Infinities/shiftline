import { Router, type Request, type Response } from "express";
import type { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { asDate } from "./subsidy.calc";
import { subsidySchemesService as svc } from "./subsidy-schemes.service";
import {
  asOfQuery,
  claimIdParam,
  claimStatusBody,
  createClaimBody,
  createSchemeBody,
  entitlementQuery,
  idParam,
  listQuery,
  schemeStatusBody,
  updateClaimBody,
  updateSchemeBody,
} from "./subsidy-schemes.validation";

/**
 * /api/subsidy-schemes (TN-10): subsidy and incentive schemes, the claims filed under them, the
 * reminders (LTPT months not claimed, claims unpaid past 90 days) and the summary. A scheme with
 * claims is never deleted: it is closed.
 */
const router = Router();
router.use(authMiddleware, requireFeature("accounts"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });

/** Parse with the first problem as the message, so the screen can show it as it is. */
const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> => {
  const r = schema.safeParse(data);
  if (!r.success) {
    const errors = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ApiError(400, errors[0]?.message ?? "Validation failed", "VALIDATION", { errors });
  }
  return r.data;
};
const asOfOf = (req: Request) => {
  const q = parse(asOfQuery, req.query);
  return q.asOf ? asDate(q.asOf) : undefined;
};

router.get(
  "/summary",
  requirePermission("subsidy-schemes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Subsidy summary", await svc.summary(asOfOf(req))));
  })
);

router.get(
  "/reminders",
  requirePermission("subsidy-schemes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Subsidy reminders", await svc.reminders(asOfOf(req))));
  })
);

router.get(
  "/export.csv",
  requirePermission("subsidy-schemes.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const csv = await svc.exportCsv(asOfOf(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="subsidy-schemes.csv"');
    res.send(csv);
  })
);

router.get(
  "/",
  requirePermission("subsidy-schemes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = parse(listQuery, req.query);
    res.json(new ApiResponse("Subsidy schemes", await svc.list(q)));
  })
);

router.post(
  "/",
  requirePermission("subsidy-schemes.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = parse(createSchemeBody, req.body);
    res.status(201).json(new ApiResponse("Scheme added", await svc.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("subsidy-schemes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    res.json(new ApiResponse("Subsidy scheme", await svc.get(id, asOfOf(req))));
  })
);

router.patch(
  "/:id",
  requirePermission("subsidy-schemes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    const body = parse(updateSchemeBody, req.body);
    res.json(new ApiResponse("Scheme saved", await svc.update(id, body)));
  })
);

router.delete(
  "/:id",
  requirePermission("subsidy-schemes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    res.json(new ApiResponse("Scheme deleted", await svc.remove(id)));
  })
);

router.patch(
  "/:id/status",
  requirePermission("subsidy-schemes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    const body = parse(schemeStatusBody, req.body);
    res.json(new ApiResponse("Scheme updated", await svc.updateStatus(id, body)));
  })
);

router.get(
  "/:id/entitlement",
  requirePermission("subsidy-schemes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    const q = parse(entitlementQuery, req.query);
    res.json(new ApiResponse("Suggested claim", await svc.entitlement(id, q.from, q.to)));
  })
);

router.post(
  "/:id/claims",
  requirePermission("subsidy-schemes.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    const body = parse(createClaimBody, req.body);
    res
      .status(201)
      .json(new ApiResponse("Claim saved as draft", await svc.createClaim(id, body, actorOf(req))));
  })
);

router.patch(
  "/:id/claims/:claimId",
  requirePermission("subsidy-schemes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    const claimId = parse(claimIdParam, req.params.claimId);
    const body = parse(updateClaimBody, req.body);
    res.json(new ApiResponse("Claim saved", await svc.updateClaim(id, claimId, body)));
  })
);

router.patch(
  "/:id/claims/:claimId/status",
  requirePermission("subsidy-schemes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parse(idParam, req.params.id);
    const claimId = parse(claimIdParam, req.params.claimId);
    const body = parse(claimStatusBody, req.body);
    res.json(new ApiResponse("Claim updated", await svc.updateClaimStatus(id, claimId, body)));
  })
);

export default router;
