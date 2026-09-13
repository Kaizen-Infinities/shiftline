import React from "react";
import { FiEye } from "react-icons/fi";

interface ViewButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  onMouseEnter?: () => void;
}

const ViewButton: React.FC<ViewButtonProps> = ({ onClick, disabled, onMouseEnter }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      disabled={disabled}
      aria-label="View"
      title="View"
      className="w-7 h-7 flex items-center justify-center rounded-sm border border-line bg-card text-ink-muted transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
    >
      <FiEye className="text-[13px]" />
    </button>
  );
};

export default ViewButton;
