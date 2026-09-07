import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { notificationsService, type AppNotification } from "../../../services/notificationsService";
import { timeAgo } from "../../../components/common/notifications/NotificationBell";

const levelBadge: Record<AppNotification["level"], string> = {
  INFO: "bg-sky-500/15 text-sky-500",
  SUCCESS: "bg-emerald-500/15 text-emerald-500",
  WARNING: "bg-amber-500/15 text-amber-500",
  ERROR: "bg-red-500/15 text-red-500",
};

/** Full list of the signed-in user's notifications with paging and read controls. */
const NotificationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const page = await notificationsService.list({
          limit: 30,
          unreadOnly,
          cursor: reset ? undefined : (cursor ?? undefined),
        });
        setItems((xs) => (reset ? page.items : [...xs, ...page.items]));
        setCursor(page.nextCursor);
        setUnreadCount(page.unreadCount);
      } catch (err) {
        toast.error((err as Error)?.message ?? "Could not load notifications");
      } finally {
        setLoading(false);
      }
    },
    [unreadOnly, cursor]
  );

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  const open = async (n: AppNotification) => {
    if (!n.readAt) {
      setItems((xs) =>
        xs.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      notificationsService.markRead(n.id).catch(() => undefined);
    }
    if (n.link) navigate(n.link);
  };

  const readAll = async () => {
    await notificationsService.markAllRead();
    setItems((xs) => xs.map((x) => (x.readAt ? x : { ...x, readAt: new Date().toISOString() })));
    setUnreadCount(0);
  };

  return (
    <div className="p-4 text-ink" data-testid="notifications-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Notifications</h1>
          <p className="text-sm text-ink-muted">
            {unreadCount ? `${unreadCount} unread` : "You are up to date"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-2 text-ink-muted">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Unread only
          </label>
          <button
            type="button"
            onClick={readAll}
            disabled={unreadCount === 0}
            className="rounded-xl border border-line-soft bg-card-2 px-3 py-1.5 font-semibold hover:bg-card disabled:opacity-50"
          >
            Mark all read
          </button>
        </div>
      </div>

      <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line-soft bg-card">
        {items.length === 0 && !loading && (
          <li className="px-4 py-10 text-center text-sm text-ink-muted">Nothing here yet</li>
        )}
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void open(n)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-card-2 ${n.readAt ? "opacity-70" : ""}`}
            >
              <span
                className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${levelBadge[n.level]}`}
              >
                {n.level}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${n.readAt ? "" : "font-semibold"}`}>
                  {n.title}
                </span>
                {n.body && <span className="block text-sm text-ink-muted">{n.body}</span>}
                <span className="block text-xs text-ink-muted/80">
                  {n.category} · {timeAgo(n.createdAt)}
                </span>
              </span>
              {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
            </button>
          </li>
        ))}
      </ul>

      {cursor && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={loading}
            className="rounded-xl border border-line-soft bg-card-2 px-4 py-2 text-sm font-semibold hover:bg-card disabled:opacity-50"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
