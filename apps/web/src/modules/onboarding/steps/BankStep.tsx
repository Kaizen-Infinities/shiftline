import React, { useState } from "react";
import { onboardingService } from "../../../services/onboardingService";
import type { OnboardingBankAccount, OnboardingState, OnboardingStepKey } from "../types";
import { Actions, ErrorBox, Field, PrimaryButton, SecondaryButton, StepHeader } from "./fields";
import { apiMessage, inputClass } from "./utils";

interface Props {
  state: OnboardingState;
  onSaved: (next: OnboardingStepKey) => Promise<void>;
  onBack: () => void;
}

const emptyAccount = (): OnboardingBankAccount => ({
  name: "",
  bankName: "",
  accountName: "",
  accountNumber: "",
  ifsc: "",
  branch: "",
  upiId: "",
  openingBalance: 0,
  isDefault: false,
});

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

const BankStep: React.FC<Props> = ({ state, onSaved, onBack }) => {
  const [rows, setRows] = useState<OnboardingBankAccount[]>(
    state.bankAccounts.length
      ? state.bankAccounts.map((b) => ({
          ...b,
          bankName: b.bankName ?? "",
          accountName: b.accountName ?? "",
          accountNumber: b.accountNumber ?? "",
          ifsc: b.ifsc ?? "",
          branch: b.branch ?? "",
          upiId: b.upiId ?? "",
          openingBalance: 0,
        }))
      : [emptyAccount()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (idx: number, patch: Partial<OnboardingBankAccount>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const save = async (accounts: OnboardingBankAccount[]) => {
    setBusy(true);
    setError(null);
    try {
      const res = await onboardingService.saveBank({
        accounts: accounts.map((a) => ({
          ledgerId: a.ledgerId ?? null,
          name: a.name.trim(),
          bankName: a.bankName.trim(),
          accountName: a.accountName || null,
          accountNumber: a.accountNumber || null,
          ifsc: (a.ifsc || "").toUpperCase() || null,
          branch: a.branch || null,
          upiId: a.upiId || null,
          openingBalance: a.hasOpeningBalance ? 0 : Number(a.openingBalance) || 0,
          isDefault: a.isDefault,
        })),
      });
      await onSaved(res.step);
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await save(rows.filter((r) => r.name.trim() || r.bankName.trim()));
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepHeader
        title="Bank accounts"
        subtitle="Each account is a ledger in your books. Opening balances post a journal dated the day your books begin."
      />

      <div className="space-y-3">
        {rows.map((r, idx) => (
          <div
            key={r.ledgerId ?? `new-${idx}`}
            className="rounded-xl border border-line-soft bg-card-2/60 p-4"
          >
            <div className="grid gap-3 md:grid-cols-6">
              <Field
                label="Account name in books"
                className="md:col-span-3"
                hint={r.code ? `Ledger ${r.code}` : undefined}
              >
                <input
                  className={inputClass}
                  value={r.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="HDFC Current Account"
                  aria-label={`Account ${idx + 1} name`}
                />
              </Field>
              <Field label="Bank" className="md:col-span-3">
                <input
                  className={inputClass}
                  value={r.bankName}
                  onChange={(e) => update(idx, { bankName: e.target.value })}
                  placeholder="HDFC Bank"
                  aria-label={`Account ${idx + 1} bank`}
                />
              </Field>
              <Field label="Account number" className="md:col-span-2">
                <input
                  className={`${inputClass} font-mono`}
                  value={r.accountNumber ?? ""}
                  onChange={(e) =>
                    update(idx, { accountNumber: e.target.value.replace(/\s/g, "") })
                  }
                  maxLength={34}
                />
              </Field>
              <Field label="IFSC">
                <input
                  className={`${inputClass} font-mono uppercase`}
                  value={r.ifsc ?? ""}
                  onChange={(e) => update(idx, { ifsc: e.target.value.toUpperCase() })}
                  maxLength={11}
                />
              </Field>
              <Field label="Branch" className="md:col-span-2">
                <input
                  className={inputClass}
                  value={r.branch ?? ""}
                  onChange={(e) => update(idx, { branch: e.target.value })}
                />
              </Field>
              <Field label="UPI ID">
                <input
                  className={inputClass}
                  value={r.upiId ?? ""}
                  onChange={(e) => update(idx, { upiId: e.target.value })}
                />
              </Field>
              <Field
                label="Opening balance (₹)"
                className="md:col-span-2"
                hint={
                  r.hasOpeningBalance
                    ? `Already posted · balance ${inr.format(r.currentBalance ?? 0)}`
                    : "Balance as on the day books begin."
                }
              >
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={inputClass}
                  value={r.hasOpeningBalance ? (r.currentBalance ?? 0) : (r.openingBalance ?? 0)}
                  onChange={(e) => update(idx, { openingBalance: Number(e.target.value) })}
                  disabled={r.hasOpeningBalance}
                />
              </Field>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 text-ink-muted">
                <input
                  type="radio"
                  name="defaultBank"
                  checked={r.isDefault}
                  onChange={() =>
                    setRows((rs) => rs.map((x, i) => ({ ...x, isDefault: i === idx })))
                  }
                />
                Default account on invoices
              </label>
              {!r.ledgerId && rows.length > 1 && (
                <button
                  type="button"
                  className="text-red-500 hover:underline"
                  onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <SecondaryButton onClick={() => setRows((rs) => [...rs, emptyAccount()])}>
          + Add an account
        </SecondaryButton>
      </div>

      <ErrorBox message={error} />
      <Actions>
        <div className="flex gap-2">
          <SecondaryButton onClick={onBack}>Back</SecondaryButton>
          <SecondaryButton onClick={() => save([])} disabled={busy}>
            Skip for now
          </SecondaryButton>
        </div>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </PrimaryButton>
      </Actions>
    </form>
  );
};

export default BankStep;
