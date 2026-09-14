import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { msmeService } from "./msme.service";

/**
 * /api/msme (P1-07): the section 15 clock on micro and small suppliers, the 43B(h) report and
 * MSME Form 1. Everything is derived from the bills and the supplier master, so there is nothing
 * to create here — only to look at, and to register the half-yearly return on the filing gate.
 */
const router = Router();
router.use(authMiddleware);

router.get(
  "/bills",
  requirePermission("payable.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        asOn: z.coerce.date().optional(),
        supplierId: z.coerce.number().int().optional(),
        openOnly: z
          .string()
          .optional()
          .transform((v) => v === "true"),
        overdueOnly: z
          .string()
          .optional()
          .transform((v) => v === "true"),
      })
      .parse(req.query);
    res.json(new ApiResponse("MSME bills", await msmeService.bills(q)));
  })
);

router.get(
  "/payment-warning",
  requirePermission("payable.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ supplierId: z.coerce.number().int().optional() }).parse(req.query);
    res.json(
      new ApiResponse("MSME payment warning", await msmeService.paymentWarning(q.supplierId))
    );
  })
);

router.get(
  "/disallowance/:fyCode",
  requirePermission("payable.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const fyCode = z
      .string()
      .regex(/^\d{4}-\d{2}$/, "A financial year looks like 2026-27")
      .parse(req.params.fyCode);
    res.json(new ApiResponse("Section 43B(h)", await msmeService.disallowance(fyCode)));
  })
);

router.get(
  "/form1/:periodKey",
  requirePermission("payable.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const periodKey = z
      .string()
      .regex(/^\d{4}-H[12]$/, "A half-year looks like 2026-H1")
      .parse(req.params.periodKey);
    res.json(new ApiResponse("MSME Form 1", await msmeService.form1(periodKey)));
  })
);

router.post(
  "/form1/:periodKey/register",
  requirePermission("filings.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const periodKey = z
      .string()
      .regex(/^\d{4}-H[12]$/)
      .parse(req.params.periodKey);
    res.json(
      new ApiResponse(
        "MSME Form 1 registered for approval",
        await msmeService.registerForm1(periodKey, { userId: req.user?.userId })
      )
    );
  })
);

export default router;
