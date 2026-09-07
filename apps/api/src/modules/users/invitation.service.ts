/**
 * User invitations (P1-00). An office user invites a colleague by email with a
 * role; the colleague opens the link, picks a username and password, and is
 * signed in. The raw token exists only in the email; the row stores its sha256.
 * Replaces the old "welcome email containing the password" flow.
 */
import crypto from "node:crypto";
import type { Invitation } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { env, isProduction } from "../../config/env";
import { logger } from "../../lib/logger";
import { getTenant, requireTenantId, runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { hashPassword } from "../../utils/hashPassword";
import { sendEmail } from "../../utils/mailer";
import { authService } from "../auth/auth.service";

export const INVITATION_TTL_DAYS = 7;

const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const acceptUrlFor = (raw: string) =>
  `${env.FRONTEND_URL.replace(/\/+$/, "")}/accept-invitation?token=${raw}`;

export interface CreateInvitationInput {
  email: string;
  fullName?: string;
  roleId: number;
  invitedBy?: string;
}

export interface AcceptInvitationInput {
  fullName?: string;
  username?: string;
  password: string;
}

const usernameFrom = (email: string) =>
  email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30) || "user";

class InvitationService {
  /** Creates (or replaces a pending invitation for the same email) and emails the link. */
  async create(input: CreateInvitationInput, opts: { companyName?: string } = {}) {
    const companyId = requireTenantId();
    const email = input.email.trim().toLowerCase();

    const role = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new ApiError(404, "Role not found");
    const existingUser = await withoutTenant(() => prisma.user.findFirst({ where: { email } }));
    if (existingUser) throw new ApiError(409, "A user with this email already exists");

    // One live invitation per email per tenant: earlier pending ones are revoked.
    await prisma.invitation.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const raw = crypto.randomBytes(32).toString("hex");
    const invitation = await prisma.invitation.create({
      data: {
        companyId,
        email,
        fullName: input.fullName?.trim() || null,
        roleId: input.roleId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        invitedBy: input.invitedBy ?? getTenant()?.userId ?? null,
      },
    });

    const acceptUrl = acceptUrlFor(raw);
    const companyName =
      opts.companyName ??
      (await prisma.company.findUnique({ where: { id: companyId } }))?.companyName ??
      "Shiftline";
    let emailed = false;
    try {
      await sendEmail({
        to: email,
        subject: `You're invited to ${companyName} on Shiftline`,
        html: `<p>Hello${input.fullName ? ` ${input.fullName}` : ""},</p>
<p>You have been invited to <strong>${companyName}</strong> on Shiftline as <strong>${role.name}</strong>.</p>
<p><a href="${acceptUrl}">Accept the invitation and set your password</a></p>
<p>The link is valid for ${INVITATION_TTL_DAYS} days. If you were not expecting this, ignore this email.</p>`,
      });
      emailed = true;
    } catch (err) {
      logger.warn({ err, invitationId: invitation.id }, "invitation email not sent");
    }

    return {
      invitation,
      emailed,
      // Outside production the inviter gets the link, so local setups without SMTP still work.
      acceptUrl: isProduction ? undefined : acceptUrl,
    };
  }

  async list() {
    return prisma.invitation.findMany({
      orderBy: { createdAt: "desc" },
      include: { role: { select: { id: true, code: true, name: true } } },
    });
  }

  async resend(id: string) {
    const inv = await prisma.invitation.findUnique({ where: { id } });
    if (!inv) throw new ApiError(404, "Invitation not found");
    if (inv.acceptedAt) throw new ApiError(400, "Invitation already accepted");
    return this.create({
      email: inv.email,
      fullName: inv.fullName ?? undefined,
      roleId: inv.roleId,
      invitedBy: getTenant()?.userId,
    });
  }

  async revoke(id: string) {
    const inv = await prisma.invitation.findUnique({ where: { id } });
    if (!inv) throw new ApiError(404, "Invitation not found");
    if (inv.acceptedAt) throw new ApiError(400, "Invitation already accepted");
    return prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  // ─── Public (token) ─────────────────────────────────────────────────────────

  private async findLive(
    rawToken: string
  ): Promise<Invitation & { companyName: string; roleName: string }> {
    const inv = await withoutTenant(() =>
      prisma.invitation.findUnique({
        where: { tokenHash: hashToken(rawToken) },
        include: { company: { select: { companyName: true } }, role: { select: { name: true } } },
      })
    );
    if (!inv || inv.revokedAt) throw new ApiError(404, "Invitation not found");
    if (inv.acceptedAt) throw new ApiError(410, "Invitation already used");
    if (inv.expiresAt < new Date()) throw new ApiError(410, "Invitation expired");
    const { company, role, ...rest } = inv;
    return { ...rest, companyName: company.companyName, roleName: role.name };
  }

  async preview(rawToken: string) {
    const inv = await this.findLive(rawToken);
    return {
      email: inv.email,
      fullName: inv.fullName,
      companyName: inv.companyName,
      roleName: inv.roleName,
      expiresAt: inv.expiresAt,
    };
  }

  /** Creates the user with the invited role and signs them in. */
  async accept(
    rawToken: string,
    input: AcceptInvitationInput,
    ipAddress?: string,
    userAgent?: string
  ) {
    const inv = await this.findLive(rawToken);
    const fullName = (input.fullName ?? inv.fullName ?? "").trim();
    if (!fullName) throw new ApiError(400, "fullName is required");

    const base = (input.username ?? usernameFrom(inv.email)).toLowerCase();
    const user = await runAsTenant(inv.companyId, async () => {
      let username = base;
      for (let i = 1; i < 50; i++) {
        const taken = await withoutTenant(() => prisma.user.findUnique({ where: { username } }));
        if (!taken) break;
        if (input.username) throw new ApiError(409, "Username is already taken");
        username = `${base}${i}`;
      }
      const created = await prisma.user.create({
        data: {
          companyId: inv.companyId,
          username,
          fullName,
          email: inv.email,
          passwordHash: await hashPassword(input.password),
          roleId: inv.roleId,
          status: "active",
          mustChangePw: false,
          createdBy: inv.invitedBy ?? undefined,
        },
      });
      await prisma.invitation.update({
        where: { id: inv.id },
        data: { acceptedAt: new Date(), acceptedUserId: created.userId },
      });
      return created;
    });

    const auth = await authService.login(
      { email: inv.email, password: input.password },
      ipAddress,
      userAgent
    );
    return { user, auth };
  }
}

export const invitationService = new InvitationService();
