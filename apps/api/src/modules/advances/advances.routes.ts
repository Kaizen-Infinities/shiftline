import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { currencyService } from "../currency/currency.service";
import { advanceService } from "./advance.service";

/** /api/advances (P1-14): money taken before the invoice, and the currencies it may come in. */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });

const createBody = z.object({
  customerId: z.string().uuid(),
  receiptDate: z.string().min(1),
  amount: z.coerce.number().positive(),
  gstRate: z.coerce.number().min(0).max(100).optional().nullable(),
  businessPlaceId: z.union([z.string(), z.number()]).optional().nullable(),
  placeOfSupply: z
    .string()
    .regex(/^\d{2}$/)
    .optional()
    .nullable(),
  paymentMethod: z.string().max(50).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
  narration: z.string().max(500).optional().nullable(),
});

router.get(
  "/",
  requirePermission("advances.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        customerId: z.string().uuid().optional(),
        status: z.enum(["OPEN", "PART_ADJUSTED", "CLOSED"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Advances", await advanceService.list(q)));
  })
);

router.get(
  "/open",
  requirePermission("advances.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ customerId: z.string().uuid() }).parse(req.query);
    res.json(new ApiResponse("Open advances", await advanceService.openFor(q.customerId)));
  })
);

router.get(
  "/:id",
  requirePermission("advances.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(new ApiResponse("Advance", await advanceService.get(id)));
  })
);

router.post(
  "/",
  requirePermission("advances.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Advance recorded", await advanceService.create(body, actorOf(req))));
  })
);

router.post(
  "/:id/adjust",
  requirePermission("advances.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        salesInvoiceId: z.string().uuid(),
        amount: z.coerce.number().positive(),
        on: z.string().optional(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Advance applied", await advanceService.adjust(id, body, actorOf(req)))
    );
  })
);

router.post(
  "/:id/refund",
  requirePermission("advances.refund"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        amount: z.coerce.number().positive(),
        on: z.string().optional(),
        reason: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Advance refunded", await advanceService.refund(id, body, actorOf(req)))
    );
  })
);

/** The currency master and the daily rates every foreign-currency document converts through. */
export const currencyRouter = Router();
currencyRouter.use(authMiddleware);

currencyRouter.get(
  "/",
  requirePermission("currencies.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const all = req.query.all === "true";
    res.json(new ApiResponse("Currencies", await currencyService.list(all)));
  })
);

currencyRouter.post(
  "/",
  requirePermission("currencies.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        code: z.string().length(3),
        name: z.string().min(1).max(60),
        symbol: z.string().max(6).optional().nullable(),
        decimals: z.coerce.number().int().min(0).max(4).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Currency saved", await currencyService.upsert(body)));
  })
);

currencyRouter.get(
  "/rates",
  requirePermission("currencies.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        currencyCode: z.string().length(3).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Rates", await currencyService.rates(q.currencyCode, q.from, q.to)));
  })
);

currencyRouter.post(
  "/rates",
  requirePermission("currencies.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        currencyCode: z.string().length(3),
        rateDate: z.coerce.date(),
        rate: z.coerce.number().positive(),
        source: z.enum(["MANUAL", "RBI", "IMPORT"]).optional(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse(
        "Rate saved",
        await currencyService.setRate({ ...body, userId: req.user?.userId })
      )
    );
  })
);

export default router;
