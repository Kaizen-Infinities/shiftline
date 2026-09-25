import React, { forwardRef } from "react";
import { cx } from "./cx";

export type ActionPillVariant = "cta" | "secondary" | "blue" | "danger" | "ghost";
export type ActionPillSize = "sm" | "md" | "lg" | "xl";

const VARIANT: Record<ActionPillVariant, string> = {
  cta: "sl-cta",
  secondary: "sl-btn",
  blue: "sl-btn-blue",
  danger: "sl-btn-danger",
  ghost: "sl-btn-ghost",
};

const SIZE: Record<ActionPillSize, string> = {
  sm: "sl-pill-sm",
  md: "sl-pill-md",
  lg: "sl-pill-lg",
  // The hero CTA ("Run Payroll"): the foundation's large pill.
  xl: "sl-cta-lg",
};

export interface ActionPillClassOptions {
  variant?: ActionPillVariant;
  size?: ActionPillSize;
  fullWidth?: boolean;
  className?: string;
}

/** Class string for an action pill, for styling a router `<Link>` or `<a>` like a button. */
export const actionPillClass = ({
  variant = "cta",
  size = "md",
  fullWidth = false,
  className,
}: ActionPillClassOptions = {}): string =>
  cx(VARIANT[variant], SIZE[size], fullWidth && "w-full", className);

export interface ActionPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `cta` is the green primary pill; `secondary` white; `blue` brand; `danger` destructive. */
  variant?: ActionPillVariant;
  size?: ActionPillSize;
  /** Leading icon (any node, e.g. `<Plus size={18} />`). */
  icon?: React.ReactNode;
  /** Trailing icon, e.g. a chevron. */
  iconRight?: React.ReactNode;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  /** Label while loading; defaults to the normal label. */
  loadingText?: React.ReactNode;
  fullWidth?: boolean;
}

/** The pill button: green `.sl-cta` for the one primary action, or a secondary/blue/danger pill. */
export const ActionPill = forwardRef<HTMLButtonElement, ActionPillProps>(function ActionPill(
  {
    variant = "cta",
    size = "md",
    icon,
    iconRight,
    loading = false,
    loadingText,
    fullWidth = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={actionPillClass({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? (
        <span className="sl-spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {(loading && loadingText) || children ? (
        <span className="truncate">{loading && loadingText ? loadingText : children}</span>
      ) : null}
      {iconRight && !loading ? (
        <span className="inline-flex shrink-0 items-center" aria-hidden="true">
          {iconRight}
        </span>
      ) : null}
    </button>
  );
});

export default ActionPill;
