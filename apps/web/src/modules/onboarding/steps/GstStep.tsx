import React, { useState } from "react";
import { GST_STATES, isValidGstin } from "@shiftline/shared";
import { onboardingService } from "../../../services/onboardingService";
import type {
  GstStepPayload,
  OnboardingBusinessPlace,
  OnboardingState,
  OnboardingStepKey,
} from "../types";
import { Actions, ErrorBox, Field, PrimaryButton, SecondaryButton, StepHeader } from "./fields";
import { apiMessage, inputClass } from "./utils";

interface Props {
  state: OnboardingState;
  onSaved: (next: OnboardingStepKey) => Promise<void>;
  onBack: () => void;
}

const PLACE_TYPES: { value: OnboardingBusinessPlace["type"]; label: string }[] = [
  { value: "HEAD_OFFICE", label: "Head office" },
  { value: "FACTORY", label: "Factory" },
  { value: "BRANCH_OFFICE", label: "Branch office" },
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "RETAIL_STORE", label: "Retail store" },
];

const REG_TYPES: { value: GstStepPayload["registrationType"]; label: string; hint: string }[] = [
  { value: "REGULAR", label: "Regular", hint: "Charges GST and claims input credit." },
  { value: "COMPOSITION", label: "Composition", hint: "Pays tax at a flat rate; bills of supply." },
  { value: "UNREGISTERED", label: "Not registered", hint: "Below the threshold; no GSTIN yet." },
];

const emptyPlace = (isHeadOffice: boolean, stateCode = ""): OnboardingBusinessPlace => ({
  code: isHeadOffice ? "HO" : "",
  name: isHeadOffice ? "Head Office" : "",
  type: isHeadOffice ? "HEAD_OFFICE" : "FACTORY",
  gstPlaceCode: stateCode,
  isHeadOffice,
  addressLine1: "",
  city: "",
  zipcode: "",
});

const GstStep: React.FC<Props> = ({ state, onSaved, onBack }) => {
  const [registrationType, setRegistrationType] = useState<GstStepPayload["registrationType"]>(
    state.gst.registrationType ?? "REGULAR"
  );
  const [gstin, setGstin] = useState(state.gst.gstin ?? "");
  const [places, setPlaces] = useState<OnboardingBusinessPlace[]>(
    state.gst.businessPlaces.length
      ? state.gst.businessPlaces.map((p) => ({ ...p, gstPlaceCode: p.gstPlaceCode ?? "" }))
      : [emptyPlace(true)]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registered = registrationType !== "UNREGISTERED";
  const gstinOk = gstin.length === 15 && isValidGstin(gstin);

  const onGstin = (value: string) => {
    const v = value
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "")
      .slice(0, 15);
    setGstin(v);
    if (v.length >= 2) {
      // The head office sits in the GSTIN's state unless the user picked one already.
      setPlaces((ps) =>
        ps.map((p) =>
          p.isHeadOffice && !p.gstPlaceCode ? { ...p, gstPlaceCode: v.slice(0, 2) } : p
        )
      );
    }
  };

  const update = (idx: number, patch: Partial<OnboardingBusinessPlace>) =>
    setPlaces((ps) => ps.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const makeHead = (idx: number) =>
    setPlaces((ps) =>
      ps.map((p, i) => ({
        ...p,
        isHeadOffice: i === idx,
        type: i === idx ? "HEAD_OFFICE" : p.type === "HEAD_OFFICE" ? "BRANCH_OFFICE" : p.type,
      }))
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (registered && !gstinOk) {
      setError("Enter a valid 15-character GSTIN (the last character is a check digit).");
      return;
    }
    setBusy(true);
    try {
      const res = await onboardingService.saveGst({
        registrationType,
        gstin: registered ? gstin : null,
        businessPlaces: places.map((p) => ({
          ...p,
          code: p.code.trim().toUpperCase(),
          name: p.name.trim(),
        })),
      });
      await onSaved(res.step);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader
        title="GST and places of business"
        subtitle="Your registration decides how invoices are taxed; each place of business gets its own numbering and GST state."
      />

      <fieldset className="grid gap-3 md:grid-cols-3">
        {REG_TYPES.map((r) => (
          <label
            key={r.value}
            className={`cursor-pointer rounded-xl border p-3 ${
              registrationType === r.value
                ? "border-blue-500 bg-blue-500/10"
                : "border-line-soft bg-card-2"
            }`}
          >
            <input
              type="radio"
              name="registrationType"
              value={r.value}
              checked={registrationType === r.value}
              onChange={() => setRegistrationType(r.value)}
              className="mr-2"
            />
            <span className="text-sm font-semibold text-ink">{r.label}</span>
            <span className="mt-1 block text-xs text-ink-muted">{r.hint}</span>
          </label>
        ))}
      </fieldset>

      {registered && (
        <div className="mt-4 max-w-md">
          <Field
            label="GSTIN"
            hint={
              gstin.length === 15
                ? gstinOk
                  ? `Valid · ${GST_STATES.find((s) => s.code === gstin.slice(0, 2))?.name ?? "Unknown state"}`
                  : "Check digit does not match — please re-check the number."
                : "15 characters, for example 33AAAAA0000A1Z9."
            }
          >
            <input
              name="gstin"
              className={`${inputClass} font-mono tracking-wider ${
                gstin.length === 15 ? (gstinOk ? "border-emerald-500/60" : "border-red-500/60") : ""
              }`}
              value={gstin}
              onChange={(e) => onGstin(e.target.value)}
              maxLength={15}
              autoCapitalize="characters"
            />
          </Field>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-ink-muted">
          Places of business
        </h3>
        <SecondaryButton
          onClick={() => setPlaces((ps) => [...ps, emptyPlace(false, gstin.slice(0, 2))])}
        >
          + Add a place
        </SecondaryButton>
      </div>

      <div className="mt-3 space-y-3">
        {places.map((p, idx) => (
          <div
            key={p.id ?? `new-${idx}`}
            className="rounded-xl border border-line-soft bg-card-2/60 p-4"
          >
            <div className="grid gap-3 md:grid-cols-6">
              <Field label="Code">
                <input
                  className={`${inputClass} uppercase`}
                  value={p.code}
                  onChange={(e) => update(idx, { code: e.target.value.toUpperCase() })}
                  maxLength={20}
                  required
                  aria-label={`Place ${idx + 1} code`}
                />
              </Field>
              <Field label="Name" className="md:col-span-2">
                <input
                  className={inputClass}
                  value={p.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  required
                  aria-label={`Place ${idx + 1} name`}
                />
              </Field>
              <Field label="Type">
                <select
                  className={inputClass}
                  value={p.type}
                  onChange={(e) =>
                    update(idx, { type: e.target.value as OnboardingBusinessPlace["type"] })
                  }
                  disabled={p.isHeadOffice}
                >
                  {PLACE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="State (GST)" className="md:col-span-2">
                <select
                  className={inputClass}
                  value={p.gstPlaceCode}
                  onChange={(e) => update(idx, { gstPlaceCode: e.target.value })}
                  required
                  aria-label={`Place ${idx + 1} state`}
                >
                  <option value="">Select a state</option>
                  {GST_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Address" className="md:col-span-3">
                <input
                  className={inputClass}
                  value={p.addressLine1 ?? ""}
                  onChange={(e) => update(idx, { addressLine1: e.target.value })}
                />
              </Field>
              <Field label="City" className="md:col-span-2">
                <input
                  className={inputClass}
                  value={p.city ?? ""}
                  onChange={(e) => update(idx, { city: e.target.value })}
                />
              </Field>
              <Field label="PIN">
                <input
                  className={inputClass}
                  value={p.zipcode ?? ""}
                  onChange={(e) => update(idx, { zipcode: e.target.value })}
                  maxLength={20}
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-ink-muted">
                <input
                  type="radio"
                  name="headOffice"
                  checked={p.isHeadOffice}
                  onChange={() => makeHead(idx)}
                />
                Head office (registered address)
              </label>
              {!p.isHeadOffice && (
                <button
                  type="button"
                  className="text-red-500 hover:underline"
                  onClick={() => setPlaces((ps) => ps.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <ErrorBox message={error} />
      <Actions>
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </PrimaryButton>
      </Actions>
    </form>
  );
};

export default GstStep;
