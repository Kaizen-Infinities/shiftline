import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";

const MAX_LIMIT = 100;

class NotificationsService {
  /** The caller's notifications, newest first, with the unread count; `cursor` is the last id seen. */
  async list(userId: string, opts: { unreadOnly?: boolean; limit?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 20, 1), MAX_LIMIT);
    const where = { userId, ...(opts.unreadOnly ? { readAt: null } : {}) };
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: take + 1,
        ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const hasMore = items.length > take;
    const page = hasMore ? items.slice(0, take) : items;
    return { items: page, unreadCount, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async markRead(userId: string, id: string) {
    const row = await prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw new ApiError(404, "Notification not found");
    if (row.readAt) return row;
    return prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string) {
    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: count };
  }
}

export const notificationsService = new NotificationsService();
