import React from "react";
import { Search } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  /** Set false if this search box should always take full width (e.g. inside a modal) */
  fullWidthOnMobileOnly?: boolean;
  /** Accessible name; defaults to the placeholder. */
  ariaLabel?: string;
}

/** Rounded search `.sl-input` with a leading magnifier. */
const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
  fullWidthOnMobileOnly = true,
  ariaLabel,
}) => {
  return (
    <div
      className={`relative flex-grow ${fullWidthOnMobileOnly ? "lg:flex-grow-0" : ""} ${className}`}
    >
      <Search
        size={17}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
      />
      <input
        type="text"
        className={`sl-input h-11 w-full ${fullWidthOnMobileOnly ? "lg:w-72" : ""} pl-10 pr-4 text-sm`}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={value}
        onChange={onChange}
      />
    </div>
  );
};

export default SearchInput;
