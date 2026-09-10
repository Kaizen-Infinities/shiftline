import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiBell } from "react-icons/fi";
import { useNotifications } from "./useNotifications";
import type { AppNotification } from "../../../services/notificationsService";

const levelDot: Record<AppNotification["level"], string> = {
  INFO: "bg-sky-400",
  SUCCESS: "bg-emerald-400",
  WARNING: "bg-amber-400",
  ERROR: "bg-red-500",
};

export const timeAgo = (iso: string) => {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};

/** Header bell with an unread badge and a dropdown of the latest notices. */
const NotificationBell: React.FC = () => {
  const navigate = useNavigate();
  const { items, unreadCount, markRead, markAllRead, enabled } = useNotifications(12);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled) return null;

  const openItem = (n: AppNotification) => {
    void markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="notification-bell"
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-slate-700/60 bg-slate-800/80 text-slate-200 shadow-xs hover:bg-slate-700"
      >
        <FiBell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-line-soft bg-card text-ink shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
              Notifications
            </span>
            <button
              type="button"
              className="text-xs text-blue-500 hover:underline disabled:opacity-50"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-auto">
            {items.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-muted">Nothing yet</li>
            )}
            {items.map((n) => (
              <li key={n.id} className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-card-2 ${
                    n.readAt ? "opacity-70" : ""
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${levelDot[n.level]}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${n.readAt ? "" : "font-semibold"}`}>
                      {n.title}
                    </span>
                    {n.body && (
                      <span className="block truncate text-xs text-ink-muted">{n.body}</span>
                    )}
                    <span className="block text-[11px] text-ink-muted/80">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && (
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="w-full border-t border-line-soft px-3 py-2 text-center text-xs font-semibold text-blue-500 hover:bg-card-2"
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
          >
            View all
          </button>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
