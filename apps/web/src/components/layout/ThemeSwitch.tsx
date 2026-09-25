import React from "react";
import { Moon, Sun } from "lucide-react";

import { useTheme } from "../../providers/ThemeProvider";

/** Round top-bar button that flips between the light (default) and dark themes. */
const ThemeSwitch: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { mode, toggle } = useTheme();
  const dark = mode === "dark";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`sl-icon-btn ${className}`}
    >
      {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
};

export default ThemeSwitch;
