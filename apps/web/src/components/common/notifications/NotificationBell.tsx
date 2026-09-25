import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiBell } from "react-icons/fi";
import { useNotifications } from "./useNotifications";
import type { AppNotification } from "../../../services/notificationsService";

const levelDot: Record<AppNotification["level"], string> = {
  INFO: "bg-[color:var(--color-info)]",
  SUCCESS: "bg-[color:var(--color-success)]",
  WARNING: "bg-[color:var(--color-warning)]",
  ERROR: "bg-[color:var(--color-danger)]",
};

const isNudgeNotification = (n: AppNotification): boolean => {
  return n.category === "gst-returns" && (n.link?.includes("record=") ?? false);
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
        className="sl-icon-btn sl-icon-btn-md relative"
      >
        <FiBell size={17} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-[color:var(--color-danger)] px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-[color:var(--color-card)]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="sl-popover absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden !p-0"
        >
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            <button
              type="button"
              className="rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-nav-hover disabled:opacity-50"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-auto">
            {items.length === 0 && <li className="sl-popover-empty py-8">Nothing yet</li>}
            {items.map((n) => (
              <li key={n.id} className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-nav-hover ${
                    n.readAt ? "opacity-70" : ""
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${levelDot[n.level]}`} />
                  <span className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className={`block truncate text-sm ${n.readAt ? "" : "font-semibold"}`}>
                        {n.title}
                      </span>
                      {isNudgeNotification(n) && (
                        <span className="sl-chip sl-chip-sm shrink-0 !px-2 !text-[10px]">
                          Nudge
                        </span>
                      )}
                    </div>
                    {n.body && (
                      <span className="block truncate text-xs text-ink-muted">{n.body}</span>
                    )}
                    <span className="mt-0.5 block text-[11px] text-ink-subtle">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && (
                    <span
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent"
                      aria-label="Unread"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="w-full border-t border-line-soft px-4 py-3 text-center text-[13px] font-semibold text-accent hover:bg-nav-hover"
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
