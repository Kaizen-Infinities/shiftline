import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { notificationsService, type AppNotification } from "../../../services/notificationsService";
import { BellRing, CheckCheck } from "lucide-react";
import { timeAgo } from "../../../components/common/notifications/NotificationBell";

const levelChip: Record<AppNotification["level"], string> = {
  INFO: "sl-chip",
  SUCCESS: "sl-chip sl-chip-success",
  WARNING: "sl-chip sl-chip-warning",
  ERROR: "sl-chip sl-chip-danger",
};
const levelWord: Record<AppNotification["level"], string> = {
  INFO: "Info",
  SUCCESS: "Done",
  WARNING: "Attention",
  ERROR: "Problem",
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
    <div className="flex flex-col gap-6 text-ink" data-testid="notifications-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="sl-h1">Notifications</h1>
          <p className="sl-muted mt-1">
            {unreadCount ? `${unreadCount} unread` : "You are up to date"}
          </p>
        </div>
        <button type="button" onClick={readAll} disabled={unreadCount === 0} className="sl-btn">
          <CheckCheck size={16} aria-hidden />
          Mark all read
        </button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
        <button
          type="button"
          className="sl-chip"
          aria-pressed={!unreadOnly}
          onClick={() => setUnreadOnly(false)}
        >
          All
        </button>
        <button
          type="button"
          className="sl-chip"
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly(true)}
        >
          Unread only
        </button>
      </div>

      <ul className="sl-tile divide-y divide-line-soft overflow-hidden">
        {items.length === 0 && !loading && (
          <li className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <span className="sl-icon-tile">
              <BellRing size={20} aria-hidden />
            </span>
            <span className="text-sm text-ink-muted">Nothing here yet</span>
          </li>
        )}
        {items.length === 0 &&
          loading &&
          [0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-4">
              <span className="sl-skeleton h-6 w-16" />
              <span className="sl-skeleton h-4 flex-1" />
            </li>
          ))}
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => void open(n)}
              className={`flex min-h-[3.25rem] w-full items-start gap-4 px-5 py-4 text-left hover:bg-nav-hover ${n.readAt ? "opacity-70" : ""}`}
            >
              <span className={`${levelChip[n.level]} mt-0.5 !text-xs`}>{levelWord[n.level]}</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${n.readAt ? "" : "font-semibold"}`}>
                  {n.title}
                </span>
                {n.body && <span className="mt-0.5 block text-sm text-ink-muted">{n.body}</span>}
                <span className="mt-1 block text-xs text-ink-subtle">
                  {n.category} · {timeAgo(n.createdAt)}
                </span>
              </span>
              {!n.readAt && (
                <span
                  className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                  aria-label="Unread"
                />
              )}
            </button>
          </li>
        ))}
      </ul>

      {cursor && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={loading}
            className="sl-btn"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationsPage;
