import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { finesService } from "./fines.service";
import {
  cancelFineSchema,
  createFineSchema,
  listFinesQuery,
  showCauseSchema,
} from "./fines.validation";

/**
 * /api/fines (P2-13): fines (Payment of Wages Act s.8) and deductions for damage/loss (s.10) —
 * create, record the employee's show-cause, approve and cancel. Recovery against a payroll run
 * happens in `modules/payroll/payroll.service.ts`; the registers at `/api/registers/fines` and
 * `/api/registers/deductions` report only what has been approved here.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idParam = (req: Request) => z.string().uuid().parse(req.params.id);

router.get(
  "/",
  requirePermission("fines.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listFinesQuery.parse(req.query);
    res.json(new ApiResponse("Fines and deductions", await finesService.list(q)));
  })
);

router.get(
  "/:id",
  requirePermission("fines.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Fine or deduction", await finesService.get(idParam(req))));
  })
);

router.post(
  "/",
  requirePermission("fines.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createFineSchema.parse(req.body);
    const row = await finesService.create(body);
    res.status(201).json(new ApiResponse("Fine or deduction recorded", row));
  })
);

router.post(
  "/:id/show-cause",
  requirePermission("fines.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = showCauseSchema.parse(req.body);
    const row = await finesService.showCause(idParam(req), body);
    res.json(new ApiResponse("Show-cause recorded", row));
  })
);

router.post(
  "/:id/approve",
  requirePermission("fines.approve"),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await finesService.approve(idParam(req), actorOf(req));
    res.json(new ApiResponse("Fine or deduction approved", row));
  })
);

router.post(
  "/:id/cancel",
  requirePermission("fines.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = cancelFineSchema.parse(req.body);
    const row = await finesService.cancel(idParam(req), body.reason, actorOf(req));
    res.json(new ApiResponse("Fine or deduction cancelled", row));
  })
);

export default router;
