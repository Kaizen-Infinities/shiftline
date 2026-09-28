import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  AlertTriangle,
  Check,
  Download,
  FileWarning,
  Gavel,
  Pencil,
  RefreshCw,
  Scale,
  X,
} from "lucide-react";

import { usePermission } from "../../../../hooks/usePermission";
import {
  msmeClaimsService,
  type ClaimForum,
  type ClaimStatus,
  type EligibleReport,
  type MsmeClaim,
  type MsmeClaimDetail,
  type MsmeClaimSettings,
  type StatusChange,
} from "../../../../services/msmeClaimsService";
import { day, message, money } from "../../../compliance/components/gstUi";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatTile,
  Tile,
  cx,
  type ChipTone,
} from "../../../../components/ui/v2";
import { PageBody } from "../../../production/ui";

/**
 * MSME delayed-payment claims (TN-05): invoices a buyer has kept past the section 15 limit, the
 * section 16 interest on them (compounded monthly at three times the RBI bank rate), and the
 * Samadhaan / MSEFC claims raised from them.
 */
const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-3 text-sm text-ink align-middle";
const field = "sl-input h-11";
const todayIso = () => new Date().toISOString().slice(0, 10);

const STATUS_TONE: Record<ClaimStatus, ChipTone> = {
  DRAFT: "muted",
  FILED: "info",
  HEARING: "warning",
  SETTLED: "success",
  WITHDRAWN: "default",
};
const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  FILED: "Filed",
  HEARING: "Hearing",
  SETTLED: "Settled",
  WITHDRAWN: "Withdrawn",
};
const FORUM_LABEL: Record<ClaimForum, string> = {
  SAMADHAAN: "MSME Samadhaan",
  MSEFC: "MSEFC",
  DIRECT: "Direct demand",
};

const StatusChip: React.FC<{ status: ClaimStatus }> = ({ status }) => (
  <Chip size="sm" dot tone={STATUS_TONE[status]}>
    {STATUS_LABEL[status]}
  </Chip>
);

type Tab = "eligible" | "claims";

// ── Settings strip ──────────────────────────────────────────────────────────

const SettingsTile: React.FC<{
  settings: MsmeClaimSettings | null;
  canEdit: boolean;
  onSaved: (s: MsmeClaimSettings) => void;
}> = ({ settings, canEdit, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    bankRate: "",
    bankRateNote: "",
    udyamNumber: "",
    category: "",
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      bankRate: String(settings.bankRate),
      bankRateNote: settings.bankRateNote ?? "",
      udyamNumber: settings.udyamNumber ?? "",
      category: settings.enterpriseCategory ?? "",
    });
  }, [settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await msmeClaimsService.saveSettings({
        bankRate: Number(form.bankRate),
        bankRateNote: form.bankRateNote.trim() || null,
        udyamNumber: form.udyamNumber.trim() || null,
        enterpriseCategory: (form.category || null) as MsmeClaimSettings["enterpriseCategory"],
      });
      onSaved(saved);
      setEditing(false);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(message(err));
    }
  };

  if (!settings) return null;
  return (
    <Tile
      padding="md"
      title="Your MSME particulars"
      subtitle="Section 16 interest is three times the RBI bank rate, compounded monthly."
      actions={
        canEdit && !editing ? (
          <ActionPill
            variant="secondary"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </ActionPill>
        ) : undefined
      }
    >
      {editing ? (
        <form onSubmit={save} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
          <div>
            <label htmlFor="msme-rate" className="sl-label">
              RBI bank rate (%)
            </label>
            <input
              id="msme-rate"
              className={field}
              inputMode="decimal"
              value={form.bankRate}
              onChange={(e) => setForm((f) => ({ ...f, bankRate: e.target.value }))}
              required
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="msme-note" className="sl-label">
              Where you checked it
            </label>
            <input
              id="msme-note"
              className={field}
              placeholder="RBI press release, date"
              value={form.bankRateNote}
              onChange={(e) => setForm((f) => ({ ...f, bankRateNote: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="msme-cat" className="sl-label">
              Enterprise category
            </label>
            <select
              id="msme-cat"
              className={field}
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              <option value="">Not set</option>
              <option value="MICRO">Micro</option>
              <option value="SMALL">Small</option>
              <option value="MEDIUM">Medium</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="msme-udyam" className="sl-label">
              Udyam registration no.
            </label>
            <input
              id="msme-udyam"
              className={field}
              placeholder="UDYAM-TN-02-0012345"
              value={form.udyamNumber}
              onChange={(e) => setForm((f) => ({ ...f, udyamNumber: e.target.value }))}
            />
          </div>
          <div className="flex items-end justify-end gap-2.5 md:col-span-2">
            <ActionPill variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </ActionPill>
            <ActionPill type="submit" icon={<Check size={17} />}>
              Save
            </ActionPill>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
          <Chip tone="info">
            Bank rate {settings.bankRate}% → interest {settings.annualRate}% a year
          </Chip>
          {settings.isDefault && (
            <Chip tone="warning" icon={<AlertTriangle size={13} />} title={settings.verifyNote}>
              Default rate — verify with RBI
            </Chip>
          )}
          <Chip tone={settings.udyamNumber ? "default" : "warning"}>
            {settings.udyamNumber ? `Udyam ${settings.udyamNumber}` : "Udyam number not set"}
          </Chip>
          {settings.enterpriseCategory && (
            <Chip tone="muted">{settings.enterpriseCategory.toLowerCase()} enterprise</Chip>
          )}
          {settings.bankRateNote && (
            <span className="sl-muted text-[12px]">{settings.bankRateNote}</span>
          )}
        </div>
      )}
    </Tile>
  );
};

// ── Claim detail ─────────────────────────────────────────────────────────────

const StatusForm: React.FC<{
  claim: MsmeClaimDetail;
  onSubmit: (change: StatusChange) => void;
}> = ({ claim, onSubmit }) => {
  const [next, setNext] = useState<ClaimStatus | "">("");
  const [form, setForm] = useState({
    date: todayIso(),
    referenceNo: claim.referenceNo ?? "",
    amount: String(claim.claimTotal),
  });
  if (claim.nextStatuses.length === 0) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!next) return;
    const change: StatusChange = { status: next };
    if (next === "FILED") {
      change.filedOn = form.date;
      change.referenceNo = form.referenceNo.trim();
    }
    if (next === "HEARING") change.hearingOn = form.date;
    if (next === "SETTLED") {
      change.settledOn = form.date;
      change.settledAmount = Number(form.amount);
    }
    onSubmit(change);
    setNext("");
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2.5 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Move the claim to">
        {claim.nextStatuses.map((s) => (
          <Chip key={s} selected={next === s} onClick={() => setNext(s)}>
            {s === "WITHDRAWN" ? "Withdraw" : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
          </Chip>
        ))}
      </div>
      {next && next !== "WITHDRAWN" && (
        <input
          type="date"
          className={`${field} w-[160px]`}
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          aria-label={
            next === "FILED" ? "Filed on" : next === "HEARING" ? "Hearing on" : "Settled on"
          }
          required
        />
      )}
      {next === "FILED" && (
        <input
          className={`${field} w-[200px]`}
          placeholder="Application / case no."
          value={form.referenceNo}
          onChange={(e) => setForm((f) => ({ ...f, referenceNo: e.target.value }))}
          aria-label="Reference number"
          required
        />
      )}
      {next === "SETTLED" && (
        <input
          className={`${field} w-[160px]`}
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          aria-label="Amount settled"
        />
      )}
      {next && (
        <ActionPill type="submit" size="sm" variant={next === "WITHDRAWN" ? "danger" : "blue"}>
          Confirm
        </ActionPill>
      )}
    </form>
  );
};

const ClaimDetail: React.FC<{
  claim: MsmeClaimDetail;
  canEdit: boolean;
  canExport: boolean;
  onChange: (fn: () => Promise<MsmeClaimDetail>, ok: string) => void;
}> = ({ claim, canEdit, canExport, onChange }) => {
  const [asOf, setAsOf] = useState(todayIso());
  const [downloading, setDownloading] = useState(false);
  const closed = claim.status === "SETTLED" || claim.status === "WITHDRAWN";

  const download = async () => {
    setDownloading(true);
    try {
      await msmeClaimsService.downloadPdf(claim.id, claim.claimNo);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Tile
      padding="none"
      divider
      title={`${claim.claimNo} · ${claim.customerName ?? ""}`}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusChip status={claim.status} /> {FORUM_LABEL[claim.forum]} · as on{" "}
          {day(claim.asOfDate)} · {claim.annualRate}% a year
          {claim.referenceNo ? ` · Ref ${claim.referenceNo}` : ""}
        </span>
      }
      actions={
        canExport ? (
          <ActionPill
            variant="secondary"
            size="sm"
            icon={<Download size={14} />}
            onClick={() => void download()}
            disabled={downloading}
          >
            Claim PDF
          </ActionPill>
        ) : undefined
      }
    >
      <div className="grid grid-cols-3 gap-3 px-4 py-4 sm:px-5">
        <div>
          <div className="sl-muted text-[12px]">Principal</div>
          <div className="text-lg font-semibold text-ink tabular-nums">
            {money(claim.principalTotal)}
          </div>
        </div>
        <div>
          <div className="sl-muted text-[12px]">Interest (s.16)</div>
          <div className="text-lg font-semibold tabular-nums text-[color:var(--color-danger)]">
            {money(claim.interestTotal)}
          </div>
        </div>
        <div>
          <div className="sl-muted text-[12px]">Claim total</div>
          <div className="text-lg font-bold text-ink tabular-nums">{money(claim.claimTotal)}</div>
        </div>
      </div>
      <div className="overflow-x-auto border-t border-line-soft">
        <table className="w-full" aria-label="Claim invoices">
          <thead className="bg-card-2">
            <tr>
              <th scope="col" className={th}>
                Invoice
              </th>
              <th scope="col" className={th}>
                Due
              </th>
              <th scope="col" className={`${th} !text-right`}>
                Days late
              </th>
              <th scope="col" className={`${th} !text-right`}>
                Principal
              </th>
              <th scope="col" className={`${th} !text-right`}>
                Interest
              </th>
            </tr>
          </thead>
          <tbody>
            {claim.lines.map((l) => (
              <tr key={l.id} className="border-t border-line-soft">
                <td className={td}>
                  <div className="font-mono text-[13px] font-semibold">{l.invoiceNo}</div>
                  <div className="sl-muted text-[12px]">{day(l.invoiceDate)}</div>
                </td>
                <td className={`${td} tabular-nums`}>
                  {day(l.dueDate)}
                  <div className="sl-muted text-[12px]">{l.limitDays}-day limit</div>
                </td>
                <td className={`${td} text-right tabular-nums`}>{l.daysLate}</td>
                <td className={`${td} text-right tabular-nums`}>{money(l.principalOutstanding)}</td>
                <td className={`${td} text-right font-semibold tabular-nums`}>
                  {money(l.interest)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && !closed && (
        <div className="border-t border-line-soft">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-5">
            <input
              type="date"
              className="sl-input h-10 w-[160px]"
              value={asOf}
              max={todayIso()}
              onChange={(e) => setAsOf(e.target.value)}
              aria-label="Recompute interest to"
            />
            <ActionPill
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} />}
              onClick={() =>
                onChange(() => msmeClaimsService.recompute(claim.id, asOf), "Interest recomputed")
              }
            >
              Recompute
            </ActionPill>
          </div>
          <StatusForm
            key={`${claim.id}-${claim.status}`}
            claim={claim}
            onSubmit={(change) =>
              onChange(() => msmeClaimsService.updateStatus(claim.id, change), "Claim updated")
            }
          />
        </div>
      )}
    </Tile>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────

const MsmeClaimsPage: React.FC = () => {
  const { can } = usePermission();
  const canCreate = can("msme-claims.create");
  const canEdit = can("msme-claims.edit");
  const canExport = can("msme-claims.export");

  const [tab, setTab] = useState<Tab>("eligible");
  const [settings, setSettings] = useState<MsmeClaimSettings | null>(null);
  const [report, setReport] = useState<EligibleReport | null>(null);
  const [claims, setClaims] = useState<MsmeClaim[]>([]);
  const [buyer, setBuyer] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [forum, setForum] = useState<ClaimForum>("SAMADHAAN");
  const [selected, setSelected] = useState<MsmeClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r, c] = await Promise.all([
        msmeClaimsService.settings(),
        msmeClaimsService.eligible(),
        msmeClaimsService.list(),
      ]);
      setSettings(s);
      setReport(r);
      setClaims(c);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (report?.rows ?? []).filter((r) => !buyer || r.customerId === buyer),
    [report, buyer]
  );
  const pickedRows = (report?.rows ?? []).filter((r) => picked.has(r.invoiceId));
  const pickedBuyer = pickedRows[0]?.customerId ?? null;
  const pickedInterest = pickedRows.reduce((s, r) => s + r.interest, 0);

  const toggle = (id: string, customerId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        // A claim is against one buyer: picking another buyer's invoice starts over.
        if (pickedBuyer && pickedBuyer !== customerId) next.clear();
        next.add(id);
      }
      return next;
    });
  };

  const open = async (id: string) => {
    try {
      setSelected(await msmeClaimsService.get(id));
      setTab("claims");
    } catch (err) {
      toast.error(message(err));
    }
  };

  const raise = async () => {
    if (!pickedBuyer || picked.size === 0) return;
    setBusy(true);
    try {
      const claim = await msmeClaimsService.create({
        customerId: pickedBuyer,
        invoiceIds: [...picked],
        forum,
      });
      toast.success(`Claim ${claim.claimNo} raised`);
      setPicked(new Set());
      await load();
      setSelected(claim);
      setTab("claims");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const change = async (fn: () => Promise<MsmeClaimDetail>, ok: string) => {
    try {
      const claim = await fn();
      setSelected(claim);
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const openClaims = claims.filter((c) => c.status !== "SETTLED" && c.status !== "WITHDRAWN");

  return (
    <PageBody>
      <PageHeader
        title="MSME claims"
        icon={<Scale size={22} />}
        subtitle="Interest your buyers owe under section 16 when they pay after the section 15 limit."
        meta={
          report ? (
            <Chip size="sm" tone="info">
              {report.annualRate}% a year · monthly rests
            </Chip>
          ) : undefined
        }
        primaryAction={
          canCreate ? (
            <ActionPill
              icon={<Gavel size={18} />}
              onClick={() => void raise()}
              disabled={picked.size === 0 || busy}
              title={picked.size === 0 ? "Pick overdue invoices of one buyer first" : undefined}
            >
              Raise claim{picked.size > 0 ? ` (${picked.size})` : ""}
            </ActionPill>
          ) : undefined
        }
      />

      <SettingsTile settings={settings} canEdit={canEdit} onSaved={setSettings} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Overdue principal"
          value={money(report?.totals.principal ?? 0)}
          hint="Past the section 15 date"
          loading={loading}
        />
        <StatTile
          label="Interest accrued"
          value={money(report?.totals.interest ?? 0)}
          hint={report ? `As on ${day(report.asOf)}` : undefined}
          loading={loading}
        />
        <StatTile
          label="Invoices overdue"
          value={report?.totals.invoices ?? 0}
          hint={`${report?.buyers.length ?? 0} buyers`}
          loading={loading}
        />
        <StatTile
          label="Open claims"
          value={openClaims.length}
          hint={`${report?.totals.tredsCheck ?? 0} invoices may suit TReDS`}
          loading={loading}
        />
      </div>

      <ChipTabs<Tab>
        ariaLabel="MSME claim views"
        value={tab}
        onChange={setTab}
        items={[
          { key: "eligible", label: "Overdue invoices", count: report?.totals.invoices },
          { key: "claims", label: "Claims", count: claims.length },
        ]}
      />

      {tab === "eligible" ? (
        <Tile
          padding="none"
          divider
          title="Invoices past the section 15 limit"
          subtitle={
            picked.size > 0
              ? `${picked.size} picked · ${money(pickedInterest)} interest`
              : "Pick one buyer's invoices to raise a claim."
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canCreate && (
                <select
                  className="sl-input h-10 w-auto pr-9 text-sm"
                  value={forum}
                  onChange={(e) => setForum(e.target.value as ClaimForum)}
                  aria-label="Forum"
                >
                  <option value="SAMADHAAN">MSME Samadhaan</option>
                  <option value="MSEFC">MSEFC</option>
                  <option value="DIRECT">Direct demand</option>
                </select>
              )}
              <select
                className="sl-input h-10 w-auto max-w-[220px] pr-9 text-sm"
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
                aria-label="Filter by buyer"
              >
                <option value="">All buyers</option>
                {(report?.buyers ?? []).map((b) => (
                  <option key={b.customerId} value={b.customerId}>
                    {b.customerName} ({b.invoices})
                  </option>
                ))}
              </select>
            </div>
          }
        >
          {loading ? (
            <SkeletonRows rows={5} columns={6} header={false} />
          ) : rows.length === 0 ? (
            <EmptyState
              compact
              icon={<FileWarning size={22} />}
              title="No invoice is past its section 15 date."
              description="Unpaid invoices appear here the day after their 15 or 45 days run out."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]" aria-label="Overdue invoices">
                <thead className="bg-card-2">
                  <tr>
                    <th scope="col" className={`${th} w-10`}>
                      <span className="sr-only">Pick</span>
                    </th>
                    <th scope="col" className={th}>
                      Invoice
                    </th>
                    <th scope="col" className={th}>
                      Buyer
                    </th>
                    <th scope="col" className={th}>
                      Due
                    </th>
                    <th scope="col" className={`${th} !text-right`}>
                      Days late
                    </th>
                    <th scope="col" className={`${th} !text-right`}>
                      Principal
                    </th>
                    <th scope="col" className={`${th} !text-right`}>
                      Interest
                    </th>
                    <th scope="col" className={th}>
                      TReDS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const onClaim = !!r.claim;
                    return (
                      <tr
                        key={r.invoiceId}
                        className={cx(
                          "border-t border-line-soft",
                          picked.has(r.invoiceId) && "bg-nav-active"
                        )}
                      >
                        <td className={td}>
                          {canCreate && !onClaim && (
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-[color:var(--color-accent)]"
                              checked={picked.has(r.invoiceId)}
                              onChange={() => toggle(r.invoiceId, r.customerId)}
                              aria-label={`Pick ${r.invoiceNo}`}
                            />
                          )}
                        </td>
                        <td className={td}>
                          <div className="font-mono text-[13px] font-semibold text-accent">
                            {r.invoiceNo}
                          </div>
                          <div className="sl-muted text-[12px]">{day(r.invoiceDate)}</div>
                        </td>
                        <td className={`${td} max-w-[220px]`}>
                          <div className="truncate font-medium">{r.customerName}</div>
                          {r.claim && (
                            <button
                              type="button"
                              className="mt-0.5"
                              onClick={() => void open(r.claim!.id)}
                            >
                              <Chip size="sm" tone={STATUS_TONE[r.claim.status]}>
                                On {r.claim.claimNo}
                              </Chip>
                            </button>
                          )}
                        </td>
                        <td className={`${td} tabular-nums`}>
                          {day(r.dueDate)}
                          <div className="sl-muted text-[12px]">{r.limitDays}-day limit</div>
                        </td>
                        <td
                          className={`${td} text-right font-semibold tabular-nums text-[color:var(--color-danger)]`}
                        >
                          {r.daysLate}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {money(r.principalOutstanding)}
                          {r.paid > 0 && (
                            <div className="sl-muted text-[12px]">of {money(r.amount)}</div>
                          )}
                        </td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>
                          {money(r.interest)}
                        </td>
                        <td className={td}>
                          <Chip
                            size="sm"
                            tone={r.treds.flag === "CHECK" ? "info" : "muted"}
                            title={r.treds.reason}
                          >
                            {r.treds.flag === "CHECK" ? "Check" : "No"}
                          </Chip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Tile>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Tile padding="none" divider title="Claims">
              {loading ? (
                <SkeletonRows rows={4} columns={3} header={false} />
              ) : claims.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Gavel size={22} />}
                  title="No claims raised yet."
                  description="Pick overdue invoices of one buyer and raise a claim."
                />
              ) : (
                <ul className="m-0 list-none p-0" aria-label="MSME claims">
                  {claims.map((c) => (
                    <li key={c.id} className="border-t border-line-soft first:border-t-0">
                      <button
                        type="button"
                        aria-pressed={selected?.id === c.id}
                        onClick={() => void open(c.id)}
                        className={cx(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                          selected?.id === c.id ? "bg-nav-active" : "hover:bg-card-2"
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[13px] font-semibold text-accent">
                              {c.claimNo}
                            </span>
                            <StatusChip status={c.status} />
                          </div>
                          <div className="truncate text-sm font-medium text-ink">
                            {c.customerName ?? "—"}
                          </div>
                          <div className="sl-muted text-[12px]">
                            {FORUM_LABEL[c.forum]} · {c.invoiceCount} invoice
                            {c.invoiceCount === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[11px] font-medium text-ink-subtle">Claim</div>
                          <div className="text-sm font-semibold text-ink tabular-nums">
                            {money(c.claimTotal)}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Tile>
          </div>
          <div className="lg:col-span-3">
            {selected ? (
              <ClaimDetail
                claim={selected}
                canEdit={canEdit}
                canExport={canExport}
                onChange={(fn, ok) => void change(fn, ok)}
              />
            ) : (
              <Tile title="Claim">
                <EmptyState
                  compact
                  icon={<X size={22} />}
                  title="Pick a claim to see its invoices and download the statement."
                />
              </Tile>
            )}
          </div>
        </div>
      )}
    </PageBody>
  );
};

export default MsmeClaimsPage;
