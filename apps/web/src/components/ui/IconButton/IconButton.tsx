import React from "react";
import "./IconButton.css";

interface IconButtonProps {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  icon: React.ElementType;
  variant?: "success" | "warning" | "danger" | "info" | "primary";
  title?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  /** Accessible name; defaults to `title`. */
  ariaLabel?: string;
}

/** Round tinted icon pill (row actions, toolbars); the tone says what the action does. */
const IconButton: React.FC<IconButtonProps> = ({
  onClick,
  icon: Icon,
  variant = "primary",
  title,
  disabled = false,
  className = "",
  size = "sm",
  ariaLabel,
}) => {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-${variant} icon-btn-${size} sl-icon-btn sl-icon-btn-tone-${variant} ${size === "md" ? "sl-icon-btn-md" : ""} ${className}`}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel ?? title}
      disabled={disabled}
    >
      <Icon className="icon-btn-icon" aria-hidden="true" />
    </button>
  );
};

export default IconButton;
