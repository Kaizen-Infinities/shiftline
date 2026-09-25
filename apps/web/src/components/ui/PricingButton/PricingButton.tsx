import React from "react";
import { FaTags } from "react-icons/fa";
import { toast } from "react-toastify";
import "./PricingButton.css";

interface PricingButtonProps {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  disabledMessage?: string;
  title?: string;
}

/** Round blue icon pill that opens raw-material pricing. */
const PricingButton: React.FC<PricingButtonProps> = ({
  onClick,
  disabled,
  disabledMessage,
  title = "View / revise raw material pricing",
}) => {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled && disabledMessage) {
      toast.warning(disabledMessage);
      return;
    }
    if (disabled) return;
    if (onClick) onClick(e);
  };

  return (
    <button
      type="button"
      className={`pricing-btn sl-icon-btn sl-icon-btn-tone-primary ${disabled ? "disabled" : ""}`}
      onClick={handleClick}
      disabled={disabled && !disabledMessage}
      aria-disabled={disabled || undefined}
      title={title}
      aria-label={title}
    >
      <FaTags className="pricing-btn-icon" aria-hidden="true" />
    </button>
  );
};

export default PricingButton;
