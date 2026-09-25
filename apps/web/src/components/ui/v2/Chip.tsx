import React from "react";
import { cx } from "./cx";

export type ChipTone = "default" | "muted" | "success" | "warning" | "danger" | "info";
export type ChipSize = "sm" | "md" | "lg";

const TONE: Record<ChipTone, string> = {
  default: "",
  muted: "sl-chip-muted",
  success: "sl-chip-success",
  warning: "sl-chip-warning",
  danger: "sl-chip-danger",
  info: "sl-chip-info",
};

const SIZE: Record<ChipSize, string> = {
  sm: "sl-chip-sm",
  md: "",
  lg: "sl-chip-lg",
};

/** Class string for a chip, for styling other elements (a `<Link>`) like one. */
export const chipClass = ({
  tone = "default",
  size = "md",
  className,
}: { tone?: ChipTone; size?: ChipSize; className?: string } = {}): string =>
  cx("sl-chip", TONE[tone], SIZE[size], className);

export interface ChipProps extends Omit<React.HTMLAttributes<HTMLElement>, "onClick"> {
  tone?: ChipTone;
  size?: ChipSize;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Small status dot in the chip's colour before the label. */
  dot?: boolean;
  /** A count badge after the label ("Pending 4"). */
  count?: React.ReactNode;
  /** Pressed state when the chip is a toggle (renders aria-pressed). */
  selected?: boolean;
  /** Makes the chip a toggle button. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

/** Pale-blue pill for statuses, tags and filters; a toggle button with aria-pressed when clickable. */
export const Chip: React.FC<ChipProps> = ({
  tone = "default",
  size = "md",
  icon,
  dot = false,
  count,
  selected,
  onClick,
  disabled,
  className,
  children,
  ...rest
}) => {
  const content = (
    <>
      {dot && <span className="sl-chip-dot" aria-hidden="true" />}
      {icon && (
        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
      {count !== undefined && count !== null && <span className="sl-chip-count">{count}</span>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={Boolean(selected)}
        disabled={disabled}
        onClick={onClick}
        className={chipClass({ tone, size, className })}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={chipClass({ tone, size, className })} {...rest}>
      {content}
    </span>
  );
};

export default Chip;
