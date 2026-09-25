import React, { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Keyboard, LogOut, Moon, Sun, User } from "lucide-react";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import { usePermission } from "../../hooks/usePermission";
import { logoutUser } from "../../features/auth/authSlice";
import { useTheme } from "../../providers/ThemeProvider";
import ShellDialog from "./ShellDialog";
import { menuKeyNav, useDismiss } from "./useDismiss";

const initialsOf = (name?: string | null): string => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

type ShellUser = {
  fullName?: string | null;
  username?: string | null;
  isSuperAdmin?: boolean;
  roleId?: string | null;
  role?: unknown;
  avatarUrl?: string | null;
  profilePicture?: string | null;
  photoUrl?: string | null;
  profileImage?: string | null;
};

const roleLabel = (user?: ShellUser | null): string => {
  if (!user) return "User";
  if (user.isSuperAdmin) return "Platform admin";
  const role = user.role as { name?: string } | string | undefined;
  const value = (typeof role === "object" && role?.name) || user.roleId || role;
  if (typeof value !== "string" || !value) return "User";
  const text = value
    .replace(/^ROLE_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const avatarOf = (user?: ShellUser | null) =>
  user?.avatarUrl || user?.profilePicture || user?.photoUrl || user?.profileImage || null;

/** The avatar circle: the person's photo, or their initials on the brand blue. */
export const Avatar: React.FC<{ user?: ShellUser | null; size?: number }> = ({
  user,
  size = 36,
}) => {
  const src = avatarOf(user);
  const name = user?.fullName || user?.username || "User";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand font-bold text-[color:var(--color-white)]"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
};

interface ProfileMenuProps {
  onOpenShortcuts: () => void;
  /** Compact trigger (avatar only) for small screens. */
  compact?: boolean;
}

/** Avatar button with the person's name and a menu: profile, notifications, theme, sign out. */
const ProfileMenu: React.FC<ProfileMenuProps> = ({ onOpenShortcuts, compact = false }) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((s) => s.auth);
  const company = useAppSelector((s) => s.company.data);
  const { can, isSuperAdmin } = usePermission();
  const { mode, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close, buttonRef);

  const name = user?.fullName || user?.username || "User";
  const role = roleLabel(user);
  const profilePath = can("profile.view") ? "/profile" : "/company/view";

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  const signOut = async () => {
    setConfirmOut(false);
    await dispatch(logoutUser());
    navigate("/login");
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() =>
              rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
            );
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className={`flex items-center gap-2.5 rounded-full border border-line-soft bg-card shadow-[var(--shadow-sm)] transition-colors hover:bg-nav-hover ${
          compact ? "p-1" : "py-1 pl-1 pr-3"
        }`}
      >
        <Avatar user={user} size={compact ? 34 : 34} />
        {!compact && (
          <>
            <span className="hidden min-w-0 flex-col text-left leading-tight xl:flex">
              <span className="max-w-[10rem] truncate text-sm font-semibold text-ink">{name}</span>
              <span className="max-w-[10rem] truncate text-xs text-ink-subtle">{role}</span>
            </span>
            <ChevronDown
              size={16}
              aria-hidden
              className={`text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          onKeyDown={menuKeyNav}
          // Tells the global "Esc goes back" shortcut that an overlay is open.
          data-radix-popper-content-wrapper=""
          className="sl-popover sl-anim-pop absolute right-0 z-50 mt-2 w-64 p-2"
        >
          <div className="mb-1 flex items-center gap-3 rounded-[14px] bg-card-2 p-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{name}</div>
              <div className="truncate text-xs text-ink-subtle">
                {role}
                {!isSuperAdmin && company?.companyName ? ` · ${company.companyName}` : ""}
              </div>
            </div>
          </div>
          {!isSuperAdmin && (
            <>
              <button
                type="button"
                role="menuitem"
                className="sl-menu-item"
                onClick={() => go(profilePath)}
              >
                <User size={17} aria-hidden className="text-ink-subtle" />
                My profile
              </button>
              <button
                type="button"
                role="menuitem"
                className="sl-menu-item"
                onClick={() => go("/notifications")}
              >
                <Bell size={17} aria-hidden className="text-ink-subtle" />
                Notifications
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className="sl-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenShortcuts();
            }}
          >
            <Keyboard size={17} aria-hidden className="text-ink-subtle" />
            Keyboard shortcuts
            <span className="sl-kbd ml-auto">F1</span>
          </button>
          <button type="button" role="menuitem" className="sl-menu-item" onClick={toggle}>
            {mode === "dark" ? (
              <Sun size={17} aria-hidden className="text-ink-subtle" />
            ) : (
              <Moon size={17} aria-hidden className="text-ink-subtle" />
            )}
            {mode === "dark" ? "Light theme" : "Dark theme"}
          </button>
          <div className="my-1 h-px bg-line-soft" />
          <button
            type="button"
            role="menuitem"
            className="sl-menu-item !text-[color:var(--color-danger)]"
            onClick={() => {
              setOpen(false);
              setConfirmOut(true);
            }}
          >
            <LogOut size={17} aria-hidden />
            Sign out
          </button>
        </div>
      )}

      <ShellDialog
        open={confirmOut}
        title="Sign out of Shiftline?"
        confirmText="Sign out"
        onConfirm={() => void signOut()}
        onCancel={() => setConfirmOut(false)}
      >
        You will need your email and password to come back in.
      </ShellDialog>
    </div>
  );
};

export default ProfileMenu;
