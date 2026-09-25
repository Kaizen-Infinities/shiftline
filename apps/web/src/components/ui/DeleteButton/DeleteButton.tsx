import React from "react";
import { FiTrash2 } from "react-icons/fi";
import { toast } from "react-toastify";

interface DeleteButtonProps {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  disabledMessage?: string;
}

const DeleteButton: React.FC<DeleteButtonProps> = ({ onClick, disabled, disabledMessage }) => {
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
      aria-label="Delete"
      title="Delete"
      aria-disabled={disabled || undefined}
      className="sl-icon-btn sl-icon-btn-hover-danger"
    >
      <FiTrash2 className="text-[14px]" aria-hidden="true" />
    </button>
  );
};

export default DeleteButton;
