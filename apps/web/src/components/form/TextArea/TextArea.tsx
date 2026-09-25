import React, { useId } from "react";
import { FieldError, RequiredMark, fieldControlClasses, fieldLabelClass } from "../fieldStyles";

interface TextAreaProps {
  label: string;
  name: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  icon?: React.ReactNode;
  rows?: number;
  error?: string;
  disabled?: boolean;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

/** Multi-line field: label above, `.sl-input` box that grows vertically, error tied by id. */
const TextArea: React.FC<TextAreaProps> = ({
  label,
  name,
  value,
  placeholder,
  required = false,
  icon,
  rows = 4,
  error,
  disabled = false,
  onChange,
}) => {
  const errorId = `${useId()}-error`;
  return (
    <div className="group mb-[18px] min-w-0">
      {label && (
        <label htmlFor={name} className={fieldLabelClass()}>
          {icon && <span className="sl-label-icon">{icon}</span>}
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <textarea
        id={name}
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        disabled={disabled}
        rows={rows}
        aria-invalid={Boolean(error)}
        aria-required={required || undefined}
        aria-describedby={error ? errorId : undefined}
        className={fieldControlClasses({
          invalid: Boolean(error),
          className: "min-h-11 resize-y px-4 py-2.5 leading-relaxed",
        })}
      />

      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
};

export default TextArea;
