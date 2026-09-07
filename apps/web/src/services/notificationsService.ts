import apiClient from "../api/apiClient";
import config from "../api/config";

export type NotificationLevel = "INFO" | "SUCCESS" | "WARNING" | "ERROR";

export interface AppNotification {
  id: string;
  level: NotificationLevel;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  data?: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: AppNotification[];
  unreadCount: number;
  nextCursor: string | null;
}

const base = config.notifications.base;

/** The signed-in user's notification centre (P1-00). */
export const notificationsService = {
  list: async (
    opts: { unreadOnly?: boolean; limit?: number; cursor?: string } = {}
  ): Promise<NotificationPage> => {
    const params = new URLSearchParams();
    if (opts.unreadOnly) params.set("unread", "true");
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();
    return (await apiClient.get(`${base}${qs ? `?${qs}` : ""}`)).data?.data as NotificationPage;
  },
  markRead: async (id: string): Promise<AppNotification> =>
    (await apiClient.post(`${base}/${id}/read`, {})).data?.data as AppNotification,
  markAllRead: async (): Promise<{ marked: number }> =>
    (await apiClient.post(`${base}/read-all`, {})).data?.data as { marked: number },
};
