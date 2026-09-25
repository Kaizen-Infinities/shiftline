import React from "react";
import { MessageCircle } from "lucide-react";

interface WhatsappButtonProps {
  onClick?: () => void;
  disabled?: boolean;
}

const WhatsappButton: React.FC<WhatsappButtonProps> = ({ onClick, disabled }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sl-icon-btn sl-icon-btn-tone-success"
      title="WhatsApp"
      aria-label="WhatsApp"
    >
      <MessageCircle size={15} aria-hidden="true" />
    </button>
  );
};

export default WhatsappButton;
