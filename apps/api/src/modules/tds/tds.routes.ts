import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { buildTdsReturn, tdsFiling, toEtdsText } from "./tds.returns";
import { tdsService } from "./tds.service";

/** /api/tds (P1-15): sections, deductions, challans, 26Q/27Q and Form 16A. */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const DEDUCTEE_TYPES = [
  "COMPANY",
  "INDIVIDUAL_HUF",
  "FIRM",
  "AOP_BOI",
  "LOCAL_AUTHORITY",
  "NON_RESIDENT",
] as const;
const fyQuarter = z.object({
  fyCode: z.string().regex(/^\d{4}-\d{2}$/, "Financial year looks like 2026-27"),
  quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]),
});

// ── Sections ──────────────────────────────────────────────────────────────────
router.get(
  "/sections",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("TDS sections", await tdsService.sections(req.query.all === "true")));
  })
);

router.post(
  "/sections",
  requirePermission("tds.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().min(1).max(20),
        actCode: z.string().max(40).optional().nullable(),
        name: z.string().min(1).max(160),
        isTcs: z.boolean().optional(),
        rateCompany: z.coerce.number().min(0).max(100),
        rateIndividual: z.coerce.number().min(0).max(100),
        rateNoPan: z.coerce.number().min(0).max(100).optional(),
        thresholdSingle: z.coerce.number().min(0).optional(),
        thresholdAnnual: z.coerce.number().min(0).optional(),
        ledgerCode: z.string().max(20).optional().nullable(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Section saved", await tdsService.upsertSection(body)));
  })
);

/** What would be deducted, without deducting it: the screen shows this before saving a bill. */
router.post(
  "/preview",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        sectionCode: z.string().min(1),
        supplierId: z.coerce.number().int().optional().nullable(),
        deducteePan: z.string().max(10).optional().nullable(),
        deducteeType: z.enum(DEDUCTEE_TYPES).optional(),
        higherRate: z.boolean().optional(),
        amount: z.coerce.number().min(0),
        on: z.coerce.date().optional(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Rate", await tdsService.rateFor({ ...body, on: body.on ?? new Date() }))
    );
  })
);

// ── Deductions ────────────────────────────────────────────────────────────────
router.get(
  "/deductions",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        fyCode: z.string().optional(),
        quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
        status: z.enum(["PENDING", "CHALLAN_PAID", "RETURN_FILED", "CANCELLED"]).optional(),
        sectionCode: z.string().optional(),
        supplierId: z.coerce.number().int().optional(),
        unchallanedOnly: z
          .string()
          .optional()
          .transform((v) => v === "true"),
      })
      .parse(req.query);
    res.json(new ApiResponse("Deductions", await tdsService.list(q)));
  })
);

router.post(
  "/deductions",
  requirePermission("tds.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        sectionCode: z.string().min(1),
        supplierId: z.coerce.number().int().optional().nullable(),
        deducteeName: z.string().max(160).optional(),
        deducteePan: z.string().max(10).optional().nullable(),
        deducteeType: z.enum(DEDUCTEE_TYPES).optional(),
        kind: z.enum(["ON_BILL", "ON_PAYMENT", "ON_COLLECTION"]).optional(),
        docType: z.string().min(1).max(16),
        docId: z.string().min(1).max(40),
        docNo: z.string().min(1).max(40),
        deductionDate: z.string().min(1),
        amount: z.coerce.number().min(0),
        rateOverride: z.coerce.number().min(0).max(100).optional().nullable(),
        rateReason: z.string().max(160).optional().nullable(),
      })
      .parse(req.body);
    res.status(201).json(new ApiResponse("Deducted", await tdsService.deduct(body, actorOf(req))));
  })
);

router.post(
  "/deductions/:id/cancel",
  requirePermission("tds.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ reason: z.string().min(1).max(255) }).parse(req.body);
    res.json(new ApiResponse("Cancelled", await tdsService.cancel(id, body.reason, actorOf(req))));
  })
);

// ── Challans ──────────────────────────────────────────────────────────────────
router.get(
  "/challans",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        fyCode: z.string().optional(),
        quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Challans", await tdsService.challans(q)));
  })
);

router.post(
  "/challans",
  requirePermission("tds.pay"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        bsrCode: z.string().length(7),
        challanSerial: z.string().min(1).max(10),
        challanDate: z.string().min(1),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        deductionIds: z.array(z.string().uuid()).min(1),
        surcharge: z.coerce.number().min(0).optional(),
        educationCess: z.coerce.number().min(0).optional(),
        interest: z.coerce.number().min(0).optional(),
        lateFee: z.coerce.number().min(0).optional(),
        paymentCode: z.string().max(3).optional(),
        remarks: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Challan recorded", await tdsService.payChallan(body, actorOf(req))));
  })
);

// ── Returns and certificates ──────────────────────────────────────────────────
router.get(
  "/returns/:form",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const form = z.enum(["26Q", "27Q"]).parse(req.params.form);
    const q = fyQuarter.parse(req.query);
    res.json(new ApiResponse(`Form ${form}`, await buildTdsReturn(form, q.fyCode, q.quarter)));
  })
);

router.get(
  "/returns/:form/file",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const form = z.enum(["26Q", "27Q"]).parse(req.params.form);
    const q = fyQuarter.parse(req.query);
    const ret = await buildTdsReturn(form, q.fyCode, q.quarter);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${form}_${q.fyCode}_${q.quarter}.txt"`
    );
    res.send(toEtdsText(ret));
  })
);

router.post(
  "/returns/:form/register",
  requirePermission("tds.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const form = z.enum(["26Q", "27Q"]).parse(req.params.form);
    const b = fyQuarter.parse(req.body);
    res.json(
      new ApiResponse(
        `Form ${form} registered for approval`,
        await tdsFiling.register(form, b.fyCode, b.quarter, actorOf(req))
      )
    );
  })
);

router.post(
  "/returns/:form/filed",
  requirePermission("tds.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const form = z.enum(["26Q", "27Q"]).parse(req.params.form);
    const b = fyQuarter
      .extend({ submissionRef: z.string().max(120).optional().nullable() })
      .parse(req.body);
    res.json(
      new ApiResponse(
        `Form ${form} marked filed`,
        await tdsFiling.markFiled(form, b.fyCode, b.quarter, b.submissionRef ?? null, actorOf(req))
      )
    );
  })
);

router.get(
  "/form16a/:supplierId",
  requirePermission("tds.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const supplierId = z.coerce.number().int().parse(req.params.supplierId);
    const q = z
      .object({
        fyCode: z.string().regex(/^\d{4}-\d{2}$/),
        quarter: z.enum(["Q1", "Q2", "Q3", "Q4"]).optional(),
      })
      .parse(req.query);
    res.json(
      new ApiResponse("Form 16A", await tdsService.form16A(supplierId, q.fyCode, q.quarter))
    );
  })
);

export default router;
