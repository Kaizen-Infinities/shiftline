import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { OVERHEAD_BASES, costingService } from "./costing.service";
import { valuationService } from "./valuation.service";
import { wipService } from "./wip.service";

/**
 * /api/costing (P1-19): the valuation ledger, cost centres, budgets and the cost sheet.
 * Reads are GETs; anything that moves the valuation or the books is a POST.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const periodKey = z.string().regex(/^\d{4}-\d{2}$/, "A period looks like 2026-08");
const fyCode = z.string().regex(/^\d{4}-\d{2}$/, "A financial year looks like 2026-27");

// ── Valuation ─────────────────────────────────────────────────────────────────
router.get(
  "/valuation/ledger",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        itemType: z.enum(["RAW_MATERIAL", "PRODUCT"]).optional(),
        itemId: z.string().max(40).optional(),
        storeId: z.string().max(20).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Valuation ledger", await valuationService.ledger(q)));
  })
);

router.get(
  "/valuation/closing-stock",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ asOn: z.coerce.date().optional() }).parse(req.query);
    res.json(
      new ApiResponse("Closing stock", await valuationService.closingStock(q.asOn ?? new Date()))
    );
  })
);

router.post(
  "/valuation/movements",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        itemType: z.enum(["RAW_MATERIAL", "PRODUCT"]),
        itemId: z.string().min(1).max(40),
        storeId: z.string().max(20).optional().nullable(),
        movedOn: z.string().min(1),
        kind: z.enum([
          "OPENING",
          "RECEIPT",
          "ISSUE",
          "PRODUCTION_IN",
          "SCRAP",
          "ADJUSTMENT",
          "RETURN_IN",
          "RETURN_OUT",
        ]),
        quantity: z.coerce.number().positive(),
        rate: z.coerce.number().min(0).optional(),
        refDocType: z.string().max(30).optional().nullable(),
        refDocId: z.string().max(40).optional().nullable(),
        narration: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Recorded", await valuationService.record(body, actorOf(req))));
  })
);

router.post(
  "/valuation/backfill",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Backfill complete", await valuationService.backfill(actorOf(req))));
  })
);

// ── Work in progress ────────────────────────────────────────────────────────────
router.get(
  "/wip",
  requirePermission("costing.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Work in progress", await wipService.total()));
  })
);

router.get(
  "/wip/:productionOrderId",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Work in progress",
        await wipService.wipFor(String(req.params.productionOrderId))
      )
    );
  })
);

router.get(
  "/valuation/:periodKey/closing-stock-status",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Closing stock status",
        await costingService.closingStockStatus(periodKey.parse(req.params.periodKey))
      )
    );
  })
);

router.post(
  "/valuation/:periodKey/post-closing-stock",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Closing stock posted",
        await costingService.postClosingStock(periodKey.parse(req.params.periodKey), actorOf(req))
      )
    );
  })
);

// ── Settings (P2-14) ────────────────────────────────────────────────────────────
router.get(
  "/settings",
  requirePermission("costing.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Costing settings", await costingService.getSettings()));
  })
);

router.put(
  "/settings",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ wipLedgerCode: z.string().min(1).max(20) }).parse(req.body);
    res.json(
      new ApiResponse(
        "Costing settings saved",
        await costingService.updateSettings(body, actorOf(req))
      )
    );
  })
);

// ── Cost centres ──────────────────────────────────────────────────────────────
router.get(
  "/cost-centres",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Cost centres", await costingService.costCentres(req.query.all === "true"))
    );
  })
);

router.post(
  "/cost-centres",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(120),
        kind: z.enum(["PRODUCTION", "SERVICE", "ADMIN", "SALES"]).optional(),
        parentId: z.string().uuid().optional().nullable(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Cost centre saved", await costingService.upsertCostCentre(body)));
  })
);

router.post(
  "/cost-centres/tag",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        journalItemIds: z.array(z.coerce.number().int()).min(1),
        costCentreId: z.string().uuid().nullable(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Tagged", await costingService.tagLines(body)));
  })
);

router.get(
  "/cost-centres/profit-loss",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date() }).parse(req.query);
    res.json(
      new ApiResponse(
        "Cost centre profit and loss",
        await costingService.costCentreProfitAndLoss(q.from, q.to)
      )
    );
  })
);

// ── Budgets ───────────────────────────────────────────────────────────────────
router.get(
  "/budgets/:fyCode",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Budgets", await costingService.budgets(fyCode.parse(req.params.fyCode)))
    );
  })
);

router.post(
  "/budgets",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        fyCode: z.string().regex(/^\d{4}-\d{2}$/),
        periodKey: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional()
          .nullable(),
        ledgerId: z.coerce.number().int(),
        costCentreId: z.string().uuid().optional().nullable(),
        amount: z.coerce.number(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Budget saved", await costingService.setBudget(body, actorOf(req))));
  })
);

router.get(
  "/budgets/:fyCode/variance",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        periodKey: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .parse(req.query);
    res.json(
      new ApiResponse(
        "Budget variance",
        await costingService.variance(fyCode.parse(req.params.fyCode), q.periodKey ?? null)
      )
    );
  })
);

// ── Cost sheets ───────────────────────────────────────────────────────────────
router.get(
  "/cost-sheets",
  requirePermission("costing.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        periodKey: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Cost sheets", await costingService.costSheets(q.periodKey)));
  })
);

router.post(
  "/cost-sheets",
  requirePermission("costing.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        productId: z.string().min(1),
        periodKey: z.string().regex(/^\d{4}-\d{2}$/),
        quantityProduced: z.coerce.number().positive(),
        labourCost: z.coerce.number().min(0).optional(),
        overheadCost: z.coerce.number().min(0).optional(),
        overheadBasis: z.enum(OVERHEAD_BASES).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Cost sheet built", await costingService.buildCostSheet(body, actorOf(req)))
      );
  })
);

export default router;
