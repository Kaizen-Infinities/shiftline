import React, { useState, useEffect, useId } from "react";
import { FieldError, RequiredMark, fieldControlClasses, fieldLabelClass } from "../fieldStyles";
import convert from "convert-units";

interface QuantityInputProps {
  name: string;
  label?: string;
  value: string | number;
  baseUoms: string;
  required?: boolean;
  error?: string;
  onChange: (e: any) => void;
  disabled?: boolean;
  step?: string;
  hideLabel?: boolean;
  uom?: string;
  onUomChange?: (uom: string) => void;
}

/** Quantity with its unit: number box and a unit picker joined in one `.sl-input`. */
const QuantityInput: React.FC<QuantityInputProps> = ({
  name,
  label = "",
  value,
  baseUoms,
  required = false,
  error,
  onChange,
  disabled = false,
  step,
  hideLabel = false,
  uom,
  onUomChange,
}) => {
  const baseId = useId();
  const inputId = `${baseId}-qty`;
  const errorId = `${baseId}-error`;
  const rawList = baseUoms
    ? baseUoms
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean)
    : [];

  // Custom peers for count-based units not known to convert-units
  const CUSTOM_PEERS: Record<string, string[]> = {
    pcs: ["pcs", "dz", "box"],
    ea: ["pcs", "dz", "box"],
    each: ["pcs", "dz", "box"],
    dz: ["dz", "pcs"],
    box: ["box", "pcs"],
  };
  const PREFERRED = new Set(["g", "kg", "t", "ml", "l", "mm", "cm", "m", "km"]);

  const expandUoms = (list: string[]): string[] => {
    const source = list.length > 0 ? list : [uom || "kg"];
    if (source.length > 1) return source; // already explicit

    const primary = source[0].toLowerCase().trim();
    if (CUSTOM_PEERS[primary]) return CUSTOM_PEERS[primary];

    try {
      const all = (convert() as any).from(primary).possibilities() as string[];
      const peers = [primary, ...all.filter((u: string) => u !== primary && PREFERRED.has(u))];
      return peers.length > 1 ? peers : [primary];
    } catch {
      return [primary];
    }
  };

  const uomList = expandUoms(rawList);

  // Track selected UOM locally if not controlled from parent
  const [localUom, setLocalUom] = useState<string>("");
  const activeUom = uom !== undefined ? uom : localUom || (uomList.length > 0 ? uomList[0] : "");

  useEffect(() => {
    if (uomList.length > 0) {
      // Find matching UOM or default to first
      const matches = uomList.find((u) => u.toLowerCase() === activeUom.toLowerCase());
      if (!matches) {
        setLocalUom(uomList[0]);
      }
    }
  }, [baseUoms]);

  const [displayValue, setDisplayValue] = useState<string>(String(value || ""));

  useEffect(() => {
    setDisplayValue(String(value || ""));
  }, [value]);

  const handleQtyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDisplayVal = e.target.value;
    setDisplayValue(newDisplayVal);
    onChange({ target: { name, value: newDisplayVal, uom: activeUom } });
  };

  const primaryUom = uomList.length > 0 ? uomList[0] : "";

  return (
    <div className={`group w-full min-w-0 ${!hideLabel ? "mb-4" : ""}`}>
      {!hideLabel && (
        <label htmlFor={inputId} className={fieldLabelClass()}>
          <span>{label}</span>
          {required && <RequiredMark />}
        </label>
      )}

      <div
        className={fieldControlClasses({
          invalid: Boolean(error),
          disabled: disabled || !primaryUom,
          className: "relative flex h-11 overflow-hidden !p-0",
        })}
      >
        <input
          id={inputId}
          type="number"
          value={displayValue}
          onChange={handleQtyChange}
          disabled={disabled || !primaryUom}
          placeholder="0.00"
          step={step || "any"}
          aria-label={hideLabel ? label || name : undefined}
          aria-invalid={Boolean(error)}
          aria-required={required || undefined}
          aria-describedby={error ? errorId : undefined}
          className={`sl-input-bare flex-1 px-3.5 text-[15px] font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${disabled ? "cursor-not-allowed text-ink-muted" : ""}`}
        />
        {uomList.length > 1 ? (
          <select
            value={activeUom}
            aria-label="Unit"
            onChange={(e) => {
              const val = e.target.value;
              setLocalUom(val);
              if (onUomChange) onUomChange(val);
              onChange({ target: { name, value: displayValue, uom: val } });
            }}
            disabled={disabled}
            className="h-full w-[58px] flex-shrink-0 cursor-pointer border-0 border-l border-line-soft bg-card-2 px-1.5 text-xs font-semibold text-ink-muted focus:outline-none"
          >
            {uomList.map((u) => {
              const display = u.toLowerCase() === "ea" ? "pcs" : u;
              return (
                <option key={u} value={u} className="bg-card text-ink">
                  {display}
                </option>
              );
            })}
          </select>
        ) : (
          <span className="flex h-full w-[58px] flex-shrink-0 items-center justify-center border-l border-line-soft bg-card-2 px-1 text-xs font-semibold text-ink-muted">
            {activeUom ? (activeUom.toLowerCase() === "ea" ? "pcs" : activeUom) : "UOM"}
          </span>
        )}
      </div>

      {error && <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
};

export default QuantityInput;
