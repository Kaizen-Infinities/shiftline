import React, { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";

import { useNotifications } from "../common/notifications/useNotifications";
import { timeAgo } from "../common/notifications/NotificationBell";
import type { AppNotification } from "../../services/notificationsService";
import { useDismiss } from "./useDismiss";
import { useT } from "../../i18n/I18nProvider";

/** Dot colour per level; status colours come from the theme tokens. */
const LEVEL_DOT: Record<AppNotification["level"], string> = {
  INFO: "bg-[color:var(--color-info)]",
  SUCCESS: "bg-[color:var(--color-success)]",
  WARNING: "bg-[color:var(--color-warning)]",
  ERROR: "bg-[color:var(--color-danger)]",
};

const isNudge = (n: AppNotification) =>
  n.category === "gst-returns" && (n.link?.includes("record=") ?? false);

/** Top-bar bell: unread count and a popover with the latest notices (P1-00). */
const NotificationsMenu: React.FC = () => {
  const navigate = useNavigate();
  const { items, unreadCount, markRead, markAllRead, enabled } = useNotifications(12);
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close, buttonRef);

  if (!enabled) return null;

  const openItem = (n: AppNotification) => {
    void markRead(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          unreadCount
            ? t("shell.notificationsUnread", { count: unreadCount })
            : t("shell.notifications")
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="notification-bell"
        className="sl-icon-btn"
      >
        <Bell size={18} aria-hidden />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 min-w-[1.125rem] rounded-full bg-[color:var(--color-danger)] px-1 text-center text-[0.625rem] font-bold leading-[1.125rem] text-[color:var(--color-white)] ring-2 ring-[color:var(--color-page)]"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("shell.latestNotifications")}
          className="sl-popover sl-anim-pop absolute right-0 z-50 mt-2 w-[min(92vw,22rem)] overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="sl-h2 text-base">{t("shell.notifications")}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-nav-hover disabled:opacity-50"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
            >
              <CheckCheck size={14} aria-hidden />
              {t("shell.markAllRead")}
            </button>
          </div>
          <ul className="sl-scroll max-h-96 overflow-auto px-2 pb-2">
            {items.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-ink-muted">
                {t("shell.nothingNew")}
              </li>
            )}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left hover:bg-nav-hover ${
                    n.readAt ? "opacity-70" : ""
                  }`}
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[n.level]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`block truncate text-sm text-ink ${n.readAt ? "" : "font-semibold"}`}
                      >
                        {n.title}
                      </span>
                      {isNudge(n) && (
                        <span className="sl-chip !px-2 !py-0 text-[0.625rem]">
                          {t("shell.nudge")}
                        </span>
                      )}
                    </span>
                    {n.body && (
                      <span className="block truncate text-xs text-ink-muted">{n.body}</span>
                    )}
                    <span className="block text-[0.6875rem] text-ink-subtle">
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line-soft p-2">
            <button
              type="button"
              className="w-full rounded-[12px] px-3 py-2.5 text-center text-sm font-semibold text-accent hover:bg-nav-hover"
              onClick={() => {
                setOpen(false);
                navigate("/notifications");
              }}
            >
              {t("shell.viewAllNotifications")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsMenu;
