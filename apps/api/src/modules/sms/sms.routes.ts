import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { otpService } from "./otp.service";
import { smsConfigSchema, smsService, smsTemplateSchema } from "./sms.service";

const actor = (req: Request) => ({ userId: (req as any).user?.id as string | undefined });

/**
 * /api/sms (P1-22): the account, the DLT templates, the log and one-time passwords.
 *
 * The OTP endpoints sit behind a session on purpose. Issuing a code to an unauthenticated caller
 * is what an OTP login needs, and that is an auth change rather than a messaging one.
 */
const router = Router();
router.use(authMiddleware);

router.get(
  "/settings",
  requirePermission("sms.settings"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("SMS settings", await smsService.config()));
  })
);

router.put(
  "/settings",
  requirePermission("sms.settings"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = smsConfigSchema.parse(req.body);
    res.json(
      new ApiResponse("SMS settings saved", await smsService.updateConfig(body, actor(req)))
    );
  })
);

router.post(
  "/settings/verify",
  requirePermission("sms.settings"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("SMS account checked", await smsService.verifyConfig()));
  })
);

router.get(
  "/templates",
  requirePermission("sms.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const all = req.query.all === "true";
    res.json(new ApiResponse("SMS templates", await smsService.templates(all)));
  })
);

router.put(
  "/templates",
  requirePermission("sms.settings"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = smsTemplateSchema.parse(req.body);
    res.json(new ApiResponse("Template saved", await smsService.saveTemplate(body, actor(req))));
  })
);

/** What a body will cost, and what it will say, before anybody sends it. */
router.post(
  "/preview",
  requirePermission("sms.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        body: z.string().min(1).max(1000),
        values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
      })
      .parse(req.body);
    res.json(new ApiResponse("Preview", smsService.preview(body.body, body.values)));
  })
);

router.post(
  "/send",
  requirePermission("sms.send"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        to: z.string().min(5).max(20),
        templateCode: z.string().min(1).max(40),
        values: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
        purpose: z.string().max(30).optional(),
        /** Send through the pg-boss queue instead of inline (P2-01). */
        queue: z.boolean().optional().default(false),
      })
      .parse(req.body);
    if (body.queue) {
      const { row, queued } = await smsService.sendTemplateQueued(body);
      res.status(201).json(new ApiResponse(queued ? "Message queued" : "Message sent", row));
      return;
    }
    const row = await smsService.sendTemplate(body);
    res.status(201).json(new ApiResponse("Message sent", row));
  })
);

router.get(
  "/messages",
  requirePermission("sms.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        to: z.string().max(20).optional(),
        status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED"]).optional(),
        take: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Messages", await smsService.messages(q)));
  })
);

router.post(
  "/otp/request",
  requirePermission("sms.send"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        mobile: z.string().min(5).max(20),
        purpose: z
          .enum(["MOBILE_VERIFY", "FIELD_LOGIN", "PAYMENT_CONFIRM"])
          .default("MOBILE_VERIFY"),
      })
      .parse(req.body);
    const out = await otpService.request({ ...body, requestedBy: actor(req).userId });
    // The code is not in this response and is not in any other.
    res.status(201).json(new ApiResponse("Code sent", out));
  })
);

router.post(
  "/otp/verify",
  requirePermission("sms.send"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        challengeId: z.string().uuid(),
        code: z.string().regex(/^\d{4,8}$/, "A code is digits only"),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Code accepted", await otpService.verify(body.challengeId, body.code))
    );
  })
);

export default router;
