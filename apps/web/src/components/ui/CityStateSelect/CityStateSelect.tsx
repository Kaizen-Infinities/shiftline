import React from "react";
import { GST_STATES } from "@shiftline/shared";
import SelectInput from "../../form/SelectInput/SelectInput";
import TextInput from "../../form/TextInput/TextInput";
import { FieldError } from "../../form/fieldStyles";

export interface StateCityOption {
  id: number;
  name: string;
  state_code?: string;
  [key: string]: any;
}

interface CityStateSelectProps {
  countryLabel?: string;
  stateLabel?: string;
  cityLabel?: string;
  countryValue?: string;
  stateValue: string;
  cityValue: string;
  onCountryChange?: (country: StateCityOption) => void;
  onStateChange: (state: StateCityOption) => void;
  onCityChange: (city: StateCityOption) => void;
  countryError?: string;
  stateError?: string;
  cityError?: string;
  required?: boolean;
  disabled?: boolean;
  resetKey?: number;
  horizontal?: boolean;
  /** Render only specific fields: "city", "state-country", or undefined for all */
  renderOnly?: "city" | "state-country";
}

// States and union territories come from the bundled GST state list, so the form never
// depends on a third-party host. Cities are free text: no city dataset is bundled.
const STATE_OPTIONS = GST_STATES.map((s) => ({
  id: Number(s.code),
  name: s.name,
  state_code: s.code,
}));

const CityStateSelect: React.FC<CityStateSelectProps> = ({
  countryLabel = "Country",
  stateLabel = "State",
  cityLabel = "City",
  countryValue = "India",
  stateValue,
  cityValue,
  onCountryChange,
  onStateChange,
  onCityChange,
  countryError,
  stateError,
  cityError,
  required = false,
  disabled = false,
  horizontal = false,
  renderOnly,
}) => {
  const stateOptions = [
    { value: "", label: `-- Select ${stateLabel} --` },
    ...STATE_OPTIONS.map((s) => ({ value: s.name, label: s.name })),
  ];

  const handleStateSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedName = e.target.value;
    const matched = STATE_OPTIONS.find((s) => s.name === selectedName);
    onStateChange(matched || { id: 0, name: "" });
    onCityChange({ id: 0, name: "" });
  };

  const handleCityInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onCityChange({ id: 0, name: e.target.value });
  };

  const showCity = !renderOnly || renderOnly === "city";
  const showStateCountry = !renderOnly || renderOnly === "state-country";

  if (disabled) {
    return (
      <>
        {showCity && (
          <div className="w-full">
            <TextInput
              label={cityLabel}
              name="cityDisplay"
              value={cityValue}
              onChange={() => {}}
              disabled
              horizontal={horizontal}
            />
          </div>
        )}
        {showStateCountry && (
          <>
            <div className="w-full">
              <TextInput
                label={stateLabel}
                name="stateDisplay"
                value={stateValue}
                onChange={() => {}}
                disabled
                horizontal={horizontal}
              />
            </div>
            <div className="w-full">
              <TextInput
                label={countryLabel}
                name="countryDisplay"
                value={countryValue || "India"}
                onChange={() => {}}
                disabled
                horizontal={horizontal}
              />
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <>
      {showCity && (
        <div className="w-full">
          <TextInput
            label={cityLabel}
            name="city"
            value={cityValue}
            placeholder="Type city name"
            onChange={handleCityInput}
            required={required}
            horizontal={horizontal}
            error={cityError}
          />
        </div>
      )}

      {showStateCountry && (
        <>
          <div className="w-full">
            <SelectInput
              label={stateLabel}
              name="state"
              value={stateValue}
              options={stateOptions}
              onChange={handleStateSelect}
              required={required}
              searchable={true}
              horizontal={horizontal}
              error={stateError}
            />
          </div>

          <div className="w-full">
            <TextInput
              label={countryLabel}
              name="country"
              value={countryValue || "India"}
              onChange={() => {}}
              disabled={true}
              horizontal={horizontal}
            />
            {countryError && <FieldError>{countryError}</FieldError>}
          </div>
        </>
      )}
    </>
  );
};

export default CityStateSelect;
