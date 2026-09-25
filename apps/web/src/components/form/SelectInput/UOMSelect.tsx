import React from "react";
import { createPortal } from "react-dom";
import { Controller } from "react-hook-form";
import type { Control } from "react-hook-form";
import Select, { components } from "react-select";
import type { MultiValueProps } from "react-select";
import { ChevronDown } from "lucide-react";
import {
  FieldError,
  RequiredMark,
  fieldControlClasses,
  fieldLabelClass,
  optionClasses,
} from "../fieldStyles";
import { useUOM } from "../../../hooks/useUOM";

const SortableMultiValue = (props: MultiValueProps<any>) => {
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", props.index.toString());
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const draggedIndexStr = e.dataTransfer.getData("text/plain");
    if (!draggedIndexStr) return;
    const draggedIndex = parseInt(draggedIndexStr, 10);
    const targetIndex = props.index;

    if (draggedIndex !== targetIndex) {
      const onReorder = (props.selectProps as any).onReorder;
      if (onReorder) {
        onReorder(draggedIndex, targetIndex);
      }
    }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ cursor: "grab", display: "inline-flex" }}
    >
      <components.MultiValue {...props} />
    </div>
  );
};

const CustomSingleSelect = ({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  error,
}: {
  value: string;
  onChange: (val: string) => void;
  options: any[];
  placeholder: string;
  disabled: boolean;
  error?: boolean;
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>({});
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const portalRef = React.useRef<HTMLDivElement>(null);

  const updateDropdownPosition = React.useCallback(() => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom;
      const spaceAbove = rect.top;
      const dropdownMaxHeight = 180;

      let style: React.CSSProperties = {
        position: "fixed",
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 100000,
      };

      if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
        const maxH = Math.min(dropdownMaxHeight, spaceAbove - 16);
        style = {
          ...style,
          bottom: `${viewportHeight - rect.top + 4}px`,
          maxHeight: `${Math.max(100, maxH)}px`,
        };
      } else {
        const maxH = Math.min(dropdownMaxHeight, spaceBelow - 16);
        style = {
          ...style,
          top: `${rect.bottom + 4}px`,
          maxHeight: `${Math.max(100, maxH)}px`,
        };
      }

      setDropdownStyle(style);
    }
  }, []);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideWrapper = dropdownRef.current && !dropdownRef.current.contains(target);
      const isOutsidePortal = portalRef.current && !portalRef.current.contains(target);
      if (isOutsideWrapper && isOutsidePortal) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    updateDropdownPosition();
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  const selectedOpt = options.find((u) => u.code === value);
  const displayLabel = selectedOpt
    ? selectedOpt.code.toLowerCase() === "ea"
      ? "pcs"
      : `${selectedOpt.label} (${selectedOpt.code})`
    : placeholder;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            if (!isOpen) updateDropdownPosition();
            setIsOpen(!isOpen);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-invalid={Boolean(error)}
        className={fieldControlClasses({
          invalid: Boolean(error),
          open: isOpen,
          disabled,
          className: `flex h-11 items-center justify-between pl-4 pr-10 text-left ${value ? "text-ink" : "text-ink-subtle"}`,
        })}
      >
        <span className="truncate">{displayLabel}</span>
        <span className="absolute right-3.5 text-ink-subtle">
          <ChevronDown
            size={17}
            aria-hidden="true"
            className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div ref={portalRef} className="sl-popover flex flex-col" style={dropdownStyle}>
            <div role="listbox" className="min-h-0 flex-1 overflow-y-auto">
              <div
                onClick={() => {
                  onChange("");
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={!value}
                className={optionClasses({
                  selected: !value,
                  className: value ? "text-ink-muted" : "",
                })}
              >
                {placeholder}
              </div>
              {options.map((u) => (
                <div
                  key={u.code}
                  onClick={() => {
                    onChange(u.code);
                    setIsOpen(false);
                  }}
                  role="option"
                  aria-selected={value === u.code}
                  className={optionClasses({ selected: value === u.code })}
                >
                  {u.code.toLowerCase() === "ea" ? "pcs" : `${u.label} (${u.code})`}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

interface UOMSelectProps {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  category?: string | string[];
  allowedCodes?: string[];
  control?: Control<any>;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  error?: string;
  isMulti?: boolean;
}

export const UOMSelect: React.FC<UOMSelectProps> = ({
  name,
  label,
  placeholder = "Select Unit of Measure",
  required = false,
  disabled = false,
  category,
  allowedCodes,
  control,
  value,
  defaultValue = "",
  onChange: customOnChange,
  error,
  isMulti = false,
}) => {
  const { units, loading, error: fetchError, retry } = useUOM();

  const filteredUnits = React.useMemo(() => {
    let result = units;

    if (category) {
      const categoriesArray = Array.isArray(category)
        ? category.map((c) => c.toLowerCase())
        : [category.toLowerCase()];
      result = result.filter((u) => categoriesArray.includes(u.category.toLowerCase()));
    }

    if (allowedCodes && allowedCodes.length > 0) {
      const allowed = allowedCodes.map((c) => c.toLowerCase());
      result = result.filter((u) => allowed.includes(u.code.toLowerCase()));
    }

    return result;
  }, [units, category, allowedCodes]);

  const selectStyles = (isError: boolean) => ({
    control: (base: any, state: any) => ({
      ...base,
      minHeight: "44px",
      borderRadius: "12px",
      fontSize: "15px",
      boxShadow: state.isFocused
        ? isError
          ? "0 0 0 4px color-mix(in srgb, var(--color-danger) 16%, transparent)"
          : "0 0 0 4px color-mix(in srgb, var(--color-primary) 18%, transparent)"
        : "none",
      borderColor: isError
        ? "var(--color-danger)"
        : state.isFocused
          ? "var(--color-primary)"
          : "var(--color-line)",
      "&:hover": {
        borderColor: isError
          ? "var(--color-danger)"
          : state.isFocused
            ? "var(--color-primary)"
            : "var(--color-ink-subtle)",
      },
      backgroundColor: "var(--color-card)",
      color: "var(--color-ink)",
      opacity: disabled ? 0.6 : 1,
    }),
    singleValue: (base: any) => ({
      ...base,
      color: "var(--color-ink)",
    }),
    multiValue: (base: any) => ({
      ...base,
      backgroundColor: "var(--color-chip)",
      borderRadius: "999px",
      border: "none",
      paddingLeft: "4px",
    }),
    multiValueLabel: (base: any) => ({
      ...base,
      color: "var(--color-chip-fg)",
      fontWeight: 600,
    }),
    multiValueRemove: (base: any) => ({
      ...base,
      color: "var(--color-ink-subtle)",
      ":hover": {
        backgroundColor: "color-mix(in srgb, var(--color-danger) 16%, transparent)",
        color: "var(--color-danger)",
        borderRadius: "999px",
      },
    }),
    menu: (base: any) => ({
      ...base,
      backgroundColor: "var(--color-card)",
      border: "1px solid var(--color-line-soft)",
      borderRadius: "16px",
      boxShadow: "var(--sl-shadow-popover)",
      zIndex: 100000,
      overflow: "hidden",
    }),
    menuPortal: (base: any) => ({
      ...base,
      zIndex: 100000,
    }),
    menuList: (base: any) => ({
      ...base,
      padding: "6px",
      maxHeight: "180px",
    }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isSelected
        ? "var(--color-nav-active)"
        : state.isFocused
          ? "var(--color-nav-hover)"
          : "transparent",
      color: state.isSelected ? "var(--color-nav-active-fg)" : "var(--color-ink)",
      borderRadius: "10px",
      fontWeight: state.isSelected ? 600 : 400,
      cursor: "pointer",
      padding: "10px 16px",
      fontSize: "14px",
      transition: "background-color 150ms ease",
    }),
    input: (base: any) => ({
      ...base,
      color: "var(--color-ink)",
    }),
    placeholder: (base: any) => ({
      ...base,
      color: "var(--color-ink-subtle)",
    }),
    indicatorSeparator: () => ({
      display: "none",
    }),
    dropdownIndicator: (base: any) => ({
      ...base,
      color: "var(--color-ink-muted)",
      "&:hover": {
        color: "var(--color-ink)",
      },
    }),
    clearIndicator: (base: any) => ({
      ...base,
      color: "var(--color-ink-muted)",
      "&:hover": {
        color: "var(--color-danger)",
      },
    }),
    noOptionsMessage: (base: any) => ({
      ...base,
      color: "var(--color-ink-subtle)",
    }),
  });

  return (
    <div className="mb-[18px] group flex flex-col w-full">
      <label className={fieldLabelClass()}>
        <span>{label}</span>
        {required && <RequiredMark />}
      </label>

      {loading ? (
        <div role="status" className="sl-skeleton h-11 w-full">
          <span className="sr-only">Loading units...</span>
        </div>
      ) : fetchError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-[12px] border border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10 px-3 py-2"
        >
          <span className="text-sm font-medium text-ink">{fetchError}</span>
          <button type="button" className="sl-btn sl-pill-sm" onClick={retry}>
            Retry
          </button>
        </div>
      ) : control ? (
        <Controller
          name={name}
          control={control}
          defaultValue={defaultValue}
          rules={{ required: required ? `${label} is required` : false }}
          render={({ field, fieldState }) => {
            if (isMulti) {
              const currentValueArray = field.value
                ? field.value
                    .split(",")
                    .map((v: string) => v.trim())
                    .filter(Boolean)
                : [];
              const firstSelectedCode = currentValueArray.length > 0 ? currentValueArray[0] : null;
              const lockedCategory = firstSelectedCode
                ? filteredUnits.find((u) => u.code === firstSelectedCode)?.category
                : null;

              const options = filteredUnits
                .filter((u) => !lockedCategory || u.category === lockedCategory)
                .map((u) => ({
                  label: u.code.toLowerCase() === "ea" ? "pcs" : `${u.label} (${u.code})`,
                  value: u.code,
                }));
              const selectedOptions = currentValueArray
                .map((val: string) => options.find((o) => o.value === val))
                .filter(Boolean);

              return (
                <>
                  <Select
                    isMulti
                    menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                    closeMenuOnSelect={false}
                    blurInputOnSelect={false}
                    isDisabled={disabled}
                    options={options}
                    value={selectedOptions}
                    placeholder={placeholder}
                    components={{ MultiValue: SortableMultiValue }}
                    {...({
                      onReorder: (dragIndex: number, hoverIndex: number) => {
                        const newValues = [...currentValueArray];
                        const [dragged] = newValues.splice(dragIndex, 1);
                        newValues.splice(hoverIndex, 0, dragged);
                        const newValueStr = newValues.join(",");
                        field.onChange(newValueStr);
                        if (customOnChange) customOnChange(newValueStr);
                      },
                    } as any)}
                    styles={selectStyles(!!fieldState.error)}
                    onChange={(selected: any) => {
                      const newValue = selected ? selected.map((s: any) => s.value).join(",") : "";
                      field.onChange(newValue);
                      if (customOnChange) {
                        customOnChange(newValue);
                      }
                    }}
                  />
                  {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
                </>
              );
            }
            return (
              <>
                <CustomSingleSelect
                  value={field.value || ""}
                  onChange={(val) => {
                    field.onChange(val);
                    if (customOnChange) {
                      customOnChange(val);
                    }
                  }}
                  options={filteredUnits}
                  placeholder={placeholder}
                  disabled={disabled}
                  error={!!fieldState.error}
                />
                {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
              </>
            );
          }}
        />
      ) : (
        <>
          {isMulti ? (
            (() => {
              const currentValueArray = value
                ? value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                : [];
              const firstSelectedCode = currentValueArray.length > 0 ? currentValueArray[0] : null;
              const lockedCategory = firstSelectedCode
                ? filteredUnits.find((u) => u.code === firstSelectedCode)?.category
                : null;

              const options = filteredUnits
                .filter((u) => !lockedCategory || u.category === lockedCategory)
                .map((u) => ({
                  label: u.code.toLowerCase() === "ea" ? "pcs" : `${u.label} (${u.code})`,
                  value: u.code,
                }));
              const selectedOptions = currentValueArray
                .map((val) => options.find((o) => o.value === val))
                .filter(Boolean);

              return (
                <Select
                  isMulti
                  menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                  closeMenuOnSelect={false}
                  blurInputOnSelect={false}
                  isDisabled={disabled}
                  options={options}
                  value={selectedOptions}
                  placeholder={placeholder}
                  components={{ MultiValue: SortableMultiValue }}
                  {...({
                    onReorder: (dragIndex: number, hoverIndex: number) => {
                      const newValues = [...currentValueArray];
                      const [dragged] = newValues.splice(dragIndex, 1);
                      newValues.splice(hoverIndex, 0, dragged);
                      const newValueStr = newValues.join(",");
                      if (customOnChange) customOnChange(newValueStr);
                    },
                  } as any)}
                  styles={selectStyles(!!error)}
                  onChange={(selected: any) => {
                    if (customOnChange) {
                      const newValue = selected ? selected.map((s: any) => s.value).join(",") : "";
                      customOnChange(newValue);
                    }
                  }}
                />
              );
            })()
          ) : (
            <CustomSingleSelect
              value={value || ""}
              onChange={(val) => {
                if (customOnChange) {
                  customOnChange(val);
                }
              }}
              options={filteredUnits}
              placeholder={placeholder}
              disabled={disabled}
              error={!!error}
            />
          )}
          {error && <FieldError>{error}</FieldError>}
        </>
      )}
    </div>
  );
};

export default UOMSelect;
