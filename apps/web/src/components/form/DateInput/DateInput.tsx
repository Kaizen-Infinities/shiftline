import React from "react";
import { RequiredMark, fieldControlClasses, fieldLabelClass } from "../fieldStyles";

interface DateInputProps {
  label: string;
  name: string;
  value: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  icon?: React.ReactNode;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Native date field in the `.sl-input` style with the label above. */
const DateInput: React.FC<DateInputProps> = ({
  label,
  name,
  value,
  min,
  required = false,
  disabled = false,
  icon,
  onChange,
}) => {
  return (
    <div className="group mb-[18px] flex w-full flex-col">
      <label htmlFor={name} className={fieldLabelClass()}>
        {icon && <span className="sl-label-icon">{icon}</span>}
        <span>{label}</span>
        {required && <RequiredMark />}
      </label>

      <input
        id={name}
        type="date"
        name={name}
        value={value}
        onChange={onChange}
        disabled={disabled}
        min={min}
        aria-required={required || undefined}
        className={fieldControlClasses({ className: "h-11 px-4 tabular-nums" })}
      />
    </div>
  );
};

export default DateInput;
