import type { MouseEventHandler } from "react";
import type { IconType } from "react-icons";

interface CustomButtonProps {
  text: string;
  icon?: IconType;
  type?: "button" | "submit" | "reset";
  size?: "sm" | "md" | "lg";
  /** primary = the green CTA pill, secondary = white pill, danger = destructive pill. */
  variant?: "primary" | "secondary" | "danger";
  width?: string;
  disabled?: boolean;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Shows a spinner in place of the icon and disables the button. */
  loading?: boolean;
  /** Tooltip / accessible description. */
  title?: string;
}

const sizeClasses: Record<
  NonNullable<CustomButtonProps["size"]>,
  { container: string; iconSize: number }
> = {
  sm: { container: "sl-pill-sm", iconSize: 15 },
  md: { container: "sl-pill-md", iconSize: 17 },
  lg: { container: "sl-pill-lg", iconSize: 19 },
};

const variantClasses: Record<NonNullable<CustomButtonProps["variant"]>, string> = {
  primary: "sl-cta",
  secondary: "sl-btn",
  danger: "sl-btn-danger",
};

/** Pill button used across the app: green CTA (primary), white pill (secondary) or danger. */
const Button = ({
  text,
  icon: Icon,
  type = "button",
  size = "sm",
  variant = "primary",
  width = "fit-content",
  disabled = false,
  className = "",
  onClick,
  loading = false,
  title,
}: CustomButtonProps) => {
  const { container, iconSize } = sizeClasses[size];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
      aria-busy={loading || undefined}
      style={{ width }}
      className={`${variantClasses[variant]} ${container} max-w-full ${className}`}
    >
      {loading ? (
        <span className="sl-spinner" aria-hidden="true" />
      ) : (
        Icon && <Icon className="shrink-0" size={iconSize} aria-hidden="true" />
      )}
      <span className="truncate">{text}</span>
    </button>
  );
};

export default Button;
