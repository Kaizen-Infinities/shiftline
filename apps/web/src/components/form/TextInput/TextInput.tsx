import React, { useId } from "react";
import { FieldError, RequiredMark, fieldControlClasses, fieldLabelClass } from "../fieldStyles";

interface TextInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "size"
> {
  label?: string;
  name: string;
  type?: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  bottom?: boolean;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  step?: number | string;
  error?: string;
  disabled?: boolean;
  preventNegative?: boolean;
  as?: "input" | "textarea";
  rows?: number;
  inputClassName?: string;
  labelClassName?: string;
  horizontal?: boolean;
  onChange?: (event: any) => void;
}

/** Text / number / textarea field: label above, `.sl-input` box, error tied by aria-describedby. */
const TextInput: React.FC<TextInputProps> = ({
  label,
  name,
  value,
  type,
  step,
  placeholder,
  required = false,
  icon,
  trailingIcon,
  bottom,
  error,
  disabled = false,
  preventNegative,
  inputClassName = "",
  labelClassName = "",
  horizontal = false,
  onChange,
  onKeyDown,
  onPaste,
  onFocus,
  as = "input",
  rows = 3,
  ...rest
}) => {
  const generatedId = useId();
  const inputId = rest.id ?? name;
  const errorId = `${generatedId}-error`;
  const isNumberType = type === "number";
  const shouldPreventNegative = preventNegative || isNumberType;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (
      shouldPreventNegative &&
      (e.key === "-" || e.key === "e" || e.key === "E" || e.key === "+")
    ) {
      e.preventDefault();
    }
    onKeyDown?.(e as React.KeyboardEvent<HTMLInputElement>);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (shouldPreventNegative) {
      const pasted = e.clipboardData.getData("text");
      if (/^-/.test(pasted) || Number(pasted) < 0) {
        e.preventDefault();
      }
    }
    onPaste?.(e as React.ClipboardEvent<HTMLInputElement>);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange?.(e as React.ChangeEvent<HTMLInputElement>);
  };

  const describedBy = error ? errorId : rest["aria-describedby"];

  return (
    <div
      className={`${bottom ? "mb-[18px]" : ""} group min-w-0 ${horizontal ? "flex flex-col sm:flex-row sm:items-start sm:gap-3" : ""}`}
    >
      {label && (
        <label htmlFor={inputId} className={fieldLabelClass(horizontal, labelClassName)}>
          {icon && <span className="sl-label-icon">{icon}</span>}
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div className={`flex min-w-0 flex-col ${horizontal ? "flex-1" : ""}`}>
        <div className="relative">
          {as === "textarea" ? (
            <textarea
              {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
              id={inputId}
              name={name}
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              disabled={disabled}
              aria-required={required || undefined}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              rows={rows}
              className={fieldControlClasses({
                invalid: Boolean(error),
                className: `min-h-11 resize-y px-4 py-2.5 leading-relaxed ${inputClassName}`,
              })}
            />
          ) : (
            <input
              {...rest}
              id={inputId}
              type={type || "text"}
              name={name}
              value={value}
              placeholder={placeholder}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={(e) => {
                // Typing over an auto-filled number replaces it instead of appending.
                if (isNumberType) e.currentTarget.select();
                onFocus?.(e);
              }}
              min={isNumberType ? (rest.min ?? "0") : rest.min}
              step={step}
              disabled={disabled}
              aria-required={required || undefined}
              aria-invalid={Boolean(error)}
              aria-describedby={describedBy}
              autoComplete="off"
              className={fieldControlClasses({
                invalid: Boolean(error),
                className: `h-11 px-4 leading-normal
                [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none
                [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_var(--color-card)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-ink)]
                ${isNumberType ? "tabular-nums" : ""}
                ${trailingIcon ? "pr-10" : ""}
                ${inputClassName}`,
              })}
            />
          )}

          {trailingIcon && (
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-ink-subtle">
              {trailingIcon}
            </div>
          )}
        </div>

        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </div>
  );
};

export default TextInput;
