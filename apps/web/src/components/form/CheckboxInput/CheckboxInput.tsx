import React from "react";
import { Form } from "../../ui/TailwindPrimitives";

import "./CheckboxInput.css";

interface CheckboxProps {
  label: React.ReactNode;
  name: string;
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

/** A single checkbox with its label to the right. */
const Checkbox: React.FC<CheckboxProps> = ({ label, name, checked, onChange }) => {
  return (
    <Form.Group className="checkbox-group">
      <Form.Check
        type="checkbox"
        id={name}
        name={name}
        label={label}
        checked={checked}
        onChange={onChange}
        className="custom-checkbox"
      />
    </Form.Group>
  );
};

export default Checkbox;
