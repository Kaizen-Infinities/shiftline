/**
 * Producer side of the notification centre (P1-00). Call from a request or a
 * job running under a tenant context; one row is written per recipient and each
 * recipient's sockets get `notification:created`. Never throws into the caller's
 * flow: a notification is a courtesy, the business action already happened.
 */
import type { NotificationLevel, Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { emitToUser } from "../../lib/realtime";
import { requireTenantId } from "../../lib/tenant-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NotifyAudience =
  | { userIds: (string | null | undefined)[] }
  | { permission: string; exclude?: (string | null | undefined)[] }
  | { all: true; exclude?: (string | null | undefined)[] };

export interface NotifyInput {
  category: string;
  title: string;
  body?: string | null;
  link?: string | null;
  level?: NotificationLevel;
  data?: Prisma.InputJsonValue;
  to: NotifyAudience;
  createdBy?: string | null;
}

/** Resolves an audience to tenant user ids (active users only; platform admins are never recipients). */
export const resolveRecipients = async (to: NotifyAudience): Promise<string[]> => {
  if ("userIds" in to) {
    return [...new Set(to.userIds.filter((id): id is string => !!id && UUID_RE.test(id)))];
  }
  const exclude = new Set((to.exclude ?? []).filter(Boolean) as string[]);
  let roleIds: number[] | undefined;
  if ("permission" in to) {
    const grants = await prisma.rolePermission.findMany({
      where: { permission: { key: to.permission } },
      select: { roleId: true },
    });
    roleIds = grants.map((g) => g.roleId);
    if (roleIds.length === 0) return [];
  }
  const users = await prisma.user.findMany({
    where: { status: "active", ...(roleIds ? { roleId: { in: roleIds } } : {}) },
    select: { userId: true },
  });
  return users.map((u) => u.userId).filter((id) => !exclude.has(id));
};

/** Writes the notification for every recipient and emits it; returns the number written. */
export const notify = async (input: NotifyInput): Promise<number> => {
  try {
    requireTenantId();
    const recipients = await resolveRecipients(input.to);
    if (recipients.length === 0) return 0;
    const created = await prisma.notification.createManyAndReturn({
      data: recipients.map((userId) => ({
        userId,
        level: input.level ?? "INFO",
        category: input.category.slice(0, 40),
        title: input.title.slice(0, 160),
        body: input.body?.slice(0, 1000) ?? null,
        link: input.link ?? null,
        data: input.data,
        createdBy: input.createdBy && UUID_RE.test(input.createdBy) ? input.createdBy : null,
      })),
    });
    for (const n of created) emitToUser(n.userId, "notification:created", n);
    return created.length;
  } catch (err) {
    logger.warn({ err, category: input.category, title: input.title }, "notification not sent");
    return 0;
  }
};
