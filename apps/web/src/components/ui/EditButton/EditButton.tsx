import React from "react";
import { FiEdit2 } from "react-icons/fi";
import { toast } from "react-toastify";

interface EditButtonProps {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  disabledMessage?: string;
}

const EditButton: React.FC<EditButtonProps> = ({ onClick, disabled, disabledMessage }) => {
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
      onClick={handleClick}
      disabled={disabled && !disabledMessage}
      aria-label="Edit"
      title="Edit"
      aria-disabled={disabled || undefined}
      className="sl-icon-btn sl-icon-btn-hover-primary"
    >
      <FiEdit2 className="text-[14px]" aria-hidden="true" />
    </button>
  );
};

export default EditButton;
