import React from "react";
import { cx } from "./cx";

export type TilePadding = "none" | "sm" | "md" | "lg";

const PAD: Record<TilePadding, string> = {
  none: "",
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-7",
};

const HEADER_PAD: Record<TilePadding, string> = {
  none: "px-4 pt-4 pb-3 sm:px-5",
  sm: "px-3 pt-3 sm:px-4 sm:pt-4",
  md: "px-4 pt-4 sm:px-5 sm:pt-5",
  lg: "px-5 pt-5 sm:px-7 sm:pt-6",
};

export interface TileProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Element to render; defaults to `section` when titled, else `div`. */
  as?: React.ElementType;
  padding?: TilePadding;
  /** Header title (`.sl-h2`). */
  title?: React.ReactNode;
  /** One line under the title. */
  subtitle?: React.ReactNode;
  /** Right side of the header: chips, icon pills or a small button. */
  actions?: React.ReactNode;
  /** Small icon before the title. */
  icon?: React.ReactNode;
  /** Lifts on hover (for clickable tiles). */
  interactive?: boolean;
  /** Draws a hairline under the header. */
  divider?: boolean;
  bodyClassName?: string;
}

/** The white rounded tile (`.sl-tile`) with padding variants and an optional header. */
export const Tile: React.FC<TileProps> = ({
  as,
  padding = "md",
  title,
  subtitle,
  actions,
  icon,
  interactive = false,
  divider = false,
  className,
  bodyClassName,
  children,
  ...rest
}) => {
  const hasHeader = Boolean(title || subtitle || actions);
  const Component: React.ElementType = as ?? (hasHeader ? "section" : "div");
  const titleId = React.useId();

  if (!hasHeader) {
    return (
      <Component
        className={cx("sl-tile", interactive && "sl-tile-hover", PAD[padding], className)}
        {...rest}
      >
        {children}
      </Component>
    );
  }

  return (
    <Component
      aria-labelledby={title ? titleId : undefined}
      className={cx("sl-tile", interactive && "sl-tile-hover", className)}
      {...rest}
    >
      <div
        className={cx(
          "flex flex-wrap items-start justify-between gap-3",
          HEADER_PAD[padding],
          divider && "border-b border-line-soft pb-3 sm:pb-4"
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {icon && (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-chip text-accent"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="sl-h2 m-0 leading-snug">
                {title}
              </h2>
            )}
            {subtitle && <p className="sl-muted m-0 mt-0.5 text-sm">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div
        className={cx(
          padding === "none" ? "" : PAD[padding],
          padding !== "none" && !divider && "pt-3 sm:pt-4",
          bodyClassName
        )}
      >
        {children}
      </div>
    </Component>
  );
};

export default Tile;
