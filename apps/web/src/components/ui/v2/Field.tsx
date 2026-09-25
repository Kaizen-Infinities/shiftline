import React, { useId } from "react";
import { AlertCircle } from "lucide-react";
import { cx } from "./cx";

/** Class string for a single-line `.sl-input` control (44px tall), with the error state. */
export const fieldControlClass = (invalid?: boolean, className?: string): string =>
  cx("sl-input h-11", invalid && "is-invalid", className);

export interface FieldRenderProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export interface FieldProps {
  label?: React.ReactNode;
  /** Id of the control; generated when omitted. */
  htmlFor?: string;
  required?: boolean;
  /** Help text under the control. */
  hint?: React.ReactNode;
  /** Error text; marks the control invalid and ties the text to it. */
  error?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  /**
   * The control. A single element gets `id`, `aria-describedby` and `aria-invalid`
   * injected; a function receives those props to spread itself.
   */
  children: React.ReactElement | ((props: FieldRenderProps) => React.ReactNode);
}

/** Form field: label above, the control, then hint or error wired up with aria-describedby. */
export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  icon,
  className,
  children,
}) => {
  const generated = useId();
  const id = htmlFor ?? `field-${generated}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const controlProps: FieldRenderProps = {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
  };

  let control: React.ReactNode;
  if (typeof children === "function") {
    control = children(controlProps);
  } else {
    const existing = children.props as Record<string, unknown>;
    control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      id: (existing.id as string | undefined) ?? id,
      "aria-describedby":
        [existing["aria-describedby"] as string | undefined, describedBy]
          .filter(Boolean)
          .join(" ") || undefined,
      "aria-invalid": error ? true : existing["aria-invalid"],
    });
  }

  return (
    <div className={cx("min-w-0", className)}>
      {label && (
        <label htmlFor={id} className="sl-label">
          {icon && <span className="sl-label-icon">{icon}</span>}
          <span>{label}</span>
          {required && (
            <span className="sl-required" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {control}
      {error ? (
        <p id={errorId} role="alert" className="sl-field-error m-0">
          <AlertCircle size={14} className="mt-[3px] shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="sl-field-hint m-0">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export default Field;
