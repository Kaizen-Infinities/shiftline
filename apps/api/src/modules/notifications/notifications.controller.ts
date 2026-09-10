import { Request, Response } from "express";
import { z } from "zod";

import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { notificationsService } from "./notifications.service";

export const listNotificationsSchema = z.object({
  query: z.object({
    unread: z
      .enum(["true", "false", "1", "0"])
      .optional()
      .transform((v) => v === "true" || v === "1"),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().uuid().optional(),
  }),
});

export const notificationIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

/** Platform admins have no tenant user row and therefore no notifications. */
const requireUser = (req: Request): string => {
  const id = req.user?.userId;
  if (!id || id.startsWith("admin_"))
    throw new ApiError(400, "Notifications belong to tenant users");
  return id;
};

export const notificationsController = {
  list: async (req: Request, res: Response) => {
    const q = req.query as unknown as { unread: boolean; limit?: number; cursor?: string };
    res.json(
      new ApiResponse(
        "Notifications",
        await notificationsService.list(requireUser(req), {
          unreadOnly: q.unread,
          limit: q.limit,
          cursor: q.cursor,
        })
      )
    );
  },

  markRead: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Marked as read",
        await notificationsService.markRead(requireUser(req), String(req.params.id))
      )
    );
  },

  markAllRead: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "All marked as read",
        await notificationsService.markAllRead(requireUser(req))
      )
    );
  },
};
