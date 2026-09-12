import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission, requireSuperAdmin } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { billingService } from "./billing.service";
import { gatewayConfigSchema, paymentsConfigService } from "./payments.config.service";
import { paymentsService } from "./payments.service";
import { webhookService } from "./webhook.service";

const actor = (req: Request) => ({ userId: (req as any).user?.id as string | undefined });

/**
 * /api/payments (P1-21): links a customer can pay, and the gateway's settings.
 *
 * The callback router below is deliberately outside the authentication middleware: a gateway has
 * no session. It is authenticated by the signature on the body instead, and by a token in the
 * path that tells us which tenant to check the signature against.
 */
const router = Router();
router.use(authMiddleware);

router.get(
  "/links",
  requirePermission("payments.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        status: z.enum(["CREATED", "PARTIALLY_PAID", "PAID", "EXPIRED", "CANCELLED"]).optional(),
        salesInvoiceId: z.string().uuid().optional(),
        take: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Payment links", await paymentsService.list(q)));
  })
);

router.post(
  "/links",
  requirePermission("payments.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        salesInvoiceId: z.string().uuid().optional().nullable(),
        customerId: z.string().uuid().optional().nullable(),
        amount: z.coerce.number().positive().max(1e12).optional().nullable(),
        description: z.string().max(255).optional().nullable(),
        notifyEmail: z.string().email().max(120).optional().nullable(),
        notifyPhone: z.string().max(20).optional().nullable(),
        expiresAt: z.coerce.date().optional().nullable(),
      })
      .parse(req.body);
    const row = await paymentsService.create(body, actor(req));
    res.status(201).json(new ApiResponse("Payment link raised", row));
  })
);

router.get(
  "/links/:id",
  requirePermission("payments.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(new ApiResponse("Payment link", await paymentsService.get(id)));
  })
);

router.post(
  "/links/:id/cancel",
  requirePermission("payments.cancel"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().max(255).optional() }).parse(req.body ?? {});
    res.json(
      new ApiResponse(
        "Payment link cancelled",
        await paymentsService.cancel(id, reason ?? null, actor(req))
      )
    );
  })
);

router.post(
  "/links/:id/refresh",
  requirePermission("payments.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(new ApiResponse("Payment link refreshed", await paymentsService.refresh(id)));
  })
);

/** Fixture gateway only: what a payer doing their part would send. */
router.post(
  "/links/:id/simulate",
  requirePermission("payments.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        amount: z.coerce.number().positive().optional().nullable(),
        fail: z.boolean().optional(),
        method: z.string().max(30).optional(),
      })
      .parse(req.body ?? {});
    const out = await paymentsService.simulate(id, body.amount ?? null, {
      fail: body.fail,
      method: body.method,
    });
    res.json(new ApiResponse("Callback prepared", out));
  })
);

router.get(
  "/settings",
  requirePermission("payments.settings"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Gateway settings", await paymentsConfigService.get()));
  })
);

router.put(
  "/settings",
  requirePermission("payments.settings"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = gatewayConfigSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "Gateway settings saved",
        await paymentsConfigService.update(body, actor(req))
      )
    );
  })
);

router.post(
  "/settings/verify",
  requirePermission("payments.settings"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Gateway checked", await paymentsConfigService.verify()));
  })
);

router.post(
  "/settings/rotate-token",
  requirePermission("payments.settings"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Callback URL rotated",
        await paymentsConfigService.rotateWebhookToken(actor(req))
      )
    );
  })
);

export default router;

/** /api/payments/webhook — no session; the signature on the body is the credential. */
export const paymentWebhookRouter = Router();

const rawBodyOf = (req: Request): string => {
  const raw = (req as any).rawBody;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (typeof raw === "string") return raw;
  return JSON.stringify(req.body ?? {});
};

const signatureOf = (req: Request): string | null => {
  const header = req.get("x-payment-signature") ?? req.get("x-razorpay-signature");
  return header ? String(header) : null;
};

paymentWebhookRouter.post(
  "/platform",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await webhookService.handlePlatformCallback(rawBodyOf(req), signatureOf(req));
    res.json(new ApiResponse("Callback handled", result));
  })
);

paymentWebhookRouter.post(
  "/:token",
  asyncHandler(async (req: Request, res: Response) => {
    const token = z.string().min(16).max(64).parse(req.params.token);
    const result = await webhookService.handleTenantCallback(
      token,
      rawBodyOf(req),
      signatureOf(req)
    );
    res.json(new ApiResponse("Callback handled", result));
  })
);

/** /api/platform/billing (super admin): what each tenant owes the platform. */
export const platformBillingRouter = Router();
platformBillingRouter.use(authMiddleware, requireSuperAdmin());

platformBillingRouter.get(
  "/:companyId/invoices",
  asyncHandler(async (req: Request, res: Response) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    const status = z.enum(["DUE", "PAID", "FAILED", "VOID"]).optional().parse(req.query.status);
    res.json(
      new ApiResponse("Subscription invoices", await billingService.list(companyId, status))
    );
  })
);

platformBillingRouter.post(
  "/:companyId/invoices",
  asyncHandler(async (req: Request, res: Response) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    const body = z
      .object({
        periodStart: z.coerce.date(),
        periodEnd: z.coerce.date(),
        amount: z.coerce.number().positive().optional().nullable(),
      })
      .parse(req.body);
    const row = await billingService.raise(companyId, body);
    res.status(201).json(new ApiResponse("Subscription invoice raised", row));
  })
);

platformBillingRouter.post(
  "/:companyId/provider-ids",
  asyncHandler(async (req: Request, res: Response) => {
    const companyId = z.string().uuid().parse(req.params.companyId);
    const body = z
      .object({
        providerSubscriptionId: z.string().min(1).max(120),
        providerCustomerId: z.string().max(120).optional().nullable(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse(
        "Subscription bound to the gateway",
        await billingService.attachProviderIds(companyId, body)
      )
    );
  })
);
