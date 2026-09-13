import React, { useMemo, useState } from "react";
import { onboardingService } from "../../../services/onboardingService";
import type { OnboardingState, OnboardingStepKey } from "../types";
import { Actions, ErrorBox, Field, PrimaryButton, SecondaryButton, StepHeader } from "./fields";
import { apiMessage, inputClass } from "./utils";

interface Props {
  state: OnboardingState;
  onSaved: (next: OnboardingStepKey) => Promise<void>;
  onBack: () => void;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Same rule as the API: April–March gives `2026-27`, a calendar year gives `2026`. */
const describe = (year: number, month: number) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year + 1, month - 1, 0));
  const code = month === 1 ? `${year}` : `${year}-${pad((year + 1) % 100)}`;
  return { start: iso(start), end: iso(end), code };
};

const FinancialYearStep: React.FC<Props> = ({ state, onSaved, onBack }) => {
  const thisYear = new Date().getUTCFullYear();
  const initial = state.financialYear?.start ?? `${thisYear}-04-01`;
  const [year, setYear] = useState(Number(initial.slice(0, 4)));
  const [month, setMonth] = useState(Number(initial.slice(5, 7)));
  const [booksBeginOn, setBooksBeginOn] = useState(state.financialYear?.booksBeginOn ?? initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fy = useMemo(() => describe(year, month), [year, month]);

  const onStartChange = (nextYear: number, nextMonth: number) => {
    const before = describe(year, month);
    setYear(nextYear);
    setMonth(nextMonth);
    // Keep "books begin" aligned with the start unless the user moved it deliberately.
    if (booksBeginOn === before.start) setBooksBeginOn(describe(nextYear, nextMonth).start);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await onboardingService.saveFinancialYear({ fyStart: fy.start, booksBeginOn });
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
        title="Financial year"
        subtitle="Document numbers reset and reports close on this cycle. Indian companies file on April to March."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="First month">
          <select
            name="fyMonth"
            className={inputClass}
            value={month}
            onChange={(e) => onStartChange(year, Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starting year">
          <select
            name="fyYear"
            className={inputClass}
            value={year}
            onChange={(e) => onStartChange(Number(e.target.value), month)}
          >
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Books begin on" hint="Opening balances are entered as on this date.">
          <input
            name="booksBeginOn"
            type="date"
            className={inputClass}
            value={booksBeginOn}
            min={fy.start}
            max={fy.end}
            onChange={(e) => setBooksBeginOn(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-6 rounded-md border border-line-soft bg-card-2/60 p-4 text-sm">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-muted">Financial year</div>
            <div className="font-bold text-ink">FY {fy.code}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-muted">Runs</div>
            <div className="text-ink">
              {fy.start} → {fy.end}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-muted">Invoice numbers</div>
            <div className="font-mono text-ink">INV-{fy.code}-0001</div>
          </div>
        </div>
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

export default FinancialYearStep;
