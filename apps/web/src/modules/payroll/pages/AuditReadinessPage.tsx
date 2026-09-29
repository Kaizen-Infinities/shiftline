import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Download,
  Plus,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { customerService } from "../../../services/customerService";
import {
  STANDARD_LABEL,
  buyerAuditsService,
  type AuditRow,
  type AuditStandard,
  type CheckStatus,
  type Readiness,
  type ReadinessCheck,
} from "../../../services/buyerAuditsService";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tile,
  cx,
  type ChipTone,
} from "../../../components/ui/v2";
import { PageBody } from "../../production/ui";
import { errorMessage, formatDay } from "../components/peopleUi";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE } from "../components/auditUi";

/**
 * Buyer social-compliance audit readiness (TN-08): a readiness score built from attendance,
 * payroll and the registers, a checklist of what an auditor will look at, and the calendar of
 * buyer audits (BSCI, WRAP, SMETA, SA8000, Sedex, a buyer's code of conduct).
 */
const CHECK_TONE: Record<CheckStatus, ChipTone> = {
  PASS: "success",
  WARN: "warning",
  FAIL: "danger",
  NOT_CONFIGURED: "muted",
};
const CHECK_LABEL: Record<CheckStatus, string> = {
  PASS: "Pass",
  WARN: "Warn",
  FAIL: "Fail",
  NOT_CONFIGURED: "Not configured",
};
const CHECK_ICON: Record<CheckStatus, React.ReactNode> = {
  PASS: <CheckCircle2 size={20} />,
  WARN: <AlertTriangle size={20} />,
  FAIL: <XCircle size={20} />,
  NOT_CONFIGURED: <CircleDashed size={20} />,
};
const CHECK_COLOUR: Record<CheckStatus, string> = {
  PASS: "text-[color:var(--color-success)]",
  WARN: "text-[color:var(--color-warning)]",
  FAIL: "text-[color:var(--color-danger)]",
  NOT_CONFIGURED: "text-ink-subtle",
};

const BAND = {
  READY: { label: "Audit ready", tone: "success" as ChipTone, colour: "var(--color-success)" },
  AT_RISK: { label: "At risk", tone: "warning" as ChipTone, colour: "var(--color-warning)" },
  NOT_READY: { label: "Not ready", tone: "danger" as ChipTone, colour: "var(--color-danger)" },
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const PRESETS = [
  { key: "30", label: "30 days", days: 29 },
  { key: "90", label: "90 days", days: 89 },
  { key: "180", label: "6 months", days: 179 },
] as const;

type AuditTab = "UPCOMING" | "COMPLETED" | "CANCELLED" | "ALL";

const ScoreRing: React.FC<{ percent: number | null; colour: string }> = ({ percent, colour }) => {
  const r = 42;
  const c = 2 * Math.PI * r;
  const filled = percent === null ? 0 : (percent / 100) * c;
  return (
    <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0" aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-line-soft)" strokeWidth="10" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={colour}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-[color:var(--color-ink)] text-[22px] font-bold"
      >
        {percent === null ? "—" : `${percent}%`}
      </text>
    </svg>
  );
};

const CheckRow: React.FC<{ check: ReadinessCheck }> = ({ check }) => {
  const [open, setOpen] = useState(false);
  const expandable = check.items.length > 0;
  const body = (
    <>
      <span className={cx("mt-0.5 shrink-0", CHECK_COLOUR[check.status])} aria-hidden="true">
        {CHECK_ICON[check.status]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink">{check.title}</span>
          <Chip size="sm" dot tone={CHECK_TONE[check.status]}>
            {CHECK_LABEL[check.status]}
          </Chip>
        </span>
        <span className="sl-muted mt-0.5 block text-[13px]">{check.detail}</span>
      </span>
      {check.count !== null && (
        <span
          className={cx(
            "shrink-0 text-lg font-bold tabular-nums",
            check.count > 0 ? CHECK_COLOUR[check.status] : "text-ink-subtle"
          )}
          aria-label={`Count ${check.count}`}
        >
          {check.count}
        </span>
      )}
      {expandable && (
        <span className="mt-1 shrink-0 text-ink-subtle" aria-hidden="true">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      )}
    </>
  );
  return (
    <li className="border-t border-line-soft first:border-t-0">
      {expandable ? (
        <button
          type="button"
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-card-2 sm:px-5"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">{body}</div>
      )}
      {open && expandable && (
        <ul className="m-0 list-none bg-card-2 px-4 pb-3 pt-1 sm:px-5 sm:pl-14">
          {check.items.map((i) => (
            <li
              key={i.ref}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-line-soft py-2 text-[13px] first:border-t-0"
            >
              <span className="font-medium text-ink">{i.label}</span>
              <span className="tabular-nums text-ink-muted">{i.value}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

const monthLabel = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const AuditListRow: React.FC<{ a: AuditRow; onOpen: () => void }> = ({ a, onOpen }) => {
  const d = new Date(`${a.scheduledDate}T00:00:00Z`);
  const openCritMajor = a.openFindings.CRITICAL + a.openFindings.MAJOR;
  return (
    <li className="border-t border-line-soft first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-2 sm:px-5"
      >
        <span
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-[14px] bg-chip text-chip-fg"
          aria-hidden="true"
        >
          <span className="text-[17px] font-bold leading-none tabular-nums">{d.getUTCDate()}</span>
          <span className="mt-0.5 text-[10px] font-semibold uppercase">
            {d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{STANDARD_LABEL[a.standard]}</span>
            <span className="font-mono text-[12px] text-accent">{a.auditNo}</span>
          </span>
          <span className="sl-muted block truncate text-[13px]">
            {a.customerName ?? "No buyer"}
            {a.auditorFirm ? ` · ${a.auditorFirm}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {openCritMajor > 0 && (
            <Chip size="sm" tone="danger">
              {openCritMajor} open
            </Chip>
          )}
          {a.overdueActions > 0 && (
            <Chip size="sm" tone="danger" dot>
              {a.overdueActions} overdue
            </Chip>
          )}
          {a.daysToGo !== null && a.daysToGo >= 0 && (
            <Chip size="sm" tone={a.daysToGo <= 14 ? "warning" : "muted"}>
              {a.daysToGo === 0 ? "Today" : `in ${a.daysToGo}d`}
            </Chip>
          )}
          <Chip size="sm" dot tone={AUDIT_STATUS_TONE[a.status]}>
            {AUDIT_STATUS_LABEL[a.status]}
          </Chip>
        </span>
      </button>
    </li>
  );
};

const emptyForm = {
  standard: "BSCI" as AuditStandard,
  customerId: "",
  auditNo: "",
  auditorFirm: "",
  scheduledDate: "",
  nextAuditDue: "",
};

const AuditReadinessPage: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const [preset, setPreset] = useState<string>("90");
  const [range, setRange] = useState({ from: daysAgo(89), to: iso(new Date()) });
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [tab, setTab] = useState<AuditTab>("UPCOMING");
  const [loading, setLoading] = useState(true);
  const [loadingAudits, setLoadingAudits] = useState(true);
  const [buyers, setBuyers] = useState<{ id: string; firmName: string }[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(
    () => searchParams.get("action") === "plan" && can("buyer-audits.create")
  );
  const [form, setForm] = useState(emptyForm);

  // "Plan audit" from the command palette lands here with ?action=plan; drop it once used.
  useEffect(() => {
    if (searchParams.get("action") !== "plan") return;
    if (can("buyer-audits.create")) setShowForm(true);
    const next = new URLSearchParams(searchParams);
    next.delete("action");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, can]);
  const [saving, setSaving] = useState(false);

  const loadReadiness = useCallback(async () => {
    setLoading(true);
    try {
      setReadiness(await buyerAuditsService.readiness(range));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [range]);

  const loadAudits = useCallback(async () => {
    setLoadingAudits(true);
    try {
      setAudits(await buyerAuditsService.list());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoadingAudits(false);
    }
  }, []);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  useEffect(() => {
    if (!showForm || buyers.length > 0) return;
    customerService
      .fetchAll({ limit: 200 })
      .then((r) => setBuyers(r.customers.map((c) => ({ id: c.id, firmName: c.firmName }))))
      .catch(() => setBuyers([]));
  }, [showForm, buyers.length]);

  const visible = useMemo(() => {
    const rows =
      tab === "ALL"
        ? audits
        : tab === "UPCOMING"
          ? audits.filter((a) => a.status === "PLANNED" || a.status === "IN_PROGRESS")
          : audits.filter((a) => a.status === tab);
    return tab === "UPCOMING" ? rows : [...rows].reverse();
  }, [audits, tab]);

  const groups = useMemo(() => {
    const out: { month: string; rows: AuditRow[] }[] = [];
    for (const a of visible) {
      const m = monthLabel(a.scheduledDate);
      const last = out[out.length - 1];
      if (last && last.month === m) last.rows.push(a);
      else out.push({ month: m, rows: [a] });
    }
    return out;
  }, [visible]);

  const count = (s: AuditTab) =>
    s === "ALL"
      ? audits.length
      : s === "UPCOMING"
        ? audits.filter((a) => a.status === "PLANNED" || a.status === "IN_PROGRESS").length
        : audits.filter((a) => a.status === s).length;

  const pickPreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPreset(key);
    setRange({ from: daysAgo(p.days), to: iso(new Date()) });
  };

  const plan = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await buyerAuditsService.create({
        standard: form.standard,
        scheduledDate: form.scheduledDate,
        ...(form.customerId ? { customerId: form.customerId } : {}),
        ...(form.auditNo.trim() ? { auditNo: form.auditNo.trim() } : {}),
        ...(form.auditorFirm.trim() ? { auditorFirm: form.auditorFirm.trim() } : {}),
        ...(form.nextAuditDue ? { nextAuditDue: form.nextAuditDue } : {}),
      });
      toast.success("Audit planned");
      setForm(emptyForm);
      setShowForm(false);
      navigate(`/hr/audit-readiness/${created.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const band = readiness?.band ? BAND[readiness.band] : null;
  const next = readiness?.nextAudit ?? null;

  return (
    <PageBody>
      <PageHeader
        title="Audit readiness"
        icon={<ShieldCheck size={22} />}
        subtitle="Buyer social-compliance audits and how ready the factory is for the next one."
        actions={
          can("buyer-audits.export") ? (
            <ActionPill
              variant="secondary"
              icon={<Download size={16} />}
              onClick={() =>
                void buyerAuditsService
                  .exportReadiness(range)
                  .catch((err) => toast.error(errorMessage(err)))
              }
            >
              Export
            </ActionPill>
          ) : undefined
        }
        primaryAction={
          can("buyer-audits.create") ? (
            showForm ? (
              <ActionPill
                variant="secondary"
                icon={<X size={17} />}
                onClick={() => setShowForm(false)}
              >
                Close
              </ActionPill>
            ) : (
              <ActionPill icon={<Plus size={18} />} onClick={() => setShowForm(true)}>
                Plan audit
              </ActionPill>
            )
          ) : undefined
        }
      />

      {showForm && (
        <Tile title="Plan an audit" subtitle="Record the audit as soon as the buyer books it.">
          <form onSubmit={plan} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
            <div>
              <label htmlFor="ba-standard" className="sl-label">
                Standard
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="ba-standard"
                className="sl-input h-11"
                value={form.standard}
                onChange={(e) =>
                  setForm((f) => ({ ...f, standard: e.target.value as AuditStandard }))
                }
              >
                {(Object.keys(STANDARD_LABEL) as AuditStandard[]).map((s) => (
                  <option key={s} value={s}>
                    {STANDARD_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ba-date" className="sl-label">
                Scheduled date
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="ba-date"
                type="date"
                className="sl-input h-11"
                value={form.scheduledDate}
                onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="ba-buyer" className="sl-label">
                Buyer
              </label>
              <select
                id="ba-buyer"
                className="sl-input h-11"
                value={form.customerId}
                onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
              >
                <option value="">No particular buyer</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.firmName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ba-firm" className="sl-label">
                Audit firm
              </label>
              <input
                id="ba-firm"
                className="sl-input h-11"
                placeholder="e.g. Intertek, SGS, Bureau Veritas"
                value={form.auditorFirm}
                onChange={(e) => setForm((f) => ({ ...f, auditorFirm: e.target.value }))}
                maxLength={120}
              />
            </div>
            <div>
              <label htmlFor="ba-no" className="sl-label">
                Audit no.
              </label>
              <input
                id="ba-no"
                className="sl-input h-11"
                placeholder="Left blank: standard and date"
                value={form.auditNo}
                onChange={(e) => setForm((f) => ({ ...f, auditNo: e.target.value }))}
                maxLength={30}
              />
            </div>
            <div>
              <label htmlFor="ba-next" className="sl-label">
                Next audit due
              </label>
              <input
                id="ba-next"
                type="date"
                className="sl-input h-11"
                value={form.nextAuditDue}
                onChange={(e) => setForm((f) => ({ ...f, nextAuditDue: e.target.value }))}
              />
            </div>
            <div className="flex items-end justify-end gap-2.5 md:col-span-3">
              <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />} disabled={saving}>
                Plan audit
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Chip key={p.key} selected={preset === p.key} onClick={() => pickPreset(p.key)}>
            Last {p.label}
          </Chip>
        ))}
        <span className="flex items-center gap-2">
          <input
            type="date"
            className="sl-input h-10 w-[150px] text-sm"
            aria-label="From"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              setPreset("");
              if (e.target.value) setRange((r) => ({ ...r, from: e.target.value }));
            }}
          />
          <span className="text-sm text-ink-subtle">to</span>
          <input
            type="date"
            className="sl-input h-10 w-[150px] text-sm"
            aria-label="To"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              setPreset("");
              if (e.target.value) setRange((r) => ({ ...r, to: e.target.value }));
            }}
          />
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Tile>
            {loading || !readiness ? (
              <div className="flex items-center gap-5" aria-hidden="true">
                <div className="sl-skeleton h-28 w-28 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="sl-skeleton h-5 w-1/2" />
                  <div className="sl-skeleton h-4 w-3/4" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-5">
                <ScoreRing
                  percent={readiness.percent}
                  colour={band?.colour ?? "var(--color-line)"}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink-subtle">Readiness score</div>
                  {band && (
                    <Chip tone={band.tone} dot className="mt-1">
                      {band.label}
                    </Chip>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip size="sm" tone="success">
                      {readiness.counts.pass} pass
                    </Chip>
                    <Chip size="sm" tone="warning">
                      {readiness.counts.warn} warn
                    </Chip>
                    <Chip size="sm" tone="danger">
                      {readiness.counts.fail} fail
                    </Chip>
                  </div>
                  <p className="sl-muted m-0 mt-2 text-[12px]">
                    {formatDay(readiness.from)} – {formatDay(readiness.to)}
                  </p>
                </div>
              </div>
            )}
          </Tile>

          <Tile
            title="Next audit"
            icon={<CalendarCheck size={18} />}
            actions={
              next ? (
                <Chip size="sm" dot tone={AUDIT_STATUS_TONE[next.status]}>
                  {AUDIT_STATUS_LABEL[next.status]}
                </Chip>
              ) : undefined
            }
          >
            {loading ? (
              <div className="sl-skeleton h-12 w-full" aria-hidden="true" />
            ) : next ? (
              <button
                type="button"
                className="w-full text-left"
                onClick={() => navigate(`/hr/audit-readiness/${next.id}`)}
              >
                <div className="text-lg font-bold text-ink">
                  {STANDARD_LABEL[next.standard]}
                  <span className="ml-2 text-sm font-medium text-ink-subtle">
                    {formatDay(next.scheduledDate)}
                  </span>
                </div>
                <div className="sl-muted text-sm">
                  {next.customerName ?? "No buyer"}
                  {next.daysToGo !== null &&
                    ` · ${next.daysToGo < 0 ? `${-next.daysToGo} days past the date` : next.daysToGo === 0 ? "today" : `in ${next.daysToGo} days`}`}
                </div>
              </button>
            ) : (
              <p className="sl-muted m-0 text-sm">No audit planned.</p>
            )}
          </Tile>
        </div>

        <div className="lg:col-span-3">
          <Tile
            padding="none"
            divider
            title="Readiness checklist"
            subtitle="What an auditor checks first, from your attendance, payroll and registers."
          >
            {loading || !readiness ? (
              <SkeletonRows rows={6} columns={2} header={false} />
            ) : (
              <ul className="m-0 list-none p-0" aria-label="Readiness checks">
                {readiness.checks.map((c) => (
                  <CheckRow key={c.key} check={c} />
                ))}
              </ul>
            )}
          </Tile>
        </div>
      </div>

      <Tile padding="none" divider title="Buyer audits" icon={<CalendarCheck size={18} />}>
        <div className="px-4 py-3 sm:px-5">
          <ChipTabs<AuditTab>
            size="sm"
            ariaLabel="Audit status"
            value={tab}
            onChange={setTab}
            items={[
              { key: "UPCOMING", label: "Upcoming", count: count("UPCOMING") },
              { key: "COMPLETED", label: "Completed", count: count("COMPLETED") },
              { key: "CANCELLED", label: "Cancelled", count: count("CANCELLED") },
              { key: "ALL", label: "All", count: count("ALL") },
            ]}
          />
        </div>
        {loadingAudits ? (
          <SkeletonRows rows={3} columns={3} header={false} />
        ) : groups.length === 0 ? (
          <EmptyState
            compact
            icon={<CalendarCheck size={22} />}
            title={tab === "UPCOMING" ? "No audits planned." : "No audits here."}
            description={
              can("buyer-audits.create") && tab === "UPCOMING"
                ? "Plan the next BSCI, WRAP, SMETA or buyer audit to track its findings here."
                : undefined
            }
            action={
              can("buyer-audits.create") && tab === "UPCOMING" ? (
                <ActionPill icon={<Plus size={18} />} onClick={() => setShowForm(true)}>
                  Plan audit
                </ActionPill>
              ) : undefined
            }
          />
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.month} aria-label={g.month}>
                <div className="sl-section-label border-t border-line-soft bg-card-2 px-4 py-2 first:border-t-0 sm:px-5">
                  {g.month}
                </div>
                <ul className="m-0 list-none p-0">
                  {g.rows.map((a) => (
                    <AuditListRow
                      key={a.id}
                      a={a}
                      onOpen={() => navigate(`/hr/audit-readiness/${a.id}`)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Tile>
    </PageBody>
  );
};

export default AuditReadinessPage;
