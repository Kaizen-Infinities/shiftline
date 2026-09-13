import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { registersService } from "./registers.service";

/** /api/statutory-registers (P2T-03): the muster roll, the wages, overtime, fines, deductions
 * and advances registers an inspector can ask a factory to produce. Read-only — every register
 * is derived from attendance and payroll data that already exists. */
const router = Router();
router.use(authMiddleware);
router.use(requirePermission("statutory-registers.view"));

const period = z.string().regex(/^\d{4}-\d{2}$/, "A period looks like 2026-08");
const runId = z.coerce.number().int().positive();
const dateRangeQuery = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

router.get(
  "/muster-roll",
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ period }).parse(req.query);
    res.json(new ApiResponse("Muster roll", await registersService.musterRoll(q.period)));
  })
);

router.get(
  "/wages",
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ runId }).parse(req.query);
    res.json(new ApiResponse("Wages register", await registersService.wages(q.runId)));
  })
);

router.get(
  "/overtime",
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ runId }).parse(req.query);
    res.json(new ApiResponse("Overtime register", await registersService.overtime(q.runId)));
  })
);

router.get(
  "/deductions",
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ runId }).parse(req.query);
    res.json(new ApiResponse("Deductions register", await registersService.deductions(q.runId)));
  })
);

router.get(
  "/fines",
  asyncHandler(async (req: Request, res: Response) => {
    const q = dateRangeQuery.parse(req.query);
    res.json(new ApiResponse("Fines register", await registersService.fines(q.from, q.to)));
  })
);

router.get(
  "/advances",
  asyncHandler(async (req: Request, res: Response) => {
    const q = dateRangeQuery.parse(req.query);
    res.json(new ApiResponse("Advances register", await registersService.advances(q.from, q.to)));
  })
);

export default router;
