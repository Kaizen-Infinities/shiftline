import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { assetService } from "./asset.service";

/**
 * /api/assets (P1-18): the register, the monthly depreciation run and the two year-end reports.
 * Preparing a month writes the charge rows; posting it is a separate act, because that is when
 * the books move.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idParam = z.string().uuid();
const fyCode = z.string().regex(/^\d{4}-\d{2}$/, "A financial year looks like 2026-27");
const periodKey = z.string().regex(/^\d{4}-\d{2}$/, "A month looks like 2026-08");

// ── Classes ───────────────────────────────────────────────────────────────────
router.get(
  "/classes",
  requirePermission("assets.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Asset classes", await assetService.classes(req.query.all === "true"))
    );
  })
);

router.post(
  "/classes",
  requirePermission("assets.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        id: z.string().uuid().optional(),
        code: z.string().min(1).max(20),
        name: z.string().min(1).max(120),
        usefulLifeYears: z.coerce.number().int().min(1).max(100),
        method: z.enum(["SLM", "WDV"]).optional(),
        residualPercent: z.coerce.number().min(0).max(50).optional(),
        scheduleIiHead: z.string().max(80).optional().nullable(),
        itBlockName: z.string().max(80).optional().nullable(),
        itBlockRate: z.coerce.number().min(0).max(100).optional(),
        assetLedgerCode: z.string().max(30).optional(),
        accumDepLedgerCode: z.string().max(30).optional(),
        depExpenseLedgerCode: z.string().max(30).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Asset class saved", await assetService.upsertClass(body)));
  })
);

// ── The register ──────────────────────────────────────────────────────────────
router.get(
  "/",
  requirePermission("assets.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        status: z.enum(["ACTIVE", "DISPOSED", "WRITTEN_OFF"]).optional(),
        classId: z.string().uuid().optional(),
        businessPlaceId: z.string().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Fixed assets", await assetService.list(q)));
  })
);

router.post(
  "/",
  requirePermission("assets.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        code: z.string().min(1).max(30),
        name: z.string().min(1).max(160),
        classCode: z.string().min(1).max(20),
        cost: z.coerce.number().positive(),
        acquiredOn: z.string().min(1),
        capitalisedOn: z.string().optional(),
        businessPlaceId: z.string().optional().nullable(),
        quantity: z.coerce.number().positive().optional(),
        serialNo: z.string().max(80).optional().nullable(),
        location: z.string().max(120).optional().nullable(),
        supplierId: z.coerce.number().int().optional().nullable(),
        sourceDocType: z.string().max(20).optional().nullable(),
        sourceDocId: z.string().max(40).optional().nullable(),
        residualValue: z.coerce.number().min(0).optional().nullable(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Asset added", await assetService.create(body, actorOf(req))));
  })
);

router.get(
  "/register/:fyCode",
  requirePermission("assets.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Fixed asset register",
        await assetService.register(fyCode.parse(req.params.fyCode))
      )
    );
  })
);

router.get(
  "/it-blocks/:fyCode",
  requirePermission("assets.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Income-tax depreciation",
        await assetService.itBlocks(fyCode.parse(req.params.fyCode))
      )
    );
  })
);

router.get(
  "/:id",
  requirePermission("assets.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Fixed asset", await assetService.get(idParam.parse(req.params.id))));
  })
);

router.post(
  "/:id/events",
  requirePermission("assets.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const assetId = idParam.parse(req.params.id);
    const body = z
      .object({
        kind: z.enum(["ADDITION", "REVALUATION", "TRANSFER", "IMPAIRMENT"]),
        effectiveOn: z.string().min(1),
        amount: z.coerce.number().optional(),
        toBusinessPlaceId: z.string().optional().nullable(),
        narration: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Recorded", await assetService.event({ assetId, ...body }, actorOf(req)))
      );
  })
);

router.post(
  "/:id/dispose",
  requirePermission("assets.dispose"),
  asyncHandler(async (req: Request, res: Response) => {
    const assetId = idParam.parse(req.params.id);
    const body = z
      .object({
        disposedOn: z.string().min(1),
        proceeds: z.coerce.number().min(0).optional(),
        moneyLedgerCode: z.string().max(30).optional(),
        narration: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Disposed", await assetService.dispose({ assetId, ...body }, actorOf(req)))
    );
  })
);

// ── Opening balances (P2-07) ────────────────────────────────────────────────────
const openingRow = z.record(z.string(), z.union([z.string(), z.number()])).transform((r) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) if (v !== undefined && v !== null) out[k] = String(v);
  return out;
});

router.post(
  "/opening",
  requirePermission("assets.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = openingRow.parse(req.body ?? {});
    res
      .status(201)
      .json(
        new ApiResponse(
          "Asset added to the register",
          await assetService.createOpening(body, actorOf(req))
        )
      );
  })
);

router.post(
  "/opening/import",
  requirePermission("assets.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        csv: z.string().max(2_000_000).optional(),
        rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).optional(),
      })
      .refine((b) => !!b.csv || !!b.rows, "Send csv or rows")
      .parse(req.body ?? {});
    let rows: Partial<Record<string, string>>[];
    if (body.rows) {
      rows = body.rows.map((r) => openingRow.parse(r));
    } else {
      const { parseOpeningCsv } = await import("./asset.opening.js");
      const parsed = parseOpeningCsv(body.csv as string);
      if (parsed.headerErrors.length > 0) {
        throw new ApiError(400, "The sheet is missing required columns", "OPENING_IMPORT_HEADERS", {
          errors: parsed.headerErrors,
        });
      }
      rows = parsed.rows;
    }
    res.json(
      new ApiResponse(
        "Opening balances imported",
        await assetService.importOpening(rows, actorOf(req))
      )
    );
  })
);

// ── Capitalisation from a document (P2-07) ──────────────────────────────────────
router.post(
  "/capitalise",
  requirePermission("assets.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        sourceDocType: z.enum(["GRN_INVOICE", "EXPENSE"]),
        sourceDocId: z.string().min(1).max(40),
        lineId: z.string().max(40).optional(),
        classId: z.string().uuid(),
        code: z.string().min(1).max(30),
        name: z.string().min(1).max(160),
        capitalisedOn: z.string().optional(),
        businessPlaceId: z.string().optional().nullable(),
        quantity: z.coerce.number().positive().optional(),
        serialNo: z.string().max(80).optional().nullable(),
        location: z.string().max(120).optional().nullable(),
        cost: z.coerce.number().positive().optional(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Capitalised", await assetService.capitalise(body, actorOf(req))));
  })
);

// ── Depreciation ──────────────────────────────────────────────────────────────
router.get(
  "/depreciation/runs",
  requirePermission("assets.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Depreciation runs", await assetService.runs()));
  })
);

router.get(
  "/depreciation/preview/:periodKey",
  requirePermission("assets.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Depreciation preview",
        await assetService.previewRun(periodKey.parse(req.params.periodKey))
      )
    );
  })
);

router.post(
  "/depreciation/:periodKey/prepare",
  requirePermission("assets.depreciate"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Depreciation prepared",
        await assetService.prepareRun(periodKey.parse(req.params.periodKey), actorOf(req))
      )
    );
  })
);

router.post(
  "/depreciation/runs/:id/post",
  requirePermission("assets.depreciate"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Depreciation posted",
        await assetService.postRun(idParam.parse(req.params.id), actorOf(req))
      )
    );
  })
);

router.post(
  "/depreciation-runs/:id/reverse",
  requirePermission("assets.depreciate"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Depreciation run reversed",
        await assetService.reverseRun(idParam.parse(req.params.id), actorOf(req))
      )
    );
  })
);

export default router;
