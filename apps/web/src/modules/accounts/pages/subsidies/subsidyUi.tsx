import React, { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";

import {
  ActionPill,
  Chip,
  Field,
  Tile,
  fieldControlClass,
  type ChipTone,
} from "../../../../components/ui/v2";
import type {
  CapitalDetails,
  ClaimStatus,
  InterestDetails,
  LtptDetails,
  LtptMonthState,
  SchemeInput,
  SchemeKind,
  SchemeStatus,
  SubsidyScheme,
  SubsidySummary,
} from "../../../../services/subsidySchemesService";
import { money } from "../../../compliance/components/gstUi";
import { InlineAlert } from "../../../production/ui";

/** Labels, chips and the scheme form shared by the subsidy screens (TN-10). */
export const KIND_LABEL: Record<SchemeKind, string> = {
  CAPITAL_SUBSIDY: "Capital subsidy",
  POWER_SUBSIDY_LTPT: "LTPT power subsidy",
  INTEREST_SUBVENTION: "Interest subvention",
  NEEDS: "NEEDS",
  PLI: "PLI",
  STATE_OTHER: "Other state scheme",
  CENTRAL_OTHER: "Other central scheme",
};

export const SCHEME_STATUS_LABEL: Record<SchemeStatus, string> = {
  APPLIED: "Applied",
  SANCTIONED: "Sanctioned",
  ACTIVE: "Active",
  CLOSED: "Closed",
  REJECTED: "Rejected",
};
const SCHEME_TONE: Record<SchemeStatus, ChipTone> = {
  APPLIED: "info",
  SANCTIONED: "default",
  ACTIVE: "success",
  CLOSED: "muted",
  REJECTED: "danger",
};

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  FILED: "Filed",
  APPROVED: "Approved",
  DISBURSED: "Received",
  REJECTED: "Rejected",
};
const CLAIM_TONE: Record<ClaimStatus, ChipTone> = {
  DRAFT: "muted",
  FILED: "info",
  APPROVED: "warning",
  DISBURSED: "success",
  REJECTED: "danger",
};

export const MONTH_STATE: Record<LtptMonthState, { label: string; tone: ChipTone }> = {
  RECEIVED: { label: "Received", tone: "success" },
  CLAIMED: { label: "Claimed", tone: "info" },
  DUE: { label: "Due", tone: "warning" },
  MISSED: { label: "Missed", tone: "danger" },
  UPCOMING: { label: "Upcoming", tone: "muted" },
};

export const SchemeStatusChip: React.FC<{ status: SchemeStatus }> = ({ status }) => (
  <Chip size="sm" dot tone={SCHEME_TONE[status]}>
    {SCHEME_STATUS_LABEL[status]}
  </Chip>
);

export const ClaimStatusChip: React.FC<{ status: ClaimStatus }> = ({ status }) => (
  <Chip size="sm" dot tone={CLAIM_TONE[status]}>
    {CLAIM_STATUS_LABEL[status]}
  </Chip>
);

export const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Compact rupees for tiles: ₹12.5L, ₹1.2Cr. */
export const shortMoney = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  return money(v);
};

const AUTHORITIES = ["DIC", "TIIC", "SIPCOT", "SIDCO", "MSME-DI", "TANGEDCO", "Bank / SIDBI"];

// ── Scheme form ───────────────────────────────────────────────────────────────

type Str<T> = { [K in keyof T]-?: string };

interface FormState {
  schemeCode: string;
  kind: SchemeKind;
  name: string;
  authority: string;
  status: "APPLIED" | "SANCTIONED" | "ACTIVE";
  sanctionOrderNo: string;
  sanctionDate: string;
  sanctionedAmount: string;
  validFrom: string;
  validTo: string;
  eligibilityNotes: string;
  capital: Str<Omit<CapitalDetails, never>>;
  ltpt: Omit<Str<LtptDetails>, "tariffByMonth">;
  interest: Omit<Str<InterestDetails>, "balances">;
  balances: { from: string; principal: string }[];
}

const s = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "" : String(v);

const initialState = (
  scheme: SubsidyScheme | null,
  defaults: SubsidySummary["defaults"] | null
): FormState => {
  const d = (scheme?.details ?? {}) as Partial<CapitalDetails & LtptDetails & InterestDetails>;
  const kind = scheme?.kind ?? "CAPITAL_SUBSIDY";
  const isKind = (...k: SchemeKind[]) => !!scheme && k.includes(kind);
  return {
    schemeCode: scheme?.schemeCode ?? "",
    kind,
    name: scheme?.name ?? "",
    authority: scheme?.authority ?? "",
    status: "APPLIED",
    sanctionOrderNo: scheme?.sanctionOrderNo ?? "",
    sanctionDate: scheme?.sanctionDate ?? "",
    sanctionedAmount: s(scheme?.sanctionedAmount),
    validFrom: scheme?.validFrom ?? "",
    validTo: scheme?.validTo ?? "",
    eligibilityNotes: scheme?.eligibilityNotes ?? "",
    capital: {
      eligiblePlantMachinery: isKind("CAPITAL_SUBSIDY", "NEEDS") ? s(d.eligiblePlantMachinery) : "",
      ratePct: isKind("CAPITAL_SUBSIDY", "NEEDS")
        ? s(d.ratePct)
        : s(defaults?.CAPITAL_SUBSIDY.ratePct),
      extraPct: isKind("CAPITAL_SUBSIDY", "NEEDS") ? s(d.extraPct) : "",
      cap: isKind("CAPITAL_SUBSIDY", "NEEDS") ? s(d.cap) : s(defaults?.CAPITAL_SUBSIDY.cap),
    },
    ltpt: {
      startMonth: isKind("POWER_SUBSIDY_LTPT") ? s(d.startMonth) : "",
      months: isKind("POWER_SUBSIDY_LTPT")
        ? s(d.months)
        : s(defaults?.POWER_SUBSIDY_LTPT.months),
      ratePct: isKind("POWER_SUBSIDY_LTPT")
        ? s(d.ratePct)
        : s(defaults?.POWER_SUBSIDY_LTPT.ratePct),
      monthlyBaseTariff: isKind("POWER_SUBSIDY_LTPT") ? s(d.monthlyBaseTariff) : "",
      claimWindowDays: isKind("POWER_SUBSIDY_LTPT") ? s(d.claimWindowDays) : "",
    },
    interest: {
      loanAccountRef: isKind("INTEREST_SUBVENTION") ? s(d.loanAccountRef) : "",
      lender: isKind("INTEREST_SUBVENTION") ? s(d.lender) : "",
      sanctionedLoan: isKind("INTEREST_SUBVENTION") ? s(d.sanctionedLoan) : "",
      subventionPct: isKind("INTEREST_SUBVENTION")
        ? s(d.subventionPct)
        : s(defaults?.INTEREST_SUBVENTION.subventionPct),
      annualCap: isKind("INTEREST_SUBVENTION") ? s(d.annualCap) : "",
    },
    balances: isKind("INTEREST_SUBVENTION")
      ? (d.balances ?? []).map((b) => ({ from: b.from, principal: String(b.principal) }))
      : [],
  };
};

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const textOrNull = (v: string) => (v.trim() === "" ? null : v.trim());

const detailsOf = (f: FormState, keepLtptTariffs: Record<string, number> | null) => {
  switch (f.kind) {
    case "CAPITAL_SUBSIDY":
    case "NEEDS": {
      if (f.kind === "NEEDS" && !f.capital.eligiblePlantMachinery.trim()) return null;
      return {
        eligiblePlantMachinery: Number(f.capital.eligiblePlantMachinery),
        ratePct: Number(f.capital.ratePct),
        extraPct: numOrNull(f.capital.extraPct),
        cap: numOrNull(f.capital.cap),
      };
    }
    case "POWER_SUBSIDY_LTPT":
      return {
        startMonth: f.ltpt.startMonth,
        months: Number(f.ltpt.months),
        ratePct: Number(f.ltpt.ratePct),
        monthlyBaseTariff: Number(f.ltpt.monthlyBaseTariff),
        claimWindowDays: numOrNull(f.ltpt.claimWindowDays),
        ...(keepLtptTariffs ? { tariffByMonth: keepLtptTariffs } : {}),
      };
    case "INTEREST_SUBVENTION":
      return {
        loanAccountRef: f.interest.loanAccountRef.trim(),
        lender: textOrNull(f.interest.lender),
        sanctionedLoan: Number(f.interest.sanctionedLoan),
        subventionPct: Number(f.interest.subventionPct),
        annualCap: numOrNull(f.interest.annualCap),
        balances: f.balances
          .filter((b) => b.from && b.principal.trim() !== "")
          .map((b) => ({ from: b.from, principal: Number(b.principal) })),
      };
    default:
      return null;
  }
};

const input = fieldControlClass();

export const SchemeForm: React.FC<{
  scheme: SubsidyScheme | null;
  defaults: SubsidySummary["defaults"] | null;
  verifyNote: string;
  onCancel: () => void;
  onSubmit: (body: SchemeInput) => Promise<void>;
}> = ({ scheme, defaults, verifyNote, onCancel, onSubmit }) => {
  const [f, setF] = useState<FormState>(() => initialState(scheme, defaults));
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(initialState(scheme, defaults)), [scheme, defaults]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const setIn = <G extends "capital" | "ltpt" | "interest">(
    g: G,
    k: keyof FormState[G],
    v: string
  ) => setF((x) => ({ ...x, [g]: { ...x[g], [k]: v } }));

  const kindLocked = !!scheme && scheme.claimCount > 0;
  const preview = useMemo(() => {
    if (f.kind === "CAPITAL_SUBSIDY" || f.kind === "NEEDS") {
      const pm = Number(f.capital.eligiblePlantMachinery);
      const pct = Number(f.capital.ratePct) + Number(f.capital.extraPct || 0);
      if (!pm || !pct) return null;
      const gross = (pm * pct) / 100;
      const cap = numOrNull(f.capital.cap);
      return cap !== null && gross > cap
        ? `${money(cap)} (capped; ${pct}% would be ${money(gross)})`
        : `${money(gross)} at ${pct}%`;
    }
    if (f.kind === "POWER_SUBSIDY_LTPT") {
      const t = Number(f.ltpt.monthlyBaseTariff);
      const r = Number(f.ltpt.ratePct);
      const m = Number(f.ltpt.months);
      if (!t || !r) return null;
      return `${money((t * r) / 100)} a month${m ? `, ${money((t * r * m) / 100)} over ${m} months` : ""}`;
    }
    if (f.kind === "INTEREST_SUBVENTION") {
      const l = Number(f.interest.sanctionedLoan);
      const r = Number(f.interest.subventionPct);
      if (!l || !r) return null;
      return `${money((l * r) / 100)} a year on the full sanctioned loan`;
    }
    return null;
  }, [f]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const existingTariffs =
        scheme?.kind === "POWER_SUBSIDY_LTPT"
          ? ((scheme.details as LtptDetails | null)?.tariffByMonth ?? null)
          : null;
      const body: SchemeInput = {
        schemeCode: f.schemeCode.trim(),
        name: f.name.trim(),
        authority: textOrNull(f.authority),
        sanctionOrderNo: textOrNull(f.sanctionOrderNo),
        sanctionDate: f.sanctionDate || null,
        sanctionedAmount: numOrNull(f.sanctionedAmount),
        validFrom: f.validFrom || null,
        validTo: f.validTo || null,
        eligibilityNotes: textOrNull(f.eligibilityNotes),
        details: detailsOf(f, existingTariffs),
      };
      if (!scheme) {
        body.kind = f.kind;
        body.status = f.status;
      } else if (!kindLocked && f.kind !== scheme.kind) {
        body.kind = f.kind;
      }
      await onSubmit(body);
    } finally {
      setBusy(false);
    }
  };

  const showCapital = f.kind === "CAPITAL_SUBSIDY" || f.kind === "NEEDS";
  const needsSanction = !scheme && f.status !== "APPLIED";

  return (
    <Tile
      padding="md"
      title={scheme ? `Edit ${scheme.schemeCode}` : "Add a scheme"}
      subtitle="Enter the figures from your sanction order; the suggested rates are only a starting point."
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
          <Field label="Scheme code" required hint="Your own short code, e.g. CAP-2026">
            <input
              className={input}
              value={f.schemeCode}
              onChange={(e) => set("schemeCode", e.target.value.toUpperCase())}
              maxLength={30}
              required
            />
          </Field>
          <Field
            label="Kind"
            required
            hint={kindLocked ? "Fixed once claims exist" : undefined}
            className="md:col-span-1"
          >
            <select
              className={input}
              value={f.kind}
              disabled={kindLocked}
              onChange={(e) => set("kind", e.target.value as SchemeKind)}
            >
              {(Object.keys(KIND_LABEL) as SchemeKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name" required className="md:col-span-2">
            <input
              className={input}
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={150}
              placeholder="e.g. Capital subsidy on the new CNC line"
              required
            />
          </Field>
          <Field label="Authority">
            <input
              className={input}
              list="subsidy-authorities"
              value={f.authority}
              onChange={(e) => set("authority", e.target.value)}
              maxLength={80}
              placeholder="DIC, TIIC, SIPCOT …"
            />
          </Field>
          {!scheme && (
            <Field label="Stage">
              <select
                className={input}
                value={f.status}
                onChange={(e) => set("status", e.target.value as FormState["status"])}
              >
                <option value="APPLIED">Applied</option>
                <option value="SANCTIONED">Sanctioned</option>
                <option value="ACTIVE">Active</option>
              </select>
            </Field>
          )}
          <Field label="Sanction order no." required={needsSanction}>
            <input
              className={input}
              value={f.sanctionOrderNo}
              onChange={(e) => set("sanctionOrderNo", e.target.value)}
              maxLength={80}
              required={needsSanction}
            />
          </Field>
          <Field label="Sanction date" required={needsSanction}>
            <input
              type="date"
              className={input}
              value={f.sanctionDate}
              max={todayIso()}
              onChange={(e) => set("sanctionDate", e.target.value)}
              required={needsSanction}
            />
          </Field>
          <Field label="Sanctioned amount (₹)">
            <input
              className={input}
              inputMode="decimal"
              value={f.sanctionedAmount}
              onChange={(e) => set("sanctionedAmount", e.target.value)}
            />
          </Field>
          <Field label="Valid from">
            <input
              type="date"
              className={input}
              value={f.validFrom}
              onChange={(e) => set("validFrom", e.target.value)}
            />
          </Field>
          <Field label="Valid to">
            <input
              type="date"
              className={input}
              value={f.validTo}
              min={f.validFrom || undefined}
              onChange={(e) => set("validTo", e.target.value)}
            />
          </Field>
          <Field label="Eligibility notes" className="md:col-span-4">
            <textarea
              className="sl-input min-h-[72px] py-2.5"
              value={f.eligibilityNotes}
              onChange={(e) => set("eligibilityNotes", e.target.value)}
              maxLength={2000}
              placeholder="Conditions, documents to keep, service connection number, lock-in …"
            />
          </Field>
        </div>
        <datalist id="subsidy-authorities">
          {AUTHORITIES.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>

        {(showCapital ||
          f.kind === "POWER_SUBSIDY_LTPT" ||
          f.kind === "INTEREST_SUBVENTION") && (
          <div className="flex flex-col gap-4 rounded-[14px] bg-card-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="sl-section-label m-0">{KIND_LABEL[f.kind]} figures</p>
              {preview && (
                <Chip size="sm" tone="info">
                  {preview}
                </Chip>
              )}
            </div>
            <InlineAlert tone="warning" title="Verify with the current G.O.">
              {verifyNote}
            </InlineAlert>
            {showCapital && (
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
                <Field label="Eligible plant & machinery (₹)" required={f.kind !== "NEEDS"}>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={f.capital.eligiblePlantMachinery}
                    onChange={(e) => setIn("capital", "eligiblePlantMachinery", e.target.value)}
                    required={f.kind !== "NEEDS"}
                  />
                </Field>
                <Field label="Subsidy rate (%)" required>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={f.capital.ratePct}
                    onChange={(e) => setIn("capital", "ratePct", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Extra rate (%)" hint="Micro unit, women, SC/ST …">
                  <input
                    className={input}
                    inputMode="decimal"
                    value={f.capital.extraPct}
                    onChange={(e) => setIn("capital", "extraPct", e.target.value)}
                  />
                </Field>
                <Field label="Cap (₹)" hint="Leave empty for none">
                  <input
                    className={input}
                    inputMode="decimal"
                    value={f.capital.cap}
                    onChange={(e) => setIn("capital", "cap", e.target.value)}
                  />
                </Field>
              </div>
            )}
            {f.kind === "POWER_SUBSIDY_LTPT" && (
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-5">
                <Field label="First month" required>
                  <input
                    type="month"
                    className={input}
                    value={f.ltpt.startMonth}
                    onChange={(e) => setIn("ltpt", "startMonth", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Months" required>
                  <input
                    className={input}
                    inputMode="numeric"
                    value={f.ltpt.months}
                    onChange={(e) => setIn("ltpt", "months", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Rate (%)" required>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={f.ltpt.ratePct}
                    onChange={(e) => setIn("ltpt", "ratePct", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Base tariff a month (₹)" required>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={f.ltpt.monthlyBaseTariff}
                    onChange={(e) => setIn("ltpt", "monthlyBaseTariff", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Claim within (days)" hint="After month end; optional">
                  <input
                    className={input}
                    inputMode="numeric"
                    value={f.ltpt.claimWindowDays}
                    onChange={(e) => setIn("ltpt", "claimWindowDays", e.target.value)}
                  />
                </Field>
              </div>
            )}
            {f.kind === "INTEREST_SUBVENTION" && (
              <>
                <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-5">
                  <Field label="Loan account no." required>
                    <input
                      className={input}
                      value={f.interest.loanAccountRef}
                      onChange={(e) => setIn("interest", "loanAccountRef", e.target.value)}
                      maxLength={40}
                      required
                    />
                  </Field>
                  <Field label="Lender">
                    <input
                      className={input}
                      value={f.interest.lender}
                      onChange={(e) => setIn("interest", "lender", e.target.value)}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Sanctioned loan (₹)" required>
                    <input
                      className={input}
                      inputMode="decimal"
                      value={f.interest.sanctionedLoan}
                      onChange={(e) => setIn("interest", "sanctionedLoan", e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Subvention (% a year)" required>
                    <input
                      className={input}
                      inputMode="decimal"
                      value={f.interest.subventionPct}
                      onChange={(e) => setIn("interest", "subventionPct", e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Annual cap (₹)" hint="Optional">
                    <input
                      className={input}
                      inputMode="decimal"
                      value={f.interest.annualCap}
                      onChange={(e) => setIn("interest", "annualCap", e.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="m-0 text-[13px] font-medium text-ink-subtle">
                    Principal outstanding from a date (the sanctioned loan is used before the
                    first entry)
                  </p>
                  {f.balances.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        aria-label={`Balance ${i + 1} from`}
                        className={fieldControlClass(false, "w-auto")}
                        value={b.from}
                        onChange={(e) =>
                          set(
                            "balances",
                            f.balances.map((x, j) => (j === i ? { ...x, from: e.target.value } : x))
                          )
                        }
                      />
                      <input
                        aria-label={`Balance ${i + 1} principal`}
                        className={fieldControlClass(false, "w-40")}
                        inputMode="decimal"
                        placeholder="Principal ₹"
                        value={b.principal}
                        onChange={(e) =>
                          set(
                            "balances",
                            f.balances.map((x, j) =>
                              j === i ? { ...x, principal: e.target.value } : x
                            )
                          )
                        }
                      />
                      <button
                        type="button"
                        className="sl-icon-btn sl-icon-btn-md"
                        aria-label={`Remove balance ${i + 1}`}
                        onClick={() =>
                          set(
                            "balances",
                            f.balances.filter((_, j) => j !== i)
                          )
                        }
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <div>
                    <ActionPill
                      variant="secondary"
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() =>
                        set("balances", [...f.balances, { from: todayIso(), principal: "" }])
                      }
                    >
                      Add balance
                    </ActionPill>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <ActionPill variant="secondary" onClick={onCancel}>
            Cancel
          </ActionPill>
          <ActionPill type="submit" icon={<Check size={17} />} disabled={busy}>
            {scheme ? "Save scheme" : "Add scheme"}
          </ActionPill>
        </div>
      </form>
    </Tile>
  );
};
