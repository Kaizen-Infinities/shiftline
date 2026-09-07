import React, { useState } from "react";
import { GST_STATES } from "@shiftline/shared";
import { onboardingService } from "../../../services/onboardingService";
import type { CompanyStepPayload, OnboardingState, OnboardingStepKey } from "../types";
import { Actions, ErrorBox, Field, PrimaryButton, StepHeader } from "./fields";
import { apiMessage, inputClass } from "./utils";

interface Props {
  state: OnboardingState;
  onSaved: (next: OnboardingStepKey) => Promise<void>;
}

const CompanyStep: React.FC<Props> = ({ state, onSaved }) => {
  const c = state.company;
  const [form, setForm] = useState<CompanyStepPayload>({
    companyName: c.companyName ?? "",
    legalName: c.legalName ?? "",
    shortName: c.shortName ?? "",
    email: c.email ?? "",
    phone: c.phone ?? "",
    website: c.website ?? "",
    addressLine1: c.addressLine1 ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    zipcode: c.zipcode ?? "",
    country: c.country ?? "India",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set =
    (key: keyof CompanyStepPayload) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await onboardingService.saveCompany(form);
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
        title="Company details"
        subtitle="How your company appears on invoices, reports and to your team."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company name" className="md:col-span-2">
          <input
            name="companyName"
            className={inputClass}
            value={form.companyName}
            onChange={set("companyName")}
            required
            minLength={2}
          />
        </Field>
        <Field label="Legal name" hint="As registered; printed on tax documents.">
          <input
            name="legalName"
            className={inputClass}
            value={form.legalName ?? ""}
            onChange={set("legalName")}
          />
        </Field>
        <Field label="Short name" hint="Used in headers and the mobile app.">
          <input
            name="shortName"
            className={inputClass}
            value={form.shortName ?? ""}
            onChange={set("shortName")}
            maxLength={60}
          />
        </Field>
        <Field label="Email">
          <input
            name="email"
            type="email"
            className={inputClass}
            value={form.email ?? ""}
            onChange={set("email")}
          />
        </Field>
        <Field label="Phone">
          <input
            name="phone"
            className={inputClass}
            value={form.phone ?? ""}
            onChange={set("phone")}
            maxLength={20}
          />
        </Field>
        <Field label="Website" className="md:col-span-2">
          <input
            name="website"
            type="url"
            placeholder="https://"
            className={inputClass}
            value={form.website ?? ""}
            onChange={set("website")}
          />
        </Field>
        <Field label="Address" className="md:col-span-2">
          <input
            name="addressLine1"
            className={inputClass}
            value={form.addressLine1 ?? ""}
            onChange={set("addressLine1")}
          />
        </Field>
        <Field label="City">
          <input
            name="city"
            className={inputClass}
            value={form.city ?? ""}
            onChange={set("city")}
          />
        </Field>
        <Field label="State">
          <select
            name="state"
            className={inputClass}
            value={form.state ?? ""}
            onChange={set("state")}
          >
            <option value="">Select a state</option>
            {GST_STATES.map((s) => (
              <option key={s.code} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PIN code">
          <input
            name="zipcode"
            className={inputClass}
            value={form.zipcode ?? ""}
            onChange={set("zipcode")}
            maxLength={20}
          />
        </Field>
        <Field label="Country">
          <input
            name="country"
            className={inputClass}
            value={form.country ?? ""}
            onChange={set("country")}
          />
        </Field>
      </div>
      <ErrorBox message={error} />
      <Actions>
        <span className="text-xs text-ink-muted">Step 1 of 6</span>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </PrimaryButton>
      </Actions>
    </form>
  );
};

export default CompanyStep;
