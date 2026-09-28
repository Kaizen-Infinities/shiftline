import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Check, FilePlus2, Landmark, Pencil, Trash2, Wand2, X } from "lucide-react";

import { usePermission } from "../../../../hooks/usePermission";
import {
  subsidySchemesService,
  type ClaimStatus,
  type ClaimStatusChange,
  type InterestDetails,
  type SchemeStatus,
  type SubsidyClaim,
  type SubsidySchemeDetail,
  type SubsidySummary,
} from "../../../../services/subsidySchemesService";
import { day, message, money } from "../../../compliance/components/gstUi";
import {
  ActionPill,
  Chip,
  EmptyState,
  Field,
  PageHeader,
  SkeletonTile,
  StatTile,
  Tile,
  cx,
  fieldControlClass,
} from "../../../../components/ui/v2";
import { ErrorTile, Figure, InfoItem, InlineAlert, PageBody } from "../../../production/ui";
import {
  CLAIM_STATUS_LABEL,
  ClaimStatusChip,
  KIND_LABEL,
  MONTH_STATE,
  SCHEME_STATUS_LABEL,
  SchemeForm,
  SchemeStatusChip,
  monthLabel,
  shortMoney,
  todayIso,
} from "./subsidyUi";

/**
 * One subsidy scheme (TN-10): its sanction, the kind's own arithmetic (capital entitlement, the
 * LTPT month grid, interest subvention to date), and the claims filed under it, moved forward
 * from draft to money in the bank.
 */
const input = fieldControlClass();
const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-3 text-sm text-ink align-middle";

const SCHEME_ACTION: Record<SchemeStatus, string> = {
  APPLIED: "Applied",
  SANCTIONED: "Mark sanctioned",
  ACTIVE: "Activate",
  CLOSED: "Close scheme",
  REJECTED: "Mark rejected",
};
const CLAIM_ACTION: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  FILED: "Mark filed",
  APPROVED: "Mark approved",
  DISBURSED: "Record receipt",
  REJECTED: "Rejected",
};

// ── Kind-specific tiles ─────────────────────────────────────────────────────

const LtptGrid: React.FC<{ calc: Extract<SubsidySchemeDetail["calc"], { type: "LTPT" }> }> = ({
  calc,
}) => (
  <Tile
    padding="md"
    title="Power subsidy, month by month"
    subtitle={`${monthLabel(calc.firstMonth)} to ${monthLabel(calc.lastMonth)} · ${money(calc.totals.entitlement)} in all`}
  >
    <div className="mb-3 flex flex-wrap gap-2" aria-label="Legend">
      {(Object.keys(MONTH_STATE) as (keyof typeof MONTH_STATE)[]).map((k) => (
        <Chip key={k} size="sm" dot tone={MONTH_STATE[k].tone}>
          {MONTH_STATE[k].label}
        </Chip>
      ))}
    </div>
    <ol className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4 lg:grid-cols-6">
      {calc.months.map((m) => (
        <li
          key={m.month}
          className={cx(
            "rounded-[12px] border border-line-soft bg-card-2 px-2.5 py-2",
            m.state === "DUE" && "border-[color:var(--color-warning)]",
            m.state === "MISSED" && "border-[color:var(--color-danger)]"
          )}
          title={
            m.claimNo
              ? `${m.claimNo} (${CLAIM_STATUS_LABEL[m.claimStatus ?? "DRAFT"]})`
              : m.claimBy
                ? `Claim by ${day(m.claimBy)}`
                : undefined
          }
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-[12px] font-semibold text-ink">{monthLabel(m.month)}</span>
            <span className="text-[11px] text-ink-subtle">#{m.index}</span>
          </div>
          <div className="text-[13px] font-semibold tabular-nums text-ink">
            {money(m.entitlement)}
          </div>
          <Chip size="sm" dot tone={MONTH_STATE[m.state].tone} className="mt-1">
            {MONTH_STATE[m.state].label}
          </Chip>
        </li>
      ))}
    </ol>
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Figure label="Received" value={money(calc.totals.received)} tone="success" />
      <Figure label="Claimed" value={money(calc.totals.claimed)} />
      <Figure
        label="Due to claim"
        value={money(calc.totals.due)}
        hint={`${calc.totals.dueMonths} month${calc.totals.dueMonths === 1 ? "" : "s"}`}
        tone={calc.totals.dueMonths ? "warning" : "default"}
      />
      <Figure
        label="Missed"
        value={money(calc.totals.missed)}
        hint={`${calc.totals.missedMonths} month${calc.totals.missedMonths === 1 ? "" : "s"}`}
        tone={calc.totals.missedMonths ? "danger" : "default"}
      />
    </div>
  </Tile>
);

const CalcTile: React.FC<{ scheme: SubsidySchemeDetail }> = ({ scheme }) => {
  const c = scheme.calc;
  if (!c) return null;
  if (c.type === "LTPT") return <LtptGrid calc={c} />;
  if (c.type === "CAPITAL") {
    const d = scheme.details as { eligiblePlantMachinery: number; cap?: number | null };
    return (
      <Tile padding="md" title="Capital subsidy entitlement">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Eligible plant & machinery" value={money(d.eligiblePlantMachinery)} />
          <Figure label="Rate" value={`${c.effectivePct}%`} hint={money(c.gross)} />
          <Figure label="Cap" value={d.cap ? money(d.cap) : "None entered"} />
          <Figure
            label="Entitlement"
            value={money(c.entitlement)}
            hint={c.capped ? "Held at the cap" : undefined}
            tone="accent"
          />
        </div>
      </Tile>
    );
  }
  const d = scheme.details as InterestDetails;
  return (
    <Tile padding="md" title="Interest subvention">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Loan" value={money(d.sanctionedLoan)} hint={`${d.loanAccountRef}${d.lender ? ` · ${d.lender}` : ""}`} />
        <Figure label="Subvention" value={`${d.subventionPct}% a year`} hint={d.annualCap ? `Cap ${money(d.annualCap)} a year` : undefined} />
        <Figure
          label="This year so far"
          value={money(c.fyToDate.amount)}
          hint={`${c.fyToDate.days} days since ${day(c.fyFrom)}${c.fyToDate.capped ? ", capped" : ""}`}
          tone="accent"
        />
        <Figure label="Full year on the sanctioned loan" value={money(c.fullYearAtSanction)} />
      </div>
    </Tile>
  );
};

// ── Claim form ──────────────────────────────────────────────────────────────

const ClaimForm: React.FC<{
  scheme: SubsidySchemeDetail;
  claim: SubsidyClaim | null;
  onCancel: () => void;
  onSaved: (s: SubsidySchemeDetail) => void;
}> = ({ scheme, claim, onCancel, onSaved }) => {
  const [f, setF] = useState({
    claimNo: "",
    periodFrom: claim?.periodFrom ?? "",
    periodTo: claim?.periodTo ?? "",
    amountClaimed: claim ? String(claim.amountClaimed) : "",
    notes: claim?.notes ?? "",
  });
  const [basis, setBasis] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const suggest = async () => {
    if (!f.periodFrom || !f.periodTo) {
      toast.info("Pick the claim period first");
      return;
    }
    try {
      const r = await subsidySchemesService.entitlement(scheme.id, f.periodFrom, f.periodTo);
      if (r.amount === null) {
        toast.info("This scheme has no figures to work the amount out from");
        return;
      }
      setF((x) => ({ ...x, amountClaimed: String(r.amount) }));
      setBasis(r.basis);
    } catch (err) {
      toast.error(message(err));
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        periodFrom: f.periodFrom,
        periodTo: f.periodTo,
        amountClaimed: Number(f.amountClaimed),
        notes: f.notes.trim() || null,
      };
      const saved = claim
        ? await subsidySchemesService.updateClaim(scheme.id, claim.id, body)
        : await subsidySchemesService.createClaim(scheme.id, {
            ...body,
            ...(f.claimNo.trim() ? { claimNo: f.claimNo.trim() } : {}),
          });
      toast.success(claim ? "Claim saved" : "Claim saved as a draft");
      onSaved(saved);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tile
      padding="md"
      title={claim ? `Edit ${claim.claimNo}` : "File a claim"}
      subtitle="Saved as a draft; mark it filed once it reaches the authority."
    >
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
        <Field label="Period from" required>
          <input
            type="date"
            className={input}
            value={f.periodFrom}
            max={todayIso()}
            min={scheme.validFrom ?? undefined}
            onChange={(e) => setF((x) => ({ ...x, periodFrom: e.target.value }))}
            required
          />
        </Field>
        <Field label="Period to" required>
          <input
            type="date"
            className={input}
            value={f.periodTo}
            min={f.periodFrom || undefined}
            max={scheme.validTo ?? undefined}
            onChange={(e) => setF((x) => ({ ...x, periodTo: e.target.value }))}
            required
          />
        </Field>
        <Field label="Amount claimed (₹)" required hint={basis ?? undefined}>
          <input
            className={input}
            inputMode="decimal"
            value={f.amountClaimed}
            onChange={(e) => setF((x) => ({ ...x, amountClaimed: e.target.value }))}
            required
          />
        </Field>
        <div className="flex items-end">
          <ActionPill variant="secondary" icon={<Wand2 size={15} />} onClick={() => void suggest()}>
            Work it out
          </ActionPill>
        </div>
        {!claim && (
          <Field label="Claim no." hint="Leave empty to number it automatically">
            <input
              className={input}
              value={f.claimNo}
              maxLength={30}
              onChange={(e) => setF((x) => ({ ...x, claimNo: e.target.value.toUpperCase() }))}
            />
          </Field>
        )}
        <Field label="Notes" className={claim ? "md:col-span-4" : "md:col-span-3"}>
          <input
            className={input}
            value={f.notes}
            maxLength={1000}
            onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-2.5 md:col-span-4">
          <ActionPill variant="secondary" onClick={onCancel}>
            Cancel
          </ActionPill>
          <ActionPill type="submit" icon={<Check size={17} />} disabled={busy}>
            {claim ? "Save claim" : "Save draft"}
          </ActionPill>
        </div>
      </form>
    </Tile>
  );
};

// ── Status step (inline) ────────────────────────────────────────────────────

const ClaimStep: React.FC<{
  claim: SubsidyClaim;
  to: ClaimStatus;
  onCancel: () => void;
  onSubmit: (body: ClaimStatusChange) => Promise<void>;
}> = ({ claim, to, onCancel, onSubmit }) => {
  const [f, setF] = useState({
    date: todayIso(),
    referenceNo: claim.referenceNo ?? "",
    amount: String(claim.approvedAmount ?? claim.amountClaimed),
    bankRef: "",
    reason: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: ClaimStatusChange = { status: to };
    if (to === "FILED") {
      body.filedOn = f.date;
      if (f.referenceNo.trim()) body.referenceNo = f.referenceNo.trim();
    } else if (to === "APPROVED") {
      body.approvedOn = f.date;
      if (f.amount.trim()) body.approvedAmount = Number(f.amount);
      if (f.referenceNo.trim()) body.referenceNo = f.referenceNo.trim();
    } else if (to === "DISBURSED") {
      body.disbursedOn = f.date;
      body.disbursedAmount = Number(f.amount);
      if (f.bankRef.trim()) body.bankRef = f.bankRef.trim();
    } else if (to === "REJECTED") {
      body.rejectionReason = f.reason.trim();
    }
    await onSubmit(body);
  };
  const cls = fieldControlClass(false, "h-10");
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-2 rounded-[12px] bg-card-2 p-3">
      <span className="w-full text-[13px] font-semibold text-ink">
        {CLAIM_ACTION[to]}: {claim.claimNo}
      </span>
      {to !== "REJECTED" && (
        <label className="flex flex-col text-[12px] text-ink-subtle">
          {to === "FILED" ? "Filed on" : to === "APPROVED" ? "Approved on" : "Received on"}
          <input type="date" className={cls} value={f.date} max={todayIso()} onChange={(e) => set("date", e.target.value)} required />
        </label>
      )}
      {(to === "FILED" || to === "APPROVED") && (
        <label className="flex flex-col text-[12px] text-ink-subtle">
          Acknowledgement / reference
          <input className={cls} value={f.referenceNo} maxLength={80} onChange={(e) => set("referenceNo", e.target.value)} />
        </label>
      )}
      {(to === "APPROVED" || to === "DISBURSED") && (
        <label className="flex flex-col text-[12px] text-ink-subtle">
          {to === "APPROVED" ? "Approved amount (₹)" : "Amount received (₹)"}
          <input className={cls} inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} required={to === "DISBURSED"} />
        </label>
      )}
      {to === "DISBURSED" && (
        <label className="flex flex-col text-[12px] text-ink-subtle">
          Bank reference (UTR)
          <input className={cls} value={f.bankRef} maxLength={80} onChange={(e) => set("bankRef", e.target.value)} />
        </label>
      )}
      {to === "REJECTED" && (
        <label className="flex min-w-[240px] flex-1 flex-col text-[12px] text-ink-subtle">
          Why was it rejected?
          <input className={cls} value={f.reason} maxLength={500} onChange={(e) => set("reason", e.target.value)} required />
        </label>
      )}
      <div className="ml-auto flex gap-2">
        <ActionPill variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </ActionPill>
        <ActionPill type="submit" size="sm" variant={to === "REJECTED" ? "danger" : "cta"} icon={<Check size={14} />}>
          Save
        </ActionPill>
      </div>
    </form>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────

const SubsidySchemePage: React.FC = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermission();
  const canCreate = can("subsidy-schemes.create");
  const canEdit = can("subsidy-schemes.edit");

  const [scheme, setScheme] = useState<SubsidySchemeDetail | null>(null);
  const [defaults, setDefaults] = useState<SubsidySummary["defaults"] | null>(null);
  const [failed, setFailed] = useState<"missing" | "error" | null>(null);
  const [editing, setEditing] = useState(false);
  const [claimForm, setClaimForm] = useState<SubsidyClaim | "new" | null>(null);
  const [step, setStep] = useState<{ claimId: string; to: ClaimStatus } | null>(null);
  const [sanction, setSanction] = useState(false);
  const [sf, setSf] = useState({ orderNo: "", date: "", amount: "" });

  const load = useCallback(async () => {
    setFailed(null);
    try {
      setScheme(await subsidySchemesService.get(id));
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setFailed(status === 404 || status === 400 ? "missing" : "error");
    }
  }, [id]);

  useEffect(() => {
    void load();
    subsidySchemesService
      .summary()
      .then((s) => setDefaults(s.defaults))
      .catch(() => setDefaults(null));
  }, [load]);

  useEffect(() => {
    if (scheme) {
      setSf({
        orderNo: scheme.sanctionOrderNo ?? "",
        date: scheme.sanctionDate ?? "",
        amount: scheme.sanctionedAmount !== null ? String(scheme.sanctionedAmount) : "",
      });
    }
  }, [scheme]);

  const act = async (fn: () => Promise<SubsidySchemeDetail>, ok: string) => {
    try {
      setScheme(await fn());
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(message(err));
      return false;
    }
  };

  const moveScheme = async (to: SchemeStatus) => {
    if (!scheme) return;
    if (to === "SANCTIONED" && !sanction) {
      setSanction(true);
      return;
    }
    const body =
      to === "SANCTIONED"
        ? {
            status: to,
            sanctionOrderNo: sf.orderNo.trim() || undefined,
            sanctionDate: sf.date || undefined,
            ...(sf.amount.trim() ? { sanctionedAmount: Number(sf.amount) } : {}),
          }
        : { status: to };
    if ((to === "CLOSED" || to === "REJECTED") && !window.confirm(`${SCHEME_ACTION[to]}? This cannot be undone.`)) {
      return;
    }
    if (await act(() => subsidySchemesService.setStatus(scheme.id, body), `Scheme ${SCHEME_STATUS_LABEL[to].toLowerCase()}`)) {
      setSanction(false);
    }
  };

  const remove = async () => {
    if (!scheme || !window.confirm(`Delete ${scheme.schemeCode}? It has no claims.`)) return;
    try {
      await subsidySchemesService.remove(scheme.id);
      toast.success("Scheme deleted");
      navigate("/accounts/subsidies");
    } catch (err) {
      toast.error(message(err));
    }
  };

  if (failed) {
    return (
      <PageBody>
        <PageHeader title="Subsidy scheme" back="/accounts/subsidies" />
        {failed === "missing" ? (
          <Tile>
            <EmptyState icon={<Landmark size={26} />} title="That scheme does not exist." />
          </Tile>
        ) : (
          <ErrorTile onRetry={() => void load()} />
        )}
      </PageBody>
    );
  }
  if (!scheme) {
    return (
      <PageBody>
        <SkeletonTile />
        <SkeletonTile />
      </PageBody>
    );
  }

  const t = scheme.totals;
  const locked = scheme.status === "CLOSED" || scheme.status === "REJECTED";

  return (
    <PageBody>
      <PageHeader
        back="/accounts/subsidies"
        breadcrumbs={[
          { label: "Accounts", to: "/hub/accounts" },
          { label: "Subsidies & schemes", to: "/accounts/subsidies" },
          { label: scheme.schemeCode },
        ]}
        title={scheme.name}
        meta={
          <>
            <SchemeStatusChip status={scheme.status} />
            <Chip size="sm" tone="muted">
              {KIND_LABEL[scheme.kind]}
            </Chip>
          </>
        }
        subtitle={[scheme.schemeCode, scheme.authority, scheme.sanctionOrderNo].filter(Boolean).join(" · ")}
        actions={
          <>
            {canEdit && !locked && (
              <ActionPill variant="secondary" icon={<Pencil size={15} />} onClick={() => setEditing(true)}>
                Edit
              </ActionPill>
            )}
            {canEdit &&
              scheme.nextStatuses.map((to) => (
                <ActionPill
                  key={to}
                  variant={to === "REJECTED" || to === "CLOSED" ? "secondary" : "blue"}
                  onClick={() => void moveScheme(to)}
                >
                  {SCHEME_ACTION[to]}
                </ActionPill>
              ))}
            {canEdit && scheme.claimCount === 0 && (
              <ActionPill variant="secondary" icon={<Trash2 size={15} />} onClick={() => void remove()} aria-label="Delete scheme">
                Delete
              </ActionPill>
            )}
          </>
        }
        primaryAction={
          canCreate && scheme.takesClaims ? (
            <ActionPill icon={<FilePlus2 size={18} />} onClick={() => setClaimForm("new")}>
              File claim
            </ActionPill>
          ) : undefined
        }
      />

      {sanction && (
        <Tile padding="md" title="Sanction particulars" subtitle="From the sanction order you received.">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void moveScheme("SANCTIONED");
            }}
            className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4"
          >
            <Field label="Sanction order no." required>
              <input className={input} value={sf.orderNo} maxLength={80} onChange={(e) => setSf((x) => ({ ...x, orderNo: e.target.value }))} required />
            </Field>
            <Field label="Sanction date" required>
              <input type="date" className={input} value={sf.date} max={todayIso()} onChange={(e) => setSf((x) => ({ ...x, date: e.target.value }))} required />
            </Field>
            <Field label="Sanctioned amount (₹)">
              <input className={input} inputMode="decimal" value={sf.amount} onChange={(e) => setSf((x) => ({ ...x, amount: e.target.value }))} />
            </Field>
            <div className="flex items-end justify-end gap-2.5">
              <ActionPill variant="secondary" icon={<X size={15} />} onClick={() => setSanction(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />}>
                Sanctioned
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      {editing && (
        <SchemeForm
          scheme={scheme}
          defaults={defaults}
          verifyNote={scheme.verifyNote}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            if (await act(() => subsidySchemesService.update(scheme.id, body), "Scheme saved")) {
              setEditing(false);
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={scheme.sanctionedAmount !== null ? "Sanctioned" : "Expected"}
          value={scheme.expected !== null ? shortMoney(scheme.expected) : "—"}
          hint={scheme.sanctionDate ? `On ${day(scheme.sanctionDate)}` : "Not sanctioned yet"}
        />
        <StatTile label="Claimed" value={shortMoney(t.claimed)} hint={t.drafted ? `${shortMoney(t.drafted)} in drafts` : `${scheme.claimCount} claims`} />
        <StatTile label="Received" value={shortMoney(t.disbursed)} hint={t.shortfall ? `${shortMoney(t.shortfall)} short` : "In the bank"} />
        <StatTile label="Pending" value={shortMoney(t.pending)} hint={t.unclaimed !== null ? `${shortMoney(t.unclaimed)} not yet claimed` : "Filed, awaiting money"} />
      </div>

      {claimForm && (
        <ClaimForm
          scheme={scheme}
          claim={claimForm === "new" ? null : claimForm}
          onCancel={() => setClaimForm(null)}
          onSaved={(s) => {
            setScheme(s);
            setClaimForm(null);
          }}
        />
      )}

      <CalcTile scheme={scheme} />

      <Tile padding="none" divider title="Claims" subtitle="Draft → filed → approved → received. A claim only moves forward.">
        {scheme.claims.length === 0 ? (
          <EmptyState
            compact
            icon={<FilePlus2 size={22} />}
            title="No claims yet."
            description={scheme.takesClaims ? "File the first claim under this scheme." : "Claims open once the scheme is sanctioned."}
            action={
              canCreate && scheme.takesClaims ? (
                <ActionPill icon={<FilePlus2 size={18} />} onClick={() => setClaimForm("new")}>
                  File claim
                </ActionPill>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]" aria-label="Claims">
              <thead className="bg-card-2">
                <tr>
                  <th scope="col" className={th}>Claim</th>
                  <th scope="col" className={th}>Period</th>
                  <th scope="col" className={`${th} !text-right`}>Claimed</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Filed</th>
                  <th scope="col" className={`${th} !text-right`}>Received</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {scheme.claims.map((c) => (
                  <React.Fragment key={c.id}>
                    <tr className="border-t border-line-soft">
                      <td className={td}>
                        <div className="font-mono text-[13px] font-semibold text-accent">{c.claimNo}</div>
                        {c.referenceNo && <div className="sl-muted text-[12px]">Ref {c.referenceNo}</div>}
                      </td>
                      <td className={`${td} tabular-nums`}>
                        {day(c.periodFrom)} – {day(c.periodTo)}
                      </td>
                      <td className={`${td} text-right font-semibold tabular-nums`}>{money(c.amountClaimed)}</td>
                      <td className={td}>
                        <ClaimStatusChip status={c.status} />
                        {c.rejectionReason && <div className="sl-muted mt-0.5 max-w-[200px] truncate text-[12px]" title={c.rejectionReason}>{c.rejectionReason}</div>}
                      </td>
                      <td className={`${td} tabular-nums`}>
                        {day(c.filedOn)}
                        {c.daysPending !== null && (
                          <div className={cx("text-[12px]", c.daysPending > 90 ? "font-semibold text-[color:var(--color-danger)]" : "text-ink-subtle")}>
                            {c.daysPending} days waiting
                          </div>
                        )}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {c.disbursedAmount !== null ? money(c.disbursedAmount) : "—"}
                        {c.disbursedOn && <div className="sl-muted text-[12px]">{day(c.disbursedOn)}{c.bankRef ? ` · ${c.bankRef}` : ""}</div>}
                      </td>
                      <td className={`${td} text-right`}>
                        {canEdit && (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {c.status === "DRAFT" && (
                              <ActionPill variant="secondary" size="sm" onClick={() => setClaimForm(c)}>
                                Edit
                              </ActionPill>
                            )}
                            {c.nextStatuses.map((to) => (
                              <ActionPill
                                key={to}
                                size="sm"
                                variant={to === "REJECTED" ? "secondary" : "blue"}
                                onClick={() => setStep({ claimId: c.id, to })}
                              >
                                {to === "REJECTED" ? "Reject" : CLAIM_ACTION[to]}
                              </ActionPill>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                    {step?.claimId === c.id && (
                      <tr>
                        <td colSpan={7} className="px-3 pb-3">
                          <ClaimStep
                            claim={c}
                            to={step.to}
                            onCancel={() => setStep(null)}
                            onSubmit={async (body) => {
                              if (
                                await act(
                                  () => subsidySchemesService.setClaimStatus(scheme.id, c.id, body),
                                  `Claim ${CLAIM_STATUS_LABEL[body.status].toLowerCase()}`
                                )
                              ) {
                                setStep(null);
                              }
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>

      <Tile padding="md" title="Sanction and eligibility">
        <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <InfoItem label="Authority" value={scheme.authority} />
          <InfoItem label="Sanction order" value={scheme.sanctionOrderNo} mono />
          <InfoItem label="Sanction date" value={scheme.sanctionDate ? day(scheme.sanctionDate) : null} />
          <InfoItem
            label="Valid"
            value={scheme.validFrom || scheme.validTo ? `${day(scheme.validFrom)} – ${day(scheme.validTo)}` : null}
          />
          <InfoItem className="col-span-2 sm:col-span-4" label="Eligibility notes" value={scheme.eligibilityNotes} />
        </dl>
        {scheme.details && (
          <InlineAlert tone="info" title="Rates and caps are your own entries" className="mt-4">
            {scheme.verifyNote}
          </InlineAlert>
        )}
      </Tile>
    </PageBody>
  );
};

export default SubsidySchemePage;
