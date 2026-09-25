import React from "react";
import { AlertCircle } from "lucide-react";

/**
 * Shared look for the form components (UI v2): label above the control, the calm
 * `.sl-input` box, a required marker and an error line tied to the control by id.
 */

const cx = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

/** Label classes; `horizontal` puts the label beside the control from 640px up. */
export const fieldLabelClass = (horizontal = false, extra = "") =>
  cx(
    "sl-label transition-colors group-focus-within:text-[color:var(--color-primary)]",
    horizontal && "sm:mb-0 sm:w-[140px] sm:shrink-0 sm:pt-[11px]",
    extra
  );

/** Control classes for an input-like box (input, trigger button or wrapper). */
export const fieldControlClasses = ({
  invalid = false,
  open = false,
  disabled = false,
  className = "",
}: {
  invalid?: boolean;
  open?: boolean;
  disabled?: boolean;
  className?: string;
} = {}) =>
  cx("sl-input", invalid && "is-invalid", open && "is-open", disabled && "is-disabled", className);

/** Option row classes for dropdown menus. */
export const optionClasses = ({
  highlighted = false,
  selected = false,
  disabled = false,
  className = "",
}: {
  highlighted?: boolean;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
} = {}) =>
  cx(
    "sl-option",
    highlighted && "is-highlighted",
    selected && "is-selected",
    disabled && "is-disabled",
    className
  );

/** The red asterisk after a required field's label. */
export const RequiredMark: React.FC = () => (
  <span className="sl-required" aria-hidden="true">
    *
  </span>
);

/** Error line under a control; give it the id the control's aria-describedby points at. */
export const FieldError: React.FC<{
  id?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ id, children, className = "" }) => (
  <p id={id} role="alert" className={cx("sl-field-error m-0", className)}>
    <AlertCircle size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </p>
);
