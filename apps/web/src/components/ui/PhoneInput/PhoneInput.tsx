import React, { useState, useRef, useEffect, type KeyboardEvent } from "react";
import PhoneInput, { isValidPhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import { X, ChevronDown, Check } from "lucide-react";
import { FieldError, RequiredMark, fieldLabelClass } from "../../form/fieldStyles";

export const validatePhoneNumber = (
  value: string | undefined,
  required: boolean = true
): string | null => {
  if (!value || value.trim() === "") {
    return required ? "Mobile Number is required" : null;
  }
  const digitsOnly = value.replace("+91", "").replace(/\D/g, "");
  if (digitsOnly.length !== 10) {
    return "Enter a valid 10-digit mobile number";
  }
  const formatted = `+91${digitsOnly}`;
  if (!isValidPhoneNumber(formatted)) {
    return "Enter a valid Indian mobile number";
  }
  return null;
};

/** Fixed set of phone-number types available in multi mode */
export const PHONE_ENTRY_TYPES = [
  "Primary Mobile Number",
  "Alternative Number",
  "WhatsApp Number",
] as const;
export type PhoneEntryType = (typeof PHONE_ENTRY_TYPES)[number];

/**
 * Validates a list of named phone entries (multi mode).
 * - "Primary Mobile Number" is required if required=true.
 * - Any entries present must also be valid 10-digit Indian numbers.
 */
export const validatePhoneEntries = (
  entries: { label: string; number: string }[] | undefined,
  required: boolean = true
): string | null => {
  const list = entries || [];

  if (required && list.length === 0) {
    return "Mobile Number is required";
  }

  const primary = list.find((e) => e.label === "Primary Mobile Number");
  if (required && !primary) {
    return "Primary Mobile Number is required";
  }

  for (const entry of list) {
    const err = validatePhoneNumber(entry.number, true);
    if (err) return `${entry.label}: ${err}`;
  }

  return null;
};

/* ---------- Single field (internal, reused by both modes) ---------- */

interface SinglePhoneFieldProps {
  name: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  onChange: (val: string) => void;
  onBlur: () => void;
  onRemove?: () => void;
  showRemove?: boolean;
}

export const SinglePhoneField: React.FC<SinglePhoneFieldProps> = ({
  name,
  value,
  placeholder,
  error,
  onChange,
  onBlur,
  onRemove,
  showRemove,
}) => {
  // Extract core 10 digits
  let displayValue = (value || "").replace("+91", "").replace(/\D/g, "");
  if (displayValue.startsWith("0")) {
    displayValue = displayValue.substring(1);
  }
  displayValue = displayValue.slice(0, 10);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.startsWith("0")) {
      val = val.substring(1);
    }
    val = val.slice(0, 10);
    onChange(val ? `+91${val}` : "");
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div
          className={`sl-input relative flex h-11 flex-1 items-center gap-2 px-4 ${error ? "is-invalid" : ""}`}
        >
          {/* Country Code with Flag */}
          <div className="flex shrink-0 select-none items-center gap-1.5 border-r border-line-soft pr-2.5 text-[15px] font-semibold text-ink-muted">
            {/* <span className="text-base">🇮🇳</span> */}
            <span>+91</span>
          </div>

          {/* Native Text Input */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            name={name}
            placeholder={placeholder || "98765 43210"}
            value={displayValue}
            onChange={handleInputChange}
            onBlur={onBlur}
            id={name}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${name}-error` : undefined}
            className="sl-input-bare flex-1 tabular-nums"
          />
        </div>

        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove phone number"
            className="sl-icon-btn sl-icon-btn-md sl-icon-btn-hover-danger"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {error && <FieldError id={`${name}-error`}>{error}</FieldError>}
    </div>
  );
};

/* ---------- Shared phone-input CSS override (mount once) ---------- */

const PhoneInputStyles = () => (
  <style>{`
        .PhoneInputInput, .PhoneInput input {
            border: none !important;
            outline: none !important;
            background: transparent !important;
            height: 100% !important;
            color: var(--color-ink) !important;
            font-weight: 500 !important;
            box-shadow: none !important;
        }
        .PhoneInputInput::placeholder, .PhoneInput input::placeholder {
            color: var(--color-ink-subtle) !important;
        }
        .PhoneInputInput:focus, .PhoneInput input:focus {
            border: none !important;
            box-shadow: none !important;
            outline: none !important;
        }
    `}</style>
);

/* ---------- Public props ---------- */

interface IndiaPhoneInputSingleProps {
  multi?: false;
  label?: string;
  name: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  /** Place label and input side by side in one row */
  horizontal?: boolean;
  onChange: (e: { target: { name: string; value: string } }) => void;
}

/** A single named phone entry used in multi mode */
export interface PhoneEntry {
  /** e.g. "Home", "Office", "Emergency Contact" */
  label: string;
  /** stored as +91XXXXXXXXXX */
  number: string;
}

interface IndiaPhoneInputMultiProps {
  multi: true;
  label?: string;
  name: string;
  /** array of named phone entries */
  value: PhoneEntry[];
  placeholder?: string;
  required?: boolean;
  /** shown below the field, e.g. from form-level validation */
  error?: string;
  /** returns updated array */
  onChange: (e: { target: { name: string; value: PhoneEntry[] } }) => void;
  maxNumbers?: number;
  /** Place label and input side by side in one row */
  horizontal?: boolean;
}

type IndiaPhoneInputProps = IndiaPhoneInputSingleProps | IndiaPhoneInputMultiProps;

/* ---------- Main component ---------- */

/** Indian mobile field (+91); `multi` mode keeps a list of typed numbers as chips. */
const IndiaPhoneInput: React.FC<IndiaPhoneInputProps> = (props) => {
  const { label, name, placeholder, required = true } = props;

  // ---- local validation error state ----
  const [singleLocalError, setSingleLocalError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftName, setDraftName] = useState<string>(PHONE_ENTRY_TYPES[0]);
  const [draftValue, setDraftValue] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [requiredError, setRequiredError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const wasOpened = useRef(false);

  // close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // multi mode: validate (required + 10-digit Indian number) whenever the dropdown closes
  useEffect(() => {
    if (isOpen) {
      wasOpened.current = true;
    } else if (wasOpened.current && props.multi) {
      setRequiredError(validatePhoneEntries(props.value, props.required ?? true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // multi mode: keep selected draft type valid as entries change
  useEffect(() => {
    if (!props.multi) return;
    const usedTypes = (props.value || []).map((e) => e.label);
    const available = PHONE_ENTRY_TYPES.filter((t) => !usedTypes.includes(t));
    if (available.length > 0 && !available.includes(draftName as PhoneEntryType)) {
      setDraftName(available[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.multi ? props.value.length : 0]);

  /* ============ MULTI MODE — dropdown multiselect pattern ============ */
  if (props.multi) {
    const { value, onChange, error, maxNumbers, horizontal: multiHorizontal = false } = props;
    const entries = value || [];
    const atMax = !!maxNumbers && entries.length >= maxNumbers;
    const usedTypes = entries.map((e) => e.label);
    const availableTypes = PHONE_ENTRY_TYPES.filter((t) => !usedTypes.includes(t));

    const formatNumber = (num: string) => {
      const digits = num.replace("+91", "").replace(/\D/g, "");
      return digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : num;
    };

    const commitDraft = () => {
      const rawName = draftName || availableTypes[0];
      const raw = draftValue.trim();

      if (!rawName) {
        setDraftError("All number types have been added");
        return;
      }
      if (!raw) {
        setDraftError("Enter a mobile number");
        return;
      }

      const digits = raw.replace(/\D/g, "");
      if (digits.length !== 10) {
        setDraftError("Enter a valid 10-digit mobile number");
        return;
      }
      const formatted = `+91${digits}`;

      if (entries.some((e) => e.label === rawName)) {
        setDraftError(`${rawName} is already added`);
        return;
      }
      if (entries.some((e) => e.number === formatted)) {
        setDraftError("This number is already added");
        return;
      }
      if (!isValidPhoneNumber(formatted)) {
        setDraftError("Enter a valid Indian mobile number");
        return;
      }

      const updated = [...entries, { label: rawName, number: formatted }];
      if (wasOpened.current) {
        setRequiredError(validatePhoneEntries(updated, props.required ?? true));
      }
      onChange({ target: { name, value: updated } });
      setDraftValue("");
      setDraftError(null);
    };

    const handleRemove = (idx: number) => {
      const updated = entries.filter((_, i) => i !== idx);
      if (wasOpened.current) {
        setRequiredError(validatePhoneEntries(updated, props.required ?? true));
      }
      onChange({ target: { name, value: updated } });
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitDraft();
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleNameChange = (raw: string) => {
      setDraftName(raw);
      if (draftError) setDraftError(null);
    };

    const handleDraftChange = (raw: string) => {
      const digits = raw.replace(/\D/g, "").slice(0, 10);
      setDraftValue(digits);
      if (draftError) setDraftError(null);
    };

    const displayError = error || draftError || (isOpen ? null : requiredError);

    return (
      <div
        className={`group w-full min-w-0 ${multiHorizontal ? "flex flex-col sm:flex-row sm:items-center sm:gap-3" : ""}`}
        ref={wrapperRef}
      >
        {label && (
          <label className={fieldLabelClass(multiHorizontal, multiHorizontal ? "sm:pt-0" : "")}>
            <span>{label}</span>
            {required && <RequiredMark />}
          </label>
        )}

        <div className={`relative ${multiHorizontal ? "flex-1" : ""}`}>
          {/* ---- Closed field / trigger ---- */}
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            className={`sl-input flex min-h-11 items-center justify-between gap-2 py-1.5 pl-4 pr-3 text-left ${displayError ? "is-invalid" : ""} ${isOpen ? "is-open" : ""}`}
          >
            <div className="flex items-center gap-1.5 flex-1 text-left overflow-hidden">
              {entries.length === 0 && (
                <span className="text-[15px] font-normal text-ink-subtle">
                  {placeholder || "Add mobile numbers"}
                </span>
              )}
              {entries.length > 0 &&
                (() => {
                  const entry = entries[0];
                  const digits = entry.number.replace("+91", "").replace(/\D/g, "");
                  const shortNum =
                    digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
                  const shortLabel = entry.label
                    .replace("Primary Mobile Number", "Primary")
                    .replace("Alternative Number", "Alt")
                    .replace("WhatsApp Number", "WA");
                  return (
                    <span className="sl-chip sl-chip-sm shrink-0 gap-1 pr-1">
                      <span className="font-bold">{shortLabel}:</span>
                      <span>+91 {shortNum}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(0);
                        }}
                        aria-label={`Remove ${entry.label}`}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-card/70"
                      >
                        <X size={11} />
                      </span>
                    </span>
                  );
                })()}
              {entries.length > 1 && (
                <span className="sl-chip sl-chip-sm sl-chip-muted shrink-0">
                  +{entries.length - 1} more
                </span>
              )}
            </div>
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`shrink-0 text-ink-subtle transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* ---- Dropdown panel ---- */}
          {isOpen && (
            <div className="sl-popover absolute left-0 right-0 top-[calc(100%+6px)] z-[100000] overflow-hidden !p-0">
              {/* add-entry row */}
              {!atMax && availableTypes.length > 0 && (
                <div className="p-2.5 border-b border-line-soft flex flex-col gap-2">
                  <select
                    value={draftName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    aria-label="Number type"
                    className="sl-input h-10 cursor-pointer px-3 text-sm"
                  >
                    {availableTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>

                  <div
                    className={`sl-input flex h-10 items-center gap-2 px-3 ${draftError ? "is-invalid" : ""}`}
                  >
                    <span className="text-[15px] font-medium text-ink-subtle select-none">+91</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={draftValue}
                      placeholder="Enter number & press Enter"
                      onChange={(e) => handleDraftChange(e.target.value)}
                      onKeyDown={handleKeyDown}
                      aria-label="Mobile number"
                      className="sl-input-bare flex-1 tabular-nums"
                    />
                  </div>

                  {draftError && <FieldError className="!mt-0">{draftError}</FieldError>}
                </div>
              )}

              {/* selected entries list */}
              <div className="max-h-48 overflow-y-auto py-1">
                {entries.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-ink-subtle text-center">
                    No numbers added yet
                  </div>
                ) : (
                  entries.map((entry, idx) => (
                    <div
                      key={`${entry.number}-${idx}`}
                      className="mx-1.5 flex items-center justify-between gap-2 rounded-[10px] px-3 py-2 transition-colors duration-150 hover:bg-nav-hover"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Check
                          size={14}
                          className="mt-0.5 shrink-0 text-[color:var(--color-success)]"
                          aria-hidden="true"
                        />
                        <span className="flex flex-col min-w-0">
                          <span className="text-[14px] font-semibold text-ink leading-tight">
                            {formatNumber(entry.number)}
                          </span>
                          <span className="text-[11px] font-medium text-ink-subtle leading-tight">
                            {entry.label}
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemove(idx)}
                        aria-label={`Remove ${entry.label}`}
                        className="sl-icon-btn sl-icon-btn-ghost sl-icon-btn-hover-danger !h-7 !w-7"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {atMax && (
                <div className="px-4 py-2 text-xs font-medium text-ink-subtle border-t border-line-soft">
                  Maximum {maxNumbers} numbers added
                </div>
              )}
            </div>
          )}
        </div>

        {displayError && !isOpen && <FieldError>{displayError}</FieldError>}
      </div>
    );
  }

  /* ============ SINGLE MODE (original behavior) ============ */
  const {
    value,
    error,
    onChange,
    horizontal: singleHorizontal = false,
  } = props as IndiaPhoneInputSingleProps;

  const handleBlur = () => {
    setSingleLocalError(validatePhoneNumber(value, required));
  };

  const handleOnChange = (val: string) => {
    onChange({ target: { name, value: val } });
    if (singleLocalError) {
      setSingleLocalError(validatePhoneNumber(val, required));
    }
  };

  const displayError = error || singleLocalError;

  return (
    <div
      className={`group w-full min-w-0 ${singleHorizontal ? "flex flex-col sm:flex-row sm:items-center sm:gap-3" : ""}`}
    >
      {label && (
        <label
          htmlFor={name}
          className={fieldLabelClass(singleHorizontal, singleHorizontal ? "sm:pt-0" : "")}
        >
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div className={singleHorizontal ? "flex-1" : ""}>
        <SinglePhoneField
          name={name}
          value={value}
          placeholder={placeholder}
          required={required}
          error={displayError}
          onChange={handleOnChange}
          onBlur={handleBlur}
        />
      </div>

      <PhoneInputStyles />
    </div>
  );
};

export default IndiaPhoneInput;
