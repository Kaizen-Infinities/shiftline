import type { MouseEventHandler } from "react";
import type { IconType } from "react-icons";

import "./custom-button.css";

interface CustomButtonProps {
  text: string;
  icon?: IconType;

  type?: "button" | "submit" | "reset";

  variant?:
    | "primary"
    | "secondary"
    | "success"
    | "warning"
    | "danger"
    | "info"
    | "outline"
    | "ghost"
    | "dark";

  size?: "sm" | "md" | "lg";

  width?: string;

  disabled?: boolean;

  loading?: boolean;

  className?: string;

  onClick?: MouseEventHandler<HTMLButtonElement>;
}

/* Each legacy variant maps onto a concept pill; the custom-btn--* classes stay for callers
   and for the few tones (warning, dark) that have no .sl-* equivalent. */
const pillClass: Record<NonNullable<CustomButtonProps["variant"]>, string> = {
  primary: "sl-cta",
  success: "sl-cta",
  secondary: "sl-btn",
  outline: "sl-btn",
  ghost: "sl-btn-ghost",
  danger: "sl-btn-danger",
  info: "sl-btn-blue",
  warning: "",
  dark: "",
};

const sizeClass: Record<NonNullable<CustomButtonProps["size"]>, string> = {
  sm: "sl-pill-sm",
  md: "sl-pill-md",
  lg: "sl-pill-lg",
};

/** Legacy pill button with nine variants; all render as concept pills. */
const CustomButton = ({
  text,
  icon: Icon,
  type = "button",
  variant = "primary",
  size = "md",
  width = "fit-content",
  disabled = false,
  loading = false,
  className = "",
  onClick,
}: CustomButtonProps) => {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading || undefined}
      style={{ width }}
      className={`custom-btn custom-btn--${variant} custom-btn--${size} ${pillClass[variant]} ${sizeClass[size]} ${loading ? "custom-btn--loading" : ""} ${className}`}
    >
      {loading ? (
        <span className="sl-spinner" role="status" aria-hidden="true" />
      ) : (
        Icon && (
          <Icon className="custom-btn-icon" size={size === "lg" ? 19 : size === "sm" ? 15 : 17} />
        )
      )}

      <span className="custom-btn-text">{text}</span>
    </button>
  );
};

export default CustomButton;
