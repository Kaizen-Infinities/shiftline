import React, { useId } from "react";
import { Form } from "../../ui/TailwindPrimitives";

import "./RadioInput.css";
interface RadioOption {
  label: string;
  value: string;
}

interface RadioGroupProps {
  label: string;
  name: string;
  value: string;
  options: RadioOption[];
  required?: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Labelled group of radios laid out in a row. */
const RadioGroup: React.FC<RadioGroupProps> = ({
  label,
  name,
  value,
  options,
  required = false,
  onChange,
}) => {
  const labelId = useId();
  return (
    <Form.Group className="radio-group" role="radiogroup" aria-labelledby={labelId}>
      <Form.Label id={labelId} className="radio-label">
        {label}

        {required && (
          <span className="required-star sl-required" aria-hidden="true">
            *
          </span>
        )}
      </Form.Label>

      <div className="radio-options">
        {options.map((option) => (
          <Form.Check
            key={option.value}
            type="radio"
            name={name}
            label={option.label}
            value={option.value}
            checked={value === option.value}
            onChange={onChange}
            className="custom-radio"
          />
        ))}
      </div>
    </Form.Group>
  );
};

export default RadioGroup;
