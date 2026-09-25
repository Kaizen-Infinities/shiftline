import React from "react";
import { Mail } from "lucide-react";

interface EmailButtonProps {
  onClick?: () => void;
  disabled?: boolean;
}

const EmailButton: React.FC<EmailButtonProps> = ({ onClick, disabled }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sl-icon-btn sl-icon-btn-tone-warning"
      title="Email"
      aria-label="Email"
    >
      <Mail size={15} aria-hidden="true" />
    </button>
  );
};

export default EmailButton;
