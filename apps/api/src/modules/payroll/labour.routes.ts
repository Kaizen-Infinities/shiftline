import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { labourService } from "./labour.service";

/**
 * /api/labour (P1-17b): the holiday calendar, leave, gratuity, bonus and settlements — what the
 * company owes rather than what it deducts.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idParam = z.string().uuid();
const fyCode = z.string().regex(/^\d{4}-\d{2}$/, "A financial year looks like 2026-27");

// ── Holidays ──────────────────────────────────────────────────────────────────
router.get(
  "/holidays",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ fyCode: z.string().optional() }).parse(req.query);
    res.json(new ApiResponse("Holidays", await labourService.holidays(q.fyCode)));
  })
);

router.post(
  "/holidays",
  requirePermission("payroll-settings.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        holidayOn: z.string().min(1),
        name: z.string().min(1).max(120),
        kind: z.enum(["NATIONAL", "FESTIVAL", "COMPANY"]).optional(),
        stateCode: z.string().length(2).optional().nullable(),
        isPaid: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json(new ApiResponse("Holiday saved", await labourService.addHoliday(body)));
  })
);

// ── Leave ─────────────────────────────────────────────────────────────────────
router.get(
  "/leave-types",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Leave types", await labourService.leaveTypes(req.query.all === "true"))
    );
  })
);

router.post(
  "/leave-types",
  requirePermission("payroll-settings.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(80),
        daysPerYear: z.coerce.number().min(0).max(365),
        basis: z.enum(["ANNUAL", "MONTHLY", "DAYS_WORKED"]).optional(),
        daysWorkedPerDay: z.coerce.number().int().min(1).max(365).optional(),
        isPaid: z.boolean().optional(),
        carryForwardMax: z.coerce.number().min(0).max(365).optional(),
        encashable: z.boolean().optional(),
        // Leave without pay allowed (P2-09/P2-15): a request against this type may take the
        // balance negative instead of being refused for insufficient leave.
        allowNegative: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Leave type saved", await labourService.upsertLeaveType(body)));
  })
);

router.get(
  "/leave-balances/:fyCode",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ employeeId: z.string().optional() }).parse(req.query);
    res.json(
      new ApiResponse(
        "Leave balances",
        await labourService.balances(fyCode.parse(req.params.fyCode), q.employeeId)
      )
    );
  })
);

router.post(
  "/leave-balances/accrue",
  requirePermission("payroll.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        employeeId: z.string().min(1),
        fyCode: z.string().regex(/^\d{4}-\d{2}$/),
        monthsWorked: z.coerce.number().min(0).max(12).optional(),
        daysWorked: z.coerce.number().min(0).max(400).optional(),
        opening: z.coerce.number().min(0).optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Accrued", await labourService.accrue(body, actorOf(req))));
  })
);

router.post(
  "/leave-balances/take",
  requirePermission("payroll.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        employeeId: z.string().min(1),
        leaveTypeCode: z.string().min(1).max(20),
        fyCode: z.string().regex(/^\d{4}-\d{2}$/),
        days: z.coerce.number().positive().max(365),
      })
      .parse(req.body);
    res.json(new ApiResponse("Recorded", await labourService.takeLeave(body)));
  })
);

router.post(
  "/leave-balances/:fyCode/close",
  requirePermission("payroll-settings.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Year closed",
        await labourService.closeLeaveYear(fyCode.parse(req.params.fyCode))
      )
    );
  })
);

// ── Gratuity and bonus ────────────────────────────────────────────────────────
router.get(
  "/gratuity",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ asOn: z.coerce.date().optional() }).parse(req.query);
    res.json(
      new ApiResponse(
        "Gratuity liability",
        await labourService.gratuityLiability(q.asOn ?? new Date())
      )
    );
  })
);

router.get(
  "/bonus/:fyCode",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        percent: z.coerce.number().min(0).max(20).optional(),
        minimumWage: z.coerce.number().min(0).optional(),
      })
      .parse(req.query);
    res.json(
      new ApiResponse(
        "Statutory bonus",
        await labourService.bonusForYear(fyCode.parse(req.params.fyCode), q.percent, q.minimumWage)
      )
    );
  })
);

// ── Settlements ───────────────────────────────────────────────────────────────
const settlementBody = z.object({
  employeeId: z.string().min(1),
  separationOn: z.string().min(1),
  lastWorkingDay: z.string().optional(),
  noticeDaysRequired: z.coerce.number().int().min(0).max(365).optional(),
  noticeDaysServed: z.coerce.number().int().min(0).max(365).optional(),
  salaryDue: z.coerce.number().min(0).optional(),
  otherDues: z.coerce.number().min(0).optional(),
  advanceRecovery: z.coerce.number().min(0).optional(),
  otherRecovery: z.coerce.number().min(0).optional(),
  bonus: z.coerce.number().min(0).optional(),
  fyCode: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  reason: z.string().max(160).optional().nullable(),
});

router.post(
  "/settlements/preview",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Settlement",
        await labourService.previewSettlement(settlementBody.parse(req.body))
      )
    );
  })
);

router.get(
  "/settlements",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({ status: z.enum(["DRAFT", "APPROVED", "PAID", "CANCELLED"]).optional() })
      .parse(req.query);
    res.json(new ApiResponse("Settlements", await labourService.settlements(q.status)));
  })
);

router.post(
  "/settlements",
  requirePermission("payroll.create"),
  asyncHandler(async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        new ApiResponse(
          "Settlement prepared",
          await labourService.createSettlement(settlementBody.parse(req.body), actorOf(req))
        )
      );
  })
);

router.post(
  "/settlements/:id/approve",
  requirePermission("payroll-run.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Approved and posted",
        await labourService.approveSettlement(idParam.parse(req.params.id), actorOf(req))
      )
    );
  })
);

export default router;
