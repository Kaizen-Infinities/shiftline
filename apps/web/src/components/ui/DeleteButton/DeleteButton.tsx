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
      className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-card text-ink-muted transition-colors hover:border-[color:var(--color-danger)]/40 hover:bg-[color:var(--color-danger)]/10 hover:text-[color:var(--color-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-card disabled:hover:text-ink-muted"
    >
      <FiTrash2 className="text-[13px]" />
    </button>
  );
};

export default DeleteButton;
