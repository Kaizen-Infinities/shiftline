import React from "react";
import { LuSunMedium, LuMoonStar } from "react-icons/lu";
import { useTheme } from "../../providers/ThemeProvider";

/** Round icon pill that switches between the light and dark theme. */
const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { mode, toggle } = useTheme();
  const isDark = mode === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className={`sl-icon-btn sl-icon-btn-md group ${className}`}
    >
      {isDark ? (
        <LuSunMedium
          aria-hidden="true"
          className="text-[17px] text-[color:var(--color-warning)] transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none"
        />
      ) : (
        <LuMoonStar
          aria-hidden="true"
          className="text-[16px] transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none"
        />
      )}
    </button>
  );
};

export default ThemeToggle;
