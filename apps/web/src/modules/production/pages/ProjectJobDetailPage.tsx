import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleDot,
  Coins,
  IndianRupee,
  Layers,
  Play,
  Plus,
  Receipt,
  SkipForward,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  projectJobsService,
  type AddBilling,
  type AddCost,
  type BillingKind,
  type CostType,
  type JobDetail,
  type JobStage,
  type JobStatus,
  type RawMaterialOption,
} from "../../../services/projectJobsService";
import { day, message } from "../../compliance/components/gstUi";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonTile,
  StatTile,
  Tile,
  cx,
} from "../../../components/ui/v2";
import { ErrorTile, InfoItem, PageBody, ProgressBar, formatINR, formatQty } from "../ui";
import { COST_TYPE_LABEL, STAGE_STATUS_LABEL, pct, shortInr, todayIso } from "./projectJobsFormat";
import { JobStatusChip, MarginChip } from "./projectJobsUi";

/**
 * One job (TN-09): quote vs cost to date, the stage timeline, the cost ledger (append-style:
 * only draft lines can be removed) and advances / stage invoices.
 */
type Tab = "stages" | "costs" | "billing";

const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-3 text-sm text-ink align-middle";
const field = "sl-input h-11";

const BILLING_LABEL: Record<BillingKind, string> = {
  ADVANCE: "Advance received",
  STAGE_INVOICE: "Stage invoice",
  FINAL: "Final invoice",
};

/** The next status buttons offered for a job. */
const NEXT: Partial<Record<JobStatus, { to: JobStatus; label: string }>> = {
  QUOTED: { to: "IN_PROGRESS", label: "Start job" },
  IN_PROGRESS: { to: "COMPLETED", label: "Mark completed" },
  COMPLETED: { to: "DELIVERED", label: "Mark delivered" },
};

const stageDot = (s: JobStage) =>
  s.status === "DONE"
    ? "bg-[color:var(--color-success)] text-white"
    : s.status === "IN_PROGRESS"
      ? "bg-accent text-white"
      : s.status === "SKIPPED"
        ? "bg-card-2 text-ink-subtle"
        : "bg-chip text-chip-fg";

const emptyCost = {
  type: "MATERIAL" as CostType,
  costDate: todayIso(),
  description: "",
  qty: "",
  rate: "",
  rawMaterialId: "",
  stockIssueId: "",
  vendorName: "",
  post: false,
};

const emptyBilling = {
  kind: "ADVANCE" as BillingKind,
  billDate: todayIso(),
  amount: "",
  advanceAdjusted: "",
  stageId: "",
  reference: "",
};

const ProjectJobDetailPage: React.FC = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = usePermission();
  const canEdit = can("project-jobs.edit");
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stages");
  const [newStage, setNewStage] = useState("");
  const [cost, setCost] = useState(emptyCost);
  const [billing, setBilling] = useState(emptyBilling);
  const [materials, setMaterials] = useState<RawMaterialOption[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setJob(await projectJobsService.get(id));
      setError(null);
    } catch (err) {
      setError(message(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "costs" || !canEdit || materials.length > 0) return;
    projectJobsService
      .rawMaterials()
      .then(setMaterials)
      .catch(() => setMaterials([]));
  }, [tab, canEdit, materials.length]);

  const run = async (fn: () => Promise<JobDetail>, ok: string) => {
    setBusy(true);
    try {
      setJob(await fn());
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <PageBody>
        <PageHeader title="Job" back="/production/jobs" backLabel="All jobs" />
        <ErrorTile message={error} onRetry={() => void load()} />
      </PageBody>
    );
  }
  if (!job) {
    return (
      <PageBody>
        <PageHeader title="Job" back="/production/jobs" backLabel="All jobs" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonTile key={i} />
          ))}
        </div>
      </PageBody>
    );
  }

  const s = job.summary;
  const open = job.status !== "CANCELLED" && job.status !== "DELIVERED";
  const editable = canEdit && open;
  const next = NEXT[job.status];
  const deletable =
    can("project-jobs.delete") && job.costs.length === 0 && job.billings.length === 0;

  const setStatus = (status: JobStatus, ok: string) =>
    void run(() => projectJobsService.update(job.id, { status }), ok);

  const moveStage = (index: number, dir: -1 | 1) => {
    const ids = job.stages.map((st) => st.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void run(() => projectJobsService.reorderStages(job.id, ids), "Stages reordered");
  };

  const stageAction = (st: JobStage, status: "IN_PROGRESS" | "DONE" | "SKIPPED" | "PENDING") => {
    const today = todayIso();
    const body =
      status === "IN_PROGRESS"
        ? { status, actualStart: st.actualStart ?? today }
        : status === "DONE"
          ? { status, actualStart: st.actualStart ?? today, actualEnd: today }
          : { status };
    void run(
      () => projectJobsService.updateStage(job.id, st.id, body),
      `${st.name}: ${STAGE_STATUS_LABEL[status].toLowerCase()}`
    );
  };

  const addCost = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: AddCost = {
      type: cost.type,
      costDate: cost.costDate,
      description: cost.description.trim(),
      ...(cost.qty ? { qty: Number(cost.qty) } : {}),
      ...(cost.rate ? { rate: Number(cost.rate) } : {}),
      ...(cost.type === "MATERIAL" && cost.rawMaterialId
        ? { rawMaterialId: cost.rawMaterialId }
        : {}),
      ...(cost.type === "MATERIAL" && cost.stockIssueId.trim()
        ? { stockIssueId: cost.stockIssueId.trim() }
        : {}),
      ...(cost.vendorName.trim() ? { vendorName: cost.vendorName.trim() } : {}),
      post: cost.post,
    };
    if (await run(() => projectJobsService.addCost(job.id, body), "Cost added")) {
      setCost({ ...emptyCost, type: cost.type, costDate: cost.costDate });
    }
  };

  const addBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: AddBilling = {
      kind: billing.kind,
      billDate: billing.billDate,
      amount: Number(billing.amount),
      ...(billing.kind !== "ADVANCE" && billing.advanceAdjusted
        ? { advanceAdjusted: Number(billing.advanceAdjusted) }
        : {}),
      ...(billing.stageId ? { stageId: billing.stageId } : {}),
      ...(billing.reference.trim() ? { reference: billing.reference.trim() } : {}),
    };
    if (await run(() => projectJobsService.addBilling(job.id, body), "Billing recorded")) {
      setBilling({ ...emptyBilling, kind: billing.kind });
    }
  };

  const drafts = job.costs.filter((c) => c.status === "DRAFT").length;
  const liveRate =
    cost.type === "MATERIAL" && cost.rawMaterialId
      ? materials.find((m) => m.id === cost.rawMaterialId)
      : undefined;
  const preview =
    Number(cost.qty || (cost.type === "LABOUR" ? 0 : 1)) * Number(cost.rate || liveRate?.rate || 0);

  return (
    <PageBody>
      <PageHeader
        title={job.jobNo}
        back="/production/jobs"
        backLabel="All jobs"
        icon={<Truck size={22} />}
        subtitle={`${job.customerName ?? "—"} · ${job.title}`}
        meta={
          <>
            <JobStatusChip status={job.status} />
            <MarginChip summary={s} />
          </>
        }
        actions={
          <>
            {canEdit && open && (
              <ActionPill
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Cancel this job? Its costs and billing stay on record.")) {
                    setStatus("CANCELLED", "Job cancelled");
                  }
                }}
              >
                Cancel job
              </ActionPill>
            )}
            {deletable && open && (
              <ActionPill
                variant="ghost"
                size="sm"
                icon={<Trash2 size={15} />}
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm("Delete this job? It has no cost or billing yet.")) return;
                  try {
                    await projectJobsService.remove(job.id);
                    toast.success("Job deleted");
                    navigate("/production/jobs");
                  } catch (err) {
                    toast.error(message(err));
                  }
                }}
              >
                Delete
              </ActionPill>
            )}
          </>
        }
        primaryAction={
          canEdit && next ? (
            <ActionPill
              icon={<Check size={17} />}
              disabled={busy}
              onClick={() => setStatus(next.to, next.label)}
            >
              {next.label}
            </ActionPill>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile
          label="Quoted"
          value={shortInr(s.quoted)}
          icon={<IndianRupee size={18} />}
          hint={`on ${day(job.quoteDate)}`}
        />
        <StatTile
          label="Cost to date"
          value={shortInr(s.costToDate)}
          icon={<Coins size={18} />}
          hint={s.draftCost > 0 ? `${formatINR(s.draftCost)} still draft` : "all posted"}
        />
        <StatTile
          label="Margin"
          value={shortInr(s.margin)}
          icon={<Layers size={18} />}
          delta={pct(s.marginPct)}
          deltaTone={
            s.marginBand === "HEALTHY" ? "success" : s.marginBand === "THIN" ? "warning" : "danger"
          }
          hint={s.overQuote ? "cost is past the quote" : "quote less cost to date"}
        />
        <StatTile
          label="Billed"
          value={shortInr(s.billed)}
          icon={<Receipt size={18} />}
          hint={`${shortInr(s.toBill)} left to bill`}
        />
        <StatTile
          label="Advance balance"
          value={shortInr(s.advanceBalance)}
          icon={<Wallet size={18} />}
          hint={`${shortInr(s.advancesReceived)} received`}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <Tile
        title="Job"
        subtitle={
          <span className="inline-flex items-center gap-2">
            {Math.round(s.percentComplete)}% complete
            {job.currentStage && <span className="text-ink-subtle">· now: {job.currentStage}</span>}
          </span>
        }
      >
        <ProgressBar pct={s.percentComplete} label="Job progress" className="mb-4" />
        <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-4">
          <InfoItem label="Chassis no." value={job.chassisNo ?? "—"} />
          <InfoItem label="Make / model" value={job.chassisMake ?? "—"} />
          <InfoItem label="Received on" value={day(job.chassisReceivedOn)} />
          <InfoItem label="Target date" value={day(job.targetDate)} />
          {job.conditionNotes && (
            <InfoItem
              className="col-span-2 md:col-span-4"
              label="Condition on arrival"
              value={job.conditionNotes}
            />
          )}
        </dl>
      </Tile>

      <ChipTabs<Tab>
        ariaLabel="Job sections"
        value={tab}
        onChange={setTab}
        items={[
          { key: "stages", label: "Stages", count: job.stages.length },
          { key: "costs", label: "Costs", count: job.costs.length },
          { key: "billing", label: "Billing", count: job.billings.length },
        ]}
      />

      {tab === "stages" && (
        <Tile
          title="Stage timeline"
          subtitle="Weighted % complete; a stage in progress counts half."
        >
          {job.stages.length === 0 ? (
            <EmptyState compact icon={<Layers size={22} />} title="No stages on this job yet." />
          ) : (
            <ol className="m-0 list-none p-0" aria-label="Stages">
              {job.stages.map((st, i) => (
                <li key={st.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < job.stages.length - 1 && (
                    <span
                      className="absolute left-[15px] top-8 h-[calc(100%-24px)] w-px bg-line"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cx(
                      "relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold",
                      stageDot(st)
                    )}
                    aria-hidden="true"
                  >
                    {st.status === "DONE" ? (
                      <Check size={15} />
                    ) : st.status === "IN_PROGRESS" ? (
                      <CircleDot size={15} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cx(
                          "font-semibold text-ink",
                          st.status === "SKIPPED" && "line-through opacity-60"
                        )}
                      >
                        {st.name}
                      </span>
                      <Chip
                        size="sm"
                        tone={
                          st.status === "DONE"
                            ? "success"
                            : st.status === "IN_PROGRESS"
                              ? "info"
                              : "muted"
                        }
                      >
                        {STAGE_STATUS_LABEL[st.status]}
                      </Chip>
                      {st.weight !== 1 && (
                        <span className="text-[12px] text-ink-subtle">weight {st.weight}</span>
                      )}
                    </div>
                    <div className="text-[12px] text-ink-subtle">
                      {st.actualStart || st.actualEnd
                        ? `Actual ${day(st.actualStart)} → ${st.actualEnd ? day(st.actualEnd) : "…"}`
                        : st.plannedStart || st.plannedEnd
                          ? `Planned ${day(st.plannedStart)} → ${day(st.plannedEnd)}`
                          : "Not started"}
                    </div>
                  </div>
                  {editable && (
                    <div className="flex shrink-0 flex-wrap items-start justify-end gap-1.5">
                      {st.status === "PENDING" && (
                        <ActionPill
                          variant="secondary"
                          size="sm"
                          icon={<Play size={14} />}
                          disabled={busy}
                          onClick={() => stageAction(st, "IN_PROGRESS")}
                        >
                          Start
                        </ActionPill>
                      )}
                      {(st.status === "PENDING" || st.status === "IN_PROGRESS") && (
                        <ActionPill
                          variant="secondary"
                          size="sm"
                          icon={<Check size={14} />}
                          disabled={busy}
                          onClick={() => stageAction(st, "DONE")}
                        >
                          Done
                        </ActionPill>
                      )}
                      {st.status === "PENDING" && (
                        <button
                          type="button"
                          className="sl-icon-btn sl-icon-btn-ghost"
                          aria-label={`Skip ${st.name}`}
                          title="Skip"
                          disabled={busy}
                          onClick={() => stageAction(st, "SKIPPED")}
                        >
                          <SkipForward size={15} />
                        </button>
                      )}
                      {(st.status === "DONE" || st.status === "SKIPPED") && (
                        <ActionPill
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => stageAction(st, "PENDING")}
                        >
                          Reopen
                        </ActionPill>
                      )}
                      <button
                        type="button"
                        className="sl-icon-btn sl-icon-btn-ghost"
                        aria-label={`Move ${st.name} up`}
                        disabled={busy || i === 0}
                        onClick={() => moveStage(i, -1)}
                      >
                        <ArrowUp size={15} />
                      </button>
                      <button
                        type="button"
                        className="sl-icon-btn sl-icon-btn-ghost"
                        aria-label={`Move ${st.name} down`}
                        disabled={busy || i === job.stages.length - 1}
                        onClick={() => moveStage(i, 1)}
                      >
                        <ArrowDown size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          {editable && (
            <form
              className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run(
                    () => projectJobsService.addStage(job.id, { name: newStage.trim() }),
                    "Stage added"
                  )
                ) {
                  setNewStage("");
                }
              }}
            >
              <input
                className={`${field} min-w-[200px] flex-1`}
                placeholder="Add a stage, e.g. RTO passing"
                aria-label="New stage name"
                value={newStage}
                onChange={(e) => setNewStage(e.target.value)}
                maxLength={80}
                required
              />
              <ActionPill
                type="submit"
                variant="secondary"
                icon={<Plus size={16} />}
                disabled={busy}
              >
                Add stage
              </ActionPill>
            </form>
          )}
        </Tile>
      )}

      {tab === "costs" && (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Cost by type">
            {(Object.keys(COST_TYPE_LABEL) as CostType[]).map((t) => (
              <Chip key={t} tone="default">
                {COST_TYPE_LABEL[t]} · {formatINR(s.costByType[t])}
              </Chip>
            ))}
          </div>

          {editable && (
            <Tile
              title="Add cost"
              subtitle="Labour is hours × rate per hour. Material can come from a stock issue."
            >
              <form onSubmit={addCost} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
                <div>
                  <label htmlFor="cost-type" className="sl-label">
                    Type
                  </label>
                  <select
                    id="cost-type"
                    className={field}
                    value={cost.type}
                    onChange={(e) => setCost((c) => ({ ...c, type: e.target.value as CostType }))}
                  >
                    {(Object.keys(COST_TYPE_LABEL) as CostType[]).map((t) => (
                      <option key={t} value={t}>
                        {COST_TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cost-date" className="sl-label">
                    Date
                  </label>
                  <input
                    id="cost-date"
                    type="date"
                    className={field}
                    value={cost.costDate}
                    onChange={(e) => setCost((c) => ({ ...c, costDate: e.target.value }))}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="cost-desc" className="sl-label">
                    Description
                  </label>
                  <input
                    id="cost-desc"
                    className={field}
                    placeholder={cost.type === "LABOUR" ? "Welder – side panels" : "MS sheet 3 mm"}
                    value={cost.description}
                    onChange={(e) => setCost((c) => ({ ...c, description: e.target.value }))}
                    maxLength={200}
                    required
                  />
                </div>
                {cost.type === "MATERIAL" && (
                  <>
                    <div className="md:col-span-2">
                      <label htmlFor="cost-rm" className="sl-label">
                        Raw material
                      </label>
                      <select
                        id="cost-rm"
                        className={field}
                        value={cost.rawMaterialId}
                        onChange={(e) => setCost((c) => ({ ...c, rawMaterialId: e.target.value }))}
                      >
                        <option value="">Not from the item master</option>
                        {materials.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.code}){m.rate != null ? ` · ₹${m.rate}/${m.uom}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cost-issue" className="sl-label">
                        Stock issue no.
                      </label>
                      <input
                        id="cost-issue"
                        className={field}
                        inputMode="numeric"
                        placeholder="Optional"
                        value={cost.stockIssueId}
                        onChange={(e) => setCost((c) => ({ ...c, stockIssueId: e.target.value }))}
                      />
                    </div>
                  </>
                )}
                {(cost.type === "SUBCONTRACT" || cost.type === "OVERHEAD") && (
                  <div className="md:col-span-3">
                    <label htmlFor="cost-vendor" className="sl-label">
                      {cost.type === "SUBCONTRACT" ? "Subcontractor" : "Paid to"}
                    </label>
                    <input
                      id="cost-vendor"
                      className={field}
                      value={cost.vendorName}
                      onChange={(e) => setCost((c) => ({ ...c, vendorName: e.target.value }))}
                      maxLength={120}
                    />
                  </div>
                )}
                {cost.type === "LABOUR" && (
                  <div className="hidden md:col-span-3 md:block" aria-hidden="true" />
                )}
                <div>
                  <label htmlFor="cost-qty" className="sl-label">
                    {cost.type === "LABOUR" ? "Hours" : "Qty"}
                  </label>
                  <input
                    id="cost-qty"
                    className={`${field} tabular-nums`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder={cost.type === "LABOUR" ? "" : "1"}
                    value={cost.qty}
                    onChange={(e) => setCost((c) => ({ ...c, qty: e.target.value }))}
                    required={cost.type === "LABOUR"}
                  />
                </div>
                <div>
                  <label htmlFor="cost-rate" className="sl-label">
                    {cost.type === "LABOUR" ? "Rate / hour (₹)" : "Rate (₹)"}
                  </label>
                  <input
                    id="cost-rate"
                    className={`${field} tabular-nums`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder={liveRate?.rate != null ? String(liveRate.rate) : ""}
                    value={cost.rate}
                    onChange={(e) => setCost((c) => ({ ...c, rate: e.target.value }))}
                    required={
                      cost.type !== "MATERIAL" || (!cost.rawMaterialId && !cost.stockIssueId)
                    }
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex h-11 items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={cost.post}
                      onChange={(e) => setCost((c) => ({ ...c, post: e.target.checked }))}
                    />
                    Post now (locks the line)
                  </label>
                </div>
                <div className="flex items-end justify-end gap-3">
                  <span className="text-sm tabular-nums text-ink-muted">
                    {preview > 0 ? formatINR(preview) : ""}
                  </span>
                  <ActionPill
                    type="submit"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    disabled={busy}
                  >
                    Add cost
                  </ActionPill>
                </div>
              </form>
            </Tile>
          )}

          <Tile
            padding="none"
            divider
            title="Costs"
            subtitle={`${formatINR(s.costToDate)} to date`}
            actions={
              editable && drafts > 0 ? (
                <ActionPill
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() => projectJobsService.postCosts(job.id), "Draft costs posted")
                  }
                >
                  Post {drafts} draft{drafts === 1 ? "" : "s"}
                </ActionPill>
              ) : undefined
            }
          >
            {job.costs.length === 0 ? (
              <EmptyState
                compact
                icon={<Coins size={22} />}
                title="No cost booked to this job yet."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]" aria-label="Costs">
                  <thead className="bg-card-2">
                    <tr>
                      <th scope="col" className={th}>
                        Date
                      </th>
                      <th scope="col" className={th}>
                        Type
                      </th>
                      <th scope="col" className={th}>
                        Description
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Qty
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Rate
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Amount
                      </th>
                      <th scope="col" className={th}>
                        Status
                      </th>
                      <th scope="col" className={th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.costs.map((c) => (
                      <tr key={c.id} className="border-t border-line-soft">
                        <td className={`${td} tabular-nums`}>{day(c.costDate)}</td>
                        <td className={td}>{COST_TYPE_LABEL[c.type]}</td>
                        <td className={td}>
                          <div>{c.description}</div>
                          {(c.vendorName || c.stockIssueId) && (
                            <div className="text-[12px] text-ink-subtle">
                              {c.vendorName ?? `Stock issue #${c.stockIssueId}`}
                            </div>
                          )}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {formatQty(c.qty, c.uom)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{formatINR(c.rate)}</td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>
                          {formatINR(c.amount)}
                        </td>
                        <td className={td}>
                          <Chip size="sm" tone={c.status === "POSTED" ? "success" : "muted"}>
                            {c.status === "POSTED" ? "Posted" : "Draft"}
                          </Chip>
                        </td>
                        <td className={`${td} text-right`}>
                          {editable && c.status === "DRAFT" && (
                            <button
                              type="button"
                              className="sl-icon-btn sl-icon-btn-ghost"
                              aria-label={`Remove ${c.description}`}
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () => projectJobsService.removeCost(job.id, c.id),
                                  "Cost removed"
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tile>
        </>
      )}

      {tab === "billing" && (
        <>
          {canEdit && job.status !== "CANCELLED" && (
            <Tile
              title="Record billing"
              subtitle="Advances received, and stage or final invoices that may use them up."
            >
              <form
                onSubmit={addBilling}
                className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4"
              >
                <div>
                  <label htmlFor="bill-kind" className="sl-label">
                    Kind
                  </label>
                  <select
                    id="bill-kind"
                    className={field}
                    value={billing.kind}
                    onChange={(e) =>
                      setBilling((b) => ({ ...b, kind: e.target.value as BillingKind }))
                    }
                  >
                    {(Object.keys(BILLING_LABEL) as BillingKind[]).map((k) => (
                      <option key={k} value={k}>
                        {BILLING_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="bill-date" className="sl-label">
                    Date
                  </label>
                  <input
                    id="bill-date"
                    type="date"
                    className={field}
                    value={billing.billDate}
                    onChange={(e) => setBilling((b) => ({ ...b, billDate: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bill-amount" className="sl-label">
                    Amount (₹)
                  </label>
                  <input
                    id="bill-amount"
                    className={`${field} tabular-nums`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={billing.amount}
                    onChange={(e) => setBilling((b) => ({ ...b, amount: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="bill-ref" className="sl-label">
                    Reference
                  </label>
                  <input
                    id="bill-ref"
                    className={field}
                    placeholder={billing.kind === "ADVANCE" ? "UTR / cheque no." : "Invoice no."}
                    value={billing.reference}
                    onChange={(e) => setBilling((b) => ({ ...b, reference: e.target.value }))}
                    maxLength={60}
                  />
                </div>
                {billing.kind !== "ADVANCE" && (
                  <>
                    <div>
                      <label htmlFor="bill-adj" className="sl-label">
                        Adjust from advance (₹)
                      </label>
                      <input
                        id="bill-adj"
                        className={`${field} tabular-nums`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        placeholder={`up to ${formatINR(s.advanceBalance)}`}
                        value={billing.advanceAdjusted}
                        onChange={(e) =>
                          setBilling((b) => ({ ...b, advanceAdjusted: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="bill-stage" className="sl-label">
                        For stage
                      </label>
                      <select
                        id="bill-stage"
                        className={field}
                        value={billing.stageId}
                        onChange={(e) => setBilling((b) => ({ ...b, stageId: e.target.value }))}
                      >
                        <option value="">—</option>
                        {job.stages.map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div
                  className={cx(
                    "flex items-end justify-end",
                    billing.kind === "ADVANCE" ? "md:col-span-4" : "md:col-span-2"
                  )}
                >
                  <ActionPill
                    type="submit"
                    variant="secondary"
                    icon={<Plus size={16} />}
                    disabled={busy}
                  >
                    Record
                  </ActionPill>
                </div>
              </form>
            </Tile>
          )}

          <Tile
            padding="none"
            divider
            title="Billing"
            subtitle={`${formatINR(s.billed)} invoiced · ${formatINR(s.advanceBalance)} advance unadjusted`}
          >
            {job.billings.length === 0 ? (
              <EmptyState compact icon={<Receipt size={22} />} title="No advance or invoice yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]" aria-label="Billing">
                  <thead className="bg-card-2">
                    <tr>
                      <th scope="col" className={th}>
                        Date
                      </th>
                      <th scope="col" className={th}>
                        Kind
                      </th>
                      <th scope="col" className={th}>
                        Stage / reference
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Amount
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        From advance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.billings.map((b) => (
                      <tr key={b.id} className="border-t border-line-soft">
                        <td className={`${td} tabular-nums`}>{day(b.billDate)}</td>
                        <td className={td}>
                          <Chip size="sm" tone={b.kind === "ADVANCE" ? "info" : "default"}>
                            {BILLING_LABEL[b.kind]}
                          </Chip>
                        </td>
                        <td className={td}>
                          {[job.stages.find((st) => st.id === b.stageId)?.name, b.reference]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className={`${td} text-right font-semibold tabular-nums`}>
                          {formatINR(b.amount)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {b.kind === "ADVANCE" ? "—" : formatINR(b.advanceAdjusted)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Tile>
        </>
      )}
    </PageBody>
  );
};

export default ProjectJobDetailPage;
