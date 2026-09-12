import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { fxService } from "./fx.service";
import { importsService } from "./imports.service";
import { RATE_PROVIDERS } from "./providers";

/**
 * /api/fx (P1-17): rate pulls, the two kinds of exchange difference, and bills of entry.
 * Everything that posts is a POST; the previews change nothing and are GETs.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idParam = z.string().uuid();
const periodKey = z.string().regex(/^\d{4}-\d{2}$/, "A period looks like 2026-08");

router.post(
  "/rates/pull",
  requirePermission("currencies.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        on: z.coerce.date().optional(),
        provider: z.enum(RATE_PROVIDERS).optional(),
        currencies: z.array(z.string().length(3)).optional(),
      })
      .parse(req.body ?? {});
    res.json(
      new ApiResponse(
        "Rates pulled",
        await fxService.pullRates({ ...body, on: body.on ?? new Date() })
      )
    );
  })
);

router.get(
  "/exposure",
  requirePermission("currencies.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ asOn: z.coerce.date().optional() }).parse(req.query);
    res.json(
      new ApiResponse("Open foreign currency", await fxService.openExposure(q.asOn ?? new Date()))
    );
  })
);

router.post(
  "/realise",
  requirePermission("currencies.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        documentType: z.string().min(1).max(30),
        documentId: z.string().min(1).max(40),
        documentNo: z.string().min(1).max(30),
        partyLedgerCode: z.string().min(1).max(30),
        currencyCode: z.string().length(3),
        foreignAmount: z.coerce.number().positive(),
        bookedRate: z.coerce.number().positive(),
        settledRate: z.coerce.number().positive(),
        on: z.string().min(1),
        narration: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Exchange difference posted", await fxService.realise(body, actorOf(req)))
    );
  })
);

router.get(
  "/revaluations",
  requirePermission("currencies.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Revaluations", await fxService.revaluations()));
  })
);

router.get(
  "/revaluations/preview/:periodKey",
  requirePermission("currencies.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Revaluation preview",
        await fxService.previewRevaluation(periodKey.parse(req.params.periodKey))
      )
    );
  })
);

router.post(
  "/revaluations/:periodKey",
  requirePermission("currencies.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Revalued",
        await fxService.revalue(periodKey.parse(req.params.periodKey), actorOf(req))
      )
    );
  })
);

// ── Imports ───────────────────────────────────────────────────────────────────
router.get(
  "/bills-of-entry",
  requirePermission("imports.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
      .parse(req.query);
    res.json(new ApiResponse("Bills of entry", await importsService.list(q)));
  })
);

router.post(
  "/bills-of-entry",
  requirePermission("imports.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        beNumber: z.string().min(1).max(20),
        beDate: z.string().min(1),
        portCode: z.string().max(10).optional().nullable(),
        grnInvoiceId: z.string().uuid().optional().nullable(),
        supplierId: z.coerce.number().int().optional().nullable(),
        currencyCode: z.string().length(3).optional(),
        exchangeRate: z.coerce.number().positive(),
        foreignValue: z.coerce.number().min(0),
        assessableValue: z.coerce.number().min(0).optional().nullable(),
        basicDuty: z.coerce.number().min(0).optional(),
        socialWelfareSurcharge: z.coerce.number().min(0).optional(),
        igst: z.coerce.number().min(0).optional(),
        cess: z.coerce.number().min(0).optional(),
        otherCharges: z.coerce.number().min(0).optional(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Bill of entry recorded", await importsService.create(body, actorOf(req)))
      );
  })
);

router.get(
  "/bills-of-entry/:id",
  requirePermission("imports.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Bill of entry", await importsService.get(idParam.parse(req.params.id)))
    );
  })
);

router.get(
  "/bills-of-entry/:id/landed-cost",
  requirePermission("imports.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Landed cost",
        await importsService.landedCostBreakdown(idParam.parse(req.params.id))
      )
    );
  })
);

export default router;
