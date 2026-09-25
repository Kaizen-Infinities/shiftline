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
      className="sl-icon-btn sl-icon-btn-hover-primary"
    >
      <FiEye className="text-[14px]" aria-hidden="true" />
    </button>
  );
};

export default ViewButton;
