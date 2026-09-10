import { Request, Response } from "express";
import { z } from "zod";

import { ApiResponse } from "../../utils/ApiResponse";
import { setRefreshCookie, wantsTokenInBody } from "../auth/refresh-token";
import { invitationService } from "./invitation.service";

export const createInvitationSchema = z.object({
  body: z.object({
    email: z.string().email(),
    fullName: z.string().min(2).max(160).optional(),
    roleId: z.coerce.number().int().positive(),
  }),
});

export const invitationIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const invitationTokenSchema = z.object({
  params: z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, "Invalid token") }),
});

export const acceptInvitationSchema = z.object({
  params: z.object({ token: z.string().regex(/^[0-9a-f]{64}$/, "Invalid token") }),
  body: z.object({
    fullName: z.string().min(2).max(160).optional(),
    username: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9._-]+$/, "Lower-case letters, digits, dot, underscore or hyphen")
      .optional(),
    password: z.string().min(10).max(128),
  }),
});

export const invitationController = {
  list: async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Invitations", await invitationService.list()));
  },

  create: async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof createInvitationSchema>["body"];
    const result = await invitationService.create({ ...body, invitedBy: req.user?.userId });
    res.status(201).json(
      new ApiResponse("Invitation sent", {
        ...result.invitation,
        emailed: result.emailed,
        acceptUrl: result.acceptUrl,
      })
    );
  },

  resend: async (req: Request, res: Response) => {
    const result = await invitationService.resend(String(req.params.id));
    res.json(
      new ApiResponse("Invitation re-sent", {
        ...result.invitation,
        emailed: result.emailed,
        acceptUrl: result.acceptUrl,
      })
    );
  },

  revoke: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Invitation revoked", await invitationService.revoke(String(req.params.id)))
    );
  },

  // ─── Public ─────────────────────────────────────────────────────────────────

  preview: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Invitation", await invitationService.preview(String(req.params.token)))
    );
  },

  accept: async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof acceptInvitationSchema>["body"];
    const { auth } = await invitationService.accept(
      String(req.params.token),
      body,
      req.ip,
      req.get("user-agent") ?? undefined
    );
    if (auth.tokens.refreshToken) setRefreshCookie(res, auth.tokens.refreshToken);
    res.status(201).json(
      new ApiResponse("Welcome aboard", {
        accessToken: auth.tokens.accessToken,
        accessTokenExpiresAt: auth.tokens.accessTokenExpiresAt,
        ...(wantsTokenInBody(req) ? { refreshToken: auth.tokens.refreshToken } : {}),
        user: auth.user,
        session: auth.sessionInfo,
      })
    );
  },
};
