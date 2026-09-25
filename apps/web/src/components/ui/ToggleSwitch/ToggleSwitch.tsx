import React from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
  label?: string;
  title?: string;
}

/** On/off switch: a pill track that turns green when on, with a white knob. */
const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  label,
  title,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 ease-in-out ${
        checked ? "border-transparent bg-[color:var(--color-success)]" : "border-line bg-line-soft"
      } ${disabled ? "cursor-not-allowed opacity-55" : "hover:brightness-[0.98]"}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow-[var(--shadow-sm)] ring-0 transition duration-200 ease-in-out motion-reduce:transition-none ${
          checked ? "translate-x-[22px]" : "translate-x-[3px]"
        }`}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
};

export default ToggleSwitch;
