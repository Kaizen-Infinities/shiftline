import React from "react";
import { Link } from "react-router-dom";
import { Keyboard, Menu, Search } from "lucide-react";
import { useT } from "../../i18n/I18nProvider";

import { BrandMark } from "../brand/BrandMark";
import { useCommandPalette } from "../command-palette/paletteContext";
import { useBreadcrumbs } from "../../navigation/useNav";
import Breadcrumbs from "./Breadcrumbs";
import LiveStatus from "./LiveStatus";
import NotificationsMenu from "./NotificationsMenu";
import ProfileMenu from "./ProfileMenu";
import ThemeSwitch from "./ThemeSwitch";

interface TopBarProps {
  onOpenMenu: () => void;
  menuButtonRef: React.Ref<HTMLButtonElement>;
  onOpenShortcuts: () => void;
}

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Top bar: breadcrumb (the page title on phones), the search field that opens the command
 * palette, live status, theme, notifications and the account menu.
 */
const TopBar: React.FC<TopBarProps> = ({ onOpenMenu, menuButtonRef, onOpenShortcuts }) => {
  const crumbs = useBreadcrumbs();
  const { openPalette } = useCommandPalette();
  const { t } = useT();
  const modKey = isMac() ? "⌘" : "Ctrl";

  return (
    <header className="z-30 flex h-16 shrink-0 items-center gap-2 bg-page/85 px-3 backdrop-blur-md sm:gap-3 sm:px-5 lg:h-[76px] lg:px-8">
      <button
        ref={menuButtonRef}
        type="button"
        onClick={onOpenMenu}
        aria-label={t("shell.openNavigation")}
        className="sl-icon-btn sl-icon-btn-plain lg:hidden"
      >
        <Menu size={22} aria-hidden />
      </button>
      <Link to="/dashboard" aria-label={t("shell.home")} className="shrink-0 lg:hidden">
        <BrandMark size={34} />
      </Link>

      <div className="min-w-0 flex-1 pl-1 lg:pl-0">
        <Breadcrumbs crumbs={crumbs} />
      </div>

      <button
        type="button"
        onClick={openPalette}
        className="sl-search-trigger hidden w-[min(22rem,24vw)] shrink-0 md:flex"
        aria-label={t("shell.searchScreens")}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search size={17} aria-hidden className="shrink-0" />
        <span className="flex-1 truncate text-left">{t("shell.searchPlaceholder")}</span>
        <span className="flex items-center gap-1" aria-hidden>
          <span className="sl-kbd">{modKey}</span>
          <span className="sl-kbd">K</span>
        </span>
      </button>
      <button
        type="button"
        onClick={openPalette}
        aria-label={t("shell.searchScreens")}
        className="sl-icon-btn md:hidden"
      >
        <Search size={18} aria-hidden />
      </button>

      <LiveStatus className="hidden 2xl:inline-flex" />
      <button
        type="button"
        onClick={onOpenShortcuts}
        aria-label={t("shell.keyboardShortcuts")}
        title={t("shell.keyboardShortcutsF1")}
        className="sl-icon-btn hidden lg:inline-flex"
      >
        <Keyboard size={18} aria-hidden />
      </button>
      <ThemeSwitch className="hidden sm:inline-flex" />
      <NotificationsMenu />
      <ProfileMenu onOpenShortcuts={onOpenShortcuts} />
    </header>
  );
};

export default TopBar;
