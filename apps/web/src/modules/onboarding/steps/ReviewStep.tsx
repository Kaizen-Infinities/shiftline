import React, { useState } from "react";
import { GST_STATES } from "@shiftline/shared";
import { onboardingService } from "../../../services/onboardingService";
import type { OnboardingState, OnboardingStepKey } from "../types";
import { Actions, ErrorBox, PrimaryButton, SecondaryButton, StepHeader } from "./fields";
import { apiMessage } from "./utils";

interface Props {
  state: OnboardingState;
  onEdit: (step: OnboardingStepKey) => void;
  onComplete: () => Promise<void>;
}

const Section: React.FC<{
  title: string;
  step: OnboardingStepKey;
  onEdit: (s: OnboardingStepKey) => void;
  children: React.ReactNode;
}> = ({ title, step, onEdit, children }) => (
  <section className="rounded-xl border border-line-soft bg-card-2/60 p-4 text-sm">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">{title}</h3>
      <button
        type="button"
        className="text-xs text-blue-500 hover:underline"
        onClick={() => onEdit(step)}
      >
        Edit
      </button>
    </div>
    <div className="mt-2 text-ink">{children}</div>
  </section>
);

const ReviewStep: React.FC<Props> = ({ state, onEdit, onComplete }) => {
  const [accepted, setAccepted] = useState(state.tos.accepted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = state.company;
  const stateName = (code: string | null | undefined) =>
    GST_STATES.find((s) => s.code === code)?.name ?? code ?? "—";

  const finish = async () => {
    if (!accepted) {
      setError("Please accept the terms of service to finish.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!state.tos.accepted) await onboardingService.acceptTos(state.tos.version);
      await onboardingService.complete();
      await onComplete();
    } catch (err) {
      setError(apiMessage(err));
      setBusy(false);
    }
  };

  return (
    <div>
      <StepHeader
        title="Review and finish"
        subtitle="Check the details below; everything can be changed later from Settings."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Company" step="company" onEdit={onEdit}>
          <div className="font-bold">{c.companyName}</div>
          {c.legalName && c.legalName !== c.companyName && <div>{c.legalName}</div>}
          <div className="text-ink-muted">
            {[c.addressLine1, c.city, c.state, c.zipcode].filter(Boolean).join(", ") ||
              "No address yet"}
          </div>
          <div className="text-ink-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
        </Section>
        <Section title="GST" step="gst" onEdit={onEdit}>
          <div>
            {state.gst.registrationType === "UNREGISTERED"
              ? "Not registered"
              : `${state.gst.registrationType ?? "Regular"} · `}
            {state.gst.gstin && <span className="font-mono">{state.gst.gstin}</span>}
          </div>
          <ul className="mt-1 text-ink-muted">
            {state.gst.businessPlaces.map((p) => (
              <li key={p.id ?? p.code}>
                {p.code} · {p.name} · {stateName(p.gstPlaceCode)}
                {p.isHeadOffice && " (head office)"}
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Financial year" step="financial-year" onEdit={onEdit}>
          {state.financialYear ? (
            <>
              <div className="font-bold">FY {state.financialYear.code}</div>
              <div className="text-ink-muted">
                {state.financialYear.start} → {state.financialYear.end} · books from{" "}
                {state.financialYear.booksBeginOn}
              </div>
            </>
          ) : (
            <div className="text-ink-muted">Not set</div>
          )}
        </Section>
        <Section title="Bank accounts" step="bank" onEdit={onEdit}>
          {state.bankAccounts.length ? (
            <ul>
              {state.bankAccounts.map((b) => (
                <li key={b.ledgerId} className="flex justify-between gap-2">
                  <span>
                    {b.name}
                    {b.bankName && <span className="text-ink-muted"> · {b.bankName}</span>}
                    {b.isDefault && (
                      <span className="ml-1 rounded bg-blue-500/15 px-1.5 text-[10px] font-bold text-blue-500">
                        DEFAULT
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-ink-muted">{b.ifsc ?? ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-ink-muted">None yet</div>
          )}
        </Section>
        <Section title="Team" step="users" onEdit={onEdit}>
          <div>
            {state.users.length} user{state.users.length === 1 ? "" : "s"},{" "}
            {state.invitations.length} pending invitation
            {state.invitations.length === 1 ? "" : "s"}
          </div>
        </Section>
      </div>

      <div className="mt-6 rounded-xl border border-line-soft p-4">
        <h3 className="text-sm font-bold text-ink">
          Terms of service · version {state.tos.version}
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
          <li>
            Your company owns the data it enters; Shiftline processes it only to provide the
            service.
          </li>
          <li>
            Books of account, filings and payroll are retained for eight years as Indian law
            requires; other data follows your retention settings.
          </li>
          <li>
            Daily backups are taken and restorable; you remain responsible for the accuracy of what
            is filed with tax authorities.
          </li>
          <li>
            Access is per user; sharing logins or using the service for unlawful purposes ends the
            agreement.
          </li>
          <li>
            The full terms and the subscription agreement are provided by Kaizen Infinities with
            your plan.
          </li>
        </ul>
        <label className="mt-3 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="acceptTos"
            className="mt-0.5"
            checked={accepted}
            disabled={state.tos.accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            I have authority to bind {c.companyName} and accept the terms of service.
            {state.tos.accepted && state.tos.acceptedAt && (
              <span className="text-ink-muted">
                {" "}
                Accepted on {new Date(state.tos.acceptedAt).toLocaleDateString("en-IN")}.
              </span>
            )}
          </span>
        </label>
      </div>

      <ErrorBox message={error} />
      <Actions>
        <SecondaryButton onClick={() => onEdit("users")}>Back</SecondaryButton>
        <PrimaryButton type="button" onClick={finish} disabled={busy || !accepted}>
          {busy ? "Finishing…" : "Finish setup"}
        </PrimaryButton>
      </Actions>
    </div>
  );
};

export default ReviewStep;
