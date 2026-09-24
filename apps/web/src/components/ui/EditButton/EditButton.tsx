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
      className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-card text-ink-muted transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-card disabled:hover:text-ink-muted"
    >
      <FiEdit2 className="text-[13px]" />
    </button>
  );
};

export default EditButton;
