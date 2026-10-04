import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { cx } from "./cx";

export interface PageCrumb {
  label: React.ReactNode;
  /** Router path; the last crumb is usually the current page and has none. */
  to?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  /** One line of context under the title. */
  subtitle?: React.ReactNode;
  /** The screen's one primary action, usually an `<ActionPill>` (green CTA). */
  primaryAction?: React.ReactNode;
  /** Secondary actions (white pills, icon pills), shown before the primary action. */
  actions?: React.ReactNode;
  breadcrumbs?: PageCrumb[];
  /** Shows a round back button: a router path, or a handler (e.g. `() => navigate(-1)`). */
  back?: string | (() => void);
  backLabel?: string;
  /** Chips or other meta shown next to the title (e.g. a status chip). */
  meta?: React.ReactNode;
  /** Optional leading icon in a pale-blue tile. */
  icon?: React.ReactNode;
  /** Content under the header row, e.g. `<ChipTabs>` or a `<Toolbar>`. */
  children?: React.ReactNode;
  className?: string;
}

/** Page title block: breadcrumb/back, `.sl-h1` title, one line of context and the actions on the right. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  primaryAction,
  actions,
  breadcrumbs,
  back,
  backLabel = "Back",
  meta,
  icon,
  children,
  className,
}) => {
  const backButton =
    back === undefined ? null : typeof back === "string" ? (
      <Link
        to={back}
        aria-label={backLabel}
        title={backLabel}
        className="sl-icon-btn sl-icon-btn-md"
      >
        <ArrowLeft size={18} aria-hidden="true" />
      </Link>
    ) : (
      <button
        type="button"
        onClick={back}
        aria-label={backLabel}
        title={backLabel}
        className="sl-icon-btn sl-icon-btn-md"
      >
        <ArrowLeft size={18} aria-hidden="true" />
      </button>
    );

  return (
    <header className={cx("sl-page-header flex flex-col gap-4", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        // From lg up the top bar already shows the full trail; below it the top bar
        // shows only the current page, so the trail is repeated here.
        <nav aria-label="Breadcrumb" className="-mb-1 lg:hidden">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] font-medium text-ink-subtle">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;
              return (
                <li key={index} className="flex items-center gap-1">
                  {crumb.to && !last ? (
                    <Link
                      to={crumb.to}
                      className="relative rounded-full px-1 before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] hover:text-ink hover:underline underline-offset-4"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className={last ? "text-ink-muted" : undefined}
                      aria-current={last ? "page" : undefined}
                    >
                      {crumb.label}
                    </span>
                  )}
                  {!last && <ChevronRight size={14} aria-hidden="true" className="opacity-70" />}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* On a narrow screen the title block can wrap, so the back button sits level with
            the title's first line rather than the middle of the block. */}
        <div className="flex min-w-0 items-start gap-3 sm:items-center">
          {backButton}
          {icon && (
            <span
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-chip text-accent sm:flex"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="sl-h1 m-0 leading-tight [overflow-wrap:anywhere] sm:truncate">
                {title}
              </h1>
              {meta}
            </div>
            {subtitle && <p className="sl-muted m-0 mt-1 text-sm leading-snug">{subtitle}</p>}
          </div>
        </div>

        {(actions || primaryAction) && (
          <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0 sm:justify-end">
            {actions}
            {primaryAction}
          </div>
        )}
      </div>

      {children}
    </header>
  );
};

export default PageHeader;
