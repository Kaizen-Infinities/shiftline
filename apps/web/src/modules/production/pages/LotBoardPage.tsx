import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowLeftRight,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Undo2,
  X,
} from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  processRoutesService,
  type ChallanOption,
  type Direction,
  type LotBoard,
  type LotCard,
  type LotDetail,
  type LotStatus,
  type ProcessRoute,
  type RouteOptions,
} from "../../../services/processRoutesService";
import { day, message } from "../../compliance/components/gstUi";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatTile,
  Tile,
} from "../../../components/ui/v2";
import { PageBody, formatQty } from "../ui";
import { LocationLine, LotStatusChip, StepChain } from "./processRoutesUi";
import { pct, stepLabel, todayIso } from "./processRoutesFormat";

/**
 * Lot board (TN-06): every lot on a process route as a card showing its step chain, where it is
 * right now (which job worker holds how much) and the loss at each step against the norm, with a
 * green "Record movement" to send it on or book it back.
 */
type Tab = "OPEN" | "COMPLETED" | "CANCELLED";

const field = "sl-input h-11";

const Label: React.FC<{ htmlFor: string; children: React.ReactNode; required?: boolean }> = ({
  htmlFor,
  children,
  required,
}) => (
  <label htmlFor={htmlFor} className="sl-label">
    {children}
    {required && (
      <span className="sl-required" aria-hidden="true">
        *
      </span>
    )}
  </label>
);

/** The step a movement most likely goes to: book back what is out, else send what waits. */
const suggest = (lot: LotCard): { stepSeq: number; direction: Direction } => {
  const out = lot.steps.find(
    (s) => s.state === "IN_PROCESS" && s.holders.some((h) => h.wip == null || h.wip > 0)
  );
  if (out) return { stepSeq: out.seq, direction: "IN" };
  const waiting = lot.steps.find((s) => s.state !== "DONE" && s.availableToSend > 0);
  return { stepSeq: waiting?.seq ?? lot.currentStepSeq, direction: "OUT" };
};

// ─── record movement ─────────────────────────────────────────────────────────

const MovementForm: React.FC<{
  lot: LotCard;
  options: RouteOptions | null;
  onDone: (lot: LotDetail) => void;
  onCancel: () => void;
}> = ({ lot, options, onDone, onCancel }) => {
  const first = suggest(lot);
  const [stepSeq, setStepSeq] = useState(first.stepSeq);
  const [direction, setDirection] = useState<Direction>(first.direction);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayIso());
  const [jobWorkerId, setJobWorkerId] = useState("");
  const [challanId, setChallanId] = useState("");
  const [closesStep, setClosesStep] = useState(true);
  const [remarks, setRemarks] = useState("");
  const [challans, setChallans] = useState<ChallanOption[]>([]);
  const [saving, setSaving] = useState(false);

  const step = lot.steps.find((s) => s.seq === stepSeq) ?? lot.steps[0];
  const jobWork = step.mode === "JOB_WORK";
  const holders = step.holders.filter((h) => h.jobWorkerId && (h.wip ?? 1) > 0);
  const unit = direction === "OUT" ? step.uomIn : step.uomOut;
  const pending =
    direction === "OUT"
      ? step.availableToSend
      : step.expectedOut == null
        ? null
        : Math.max(0, Math.round((step.expectedOut - step.received) * 1000) / 1000);

  useEffect(() => {
    // Default the worker: the step's default when sending, the only holder when booking back.
    if (!jobWork) return setJobWorkerId("");
    if (direction === "OUT") setJobWorkerId(step.defaultJobWorkerId ?? "");
    else setJobWorkerId(holders.length === 1 ? (holders[0].jobWorkerId ?? "") : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSeq, direction]);

  useEffect(() => {
    setChallanId("");
    if (!jobWork) return setChallans([]);
    processRoutesService
      .challans({
        jobWorkerId: jobWorkerId || undefined,
        kind: direction === "OUT" ? "JOB_WORK_OUT" : undefined,
      })
      .then(setChallans)
      .catch(() => setChallans([]));
  }, [jobWork, jobWorkerId, direction]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await processRoutesService.addMovement(lot.id, {
        stepSeq,
        direction,
        qty: Number(qty),
        movementDate: date,
        jobWorkerId: jobWork && jobWorkerId ? jobWorkerId : undefined,
        challanId: jobWork && challanId ? challanId : undefined,
        closesStep: direction === "IN" ? closesStep : undefined,
        remarks: remarks.trim() || undefined,
      });
      toast.success(
        direction === "OUT"
          ? `Sent to ${stepLabel(step.name)}`
          : `Booked back from ${stepLabel(step.name)}`
      );
      onDone(res);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  };

  const idp = `mv-${lot.id}`;
  const workers = options?.jobWorkers ?? [];

  return (
    <form
      onSubmit={submit}
      className="grid grid-cols-2 gap-x-3 gap-y-3 rounded-2xl border border-line-soft bg-card-2 p-3 sm:p-4 md:grid-cols-4"
      aria-label={`Record movement for ${lot.lotNo}`}
    >
      <div className="col-span-2">
        <Label htmlFor={`${idp}-step`} required>
          Step
        </Label>
        <select
          id={`${idp}-step`}
          className={field}
          value={stepSeq}
          onChange={(e) => setStepSeq(Number(e.target.value))}
        >
          {lot.steps.map((s) => (
            <option key={s.seq} value={s.seq} disabled={s.state === "DONE"}>
              {s.seq}. {stepLabel(s.name)}
              {s.state === "DONE" ? " (done)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="col-span-2">
        <span className="sl-label" id={`${idp}-dir`}>
          Movement
        </span>
        <ChipTabs<Direction>
          ariaLabel="Movement direction"
          items={[
            { key: "OUT", label: jobWork ? "Send out" : "Issue to process" },
            { key: "IN", label: jobWork ? "Receive back" : "Output received" },
          ]}
          value={direction}
          onChange={setDirection}
        />
      </div>
      <div>
        <Label htmlFor={`${idp}-qty`} required>
          Quantity ({unit})
        </Label>
        <input
          id={`${idp}-qty`}
          className={`${field} tabular-nums`}
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
        {pending != null && pending > 0 && (
          <button
            type="button"
            className="mt-1 text-[12px] text-accent hover:underline"
            onClick={() => setQty(String(pending))}
          >
            {direction === "OUT" ? "Available" : "Expected"}: {formatQty(pending, unit)}
          </button>
        )}
      </div>
      <div>
        <Label htmlFor={`${idp}-date`} required>
          Date
        </Label>
        <input
          id={`${idp}-date`}
          className={field}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>
      {jobWork && (
        <>
          <div>
            <Label htmlFor={`${idp}-worker`} required={direction === "OUT"}>
              Job worker
            </Label>
            <select
              id={`${idp}-worker`}
              className={field}
              value={jobWorkerId}
              onChange={(e) => setJobWorkerId(e.target.value)}
            >
              <option value="">
                {direction === "OUT" ? "Pick a job worker" : "Whoever holds it"}
              </option>
              {(direction === "IN" && holders.length > 0
                ? holders.map((h) => ({
                    id: h.jobWorkerId as string,
                    name: h.jobWorkerName ?? "Job worker",
                  }))
                : workers
              ).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`${idp}-challan`}>Delivery challan</Label>
            <select
              id={`${idp}-challan`}
              className={field}
              value={challanId}
              onChange={(e) => {
                setChallanId(e.target.value);
                const c = challans.find((x) => x.id === e.target.value);
                if (c) setDate(c.challanDate);
              }}
            >
              <option value="">No challan</option>
              {challans.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.challanNo} · {day(c.challanDate)} ·{" "}
                  {c.kind === "JOB_WORK_RETURN" ? "return" : "out"} · {formatQty(c.qty, c.uom)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div className={jobWork ? "col-span-2" : "col-span-2"}>
        <Label htmlFor={`${idp}-remarks`}>Remarks</Label>
        <input
          id={`${idp}-remarks`}
          className={field}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          maxLength={300}
        />
      </div>
      {direction === "IN" && (
        <label className="col-span-2 flex items-center gap-2 text-sm text-ink md:col-span-2 md:self-end md:pb-3">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={closesStep}
            onChange={(e) => setClosesStep(e.target.checked)}
          />
          This completes {stepLabel(step.name)}; the rest is process loss
        </label>
      )}
      <div className="col-span-2 flex items-end justify-end gap-2.5 md:col-span-4">
        <ActionPill variant="secondary" onClick={onCancel}>
          Cancel
        </ActionPill>
        <ActionPill type="submit" icon={<Check size={17} />} disabled={saving}>
          Save movement
        </ActionPill>
      </div>
    </form>
  );
};

// ─── a lot card ──────────────────────────────────────────────────────────────

const LotCardView: React.FC<{
  lot: LotCard;
  options: RouteOptions | null;
  onChanged: () => void;
}> = ({ lot, options, onChanged }) => {
  const { can } = usePermission();
  const [recording, setRecording] = useState(false);
  const [detail, setDetail] = useState<LotDetail | null>(null);
  const [open, setOpen] = useState(false);
  const view: LotCard = detail ?? lot;

  const toggleHistory = async () => {
    if (open) return setOpen(false);
    try {
      setDetail(await processRoutesService.getLot(lot.id));
      setOpen(true);
    } catch (err) {
      toast.error(message(err));
    }
  };

  const act = async (fn: () => Promise<LotDetail>, done: string) => {
    try {
      setDetail(await fn());
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const cancel = () => {
    const reason = window.prompt(`Why is lot ${lot.lotNo} cancelled?`);
    if (reason) void act(() => processRoutesService.cancelLot(lot.id, reason), "Lot cancelled");
  };

  const lossy = view.steps.filter((s) => s.overNorm);
  const isOpen = view.status === "OPEN";

  return (
    <Tile
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[14px] font-semibold text-ink">{view.lotNo}</span>
          <LotStatusChip status={view.status} />
          {lossy.length > 0 && (
            <Chip size="sm" tone="danger">
              Over norm: {lossy.map((s) => stepLabel(s.name)).join(", ")}
            </Chip>
          )}
        </span>
      }
      subtitle={
        <span>
          {view.route.name} · {formatQty(view.inputQty, view.inputUom)} from {day(view.startDate)}
          {view.product ? ` · ${view.product.name}` : ""}
        </span>
      }
      actions={
        isOpen && can("process-routes.edit") ? (
          <ActionPill
            size="sm"
            icon={recording ? <X size={15} /> : <ArrowLeftRight size={15} />}
            variant={recording ? "secondary" : "cta"}
            onClick={() => setRecording((v) => !v)}
          >
            {recording ? "Close" : "Record movement"}
          </ActionPill>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto pb-1">
          <StepChain steps={view.steps} currentSeq={view.currentStepSeq} />
        </div>

        {view.locations.length > 0 && (
          <div>
            <p className="sl-section-label m-0 mb-1">Where it is</p>
            <ul className="flex flex-col gap-0.5">
              {view.locations.map((l, i) => (
                <LocationLine key={`${l.kind}-${l.stepSeq}-${l.jobWorkerId ?? i}`} loc={l} />
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
          <span>
            Yield <strong className="tabular-nums text-ink">{pct(view.cumulativeYieldPct)}</strong>
            {view.normYieldPct != null && <> against a norm of {pct(view.normYieldPct)}</>}
          </span>
          {view.finalOutput > 0 && (
            <span>
              · Output{" "}
              <strong className="tabular-nums text-ink">
                {formatQty(view.finalOutput, view.finalUom)}
              </strong>
            </span>
          )}
          {view.cancelReason && <span>· Cancelled: {view.cancelReason}</span>}
        </div>

        {recording && (
          <MovementForm
            lot={view}
            options={options}
            onCancel={() => setRecording(false)}
            onDone={(d) => {
              setDetail(d);
              setRecording(false);
              onChanged();
            }}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ActionPill
            variant="ghost"
            size="sm"
            icon={open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            onClick={() => void toggleHistory()}
          >
            Movements
          </ActionPill>
          {isOpen && can("process-routes.edit") && view.closeBlockers.length === 0 && (
            <ActionPill
              variant="blue"
              size="sm"
              icon={<Check size={15} />}
              onClick={() => void act(() => processRoutesService.closeLot(lot.id), "Lot closed")}
            >
              Close lot
            </ActionPill>
          )}
          {isOpen && can("process-routes.edit") && (
            <ActionPill variant="ghost" size="sm" icon={<Ban size={15} />} onClick={cancel}>
              Cancel lot
            </ActionPill>
          )}
        </div>

        {open && detail && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm" aria-label={`${lot.lotNo} movements`}>
              <thead className="bg-card-2">
                <tr>
                  <th className="sl-th px-3 py-2 text-left">Date</th>
                  <th className="sl-th px-3 py-2 text-left">Step</th>
                  <th className="sl-th px-3 py-2 text-left">Movement</th>
                  <th className="sl-th px-3 py-2 !text-right">Qty</th>
                  <th className="sl-th px-3 py-2 text-left">Job worker / challan</th>
                  <th className="sl-th px-3 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {detail.movements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-ink-muted">
                      Nothing recorded yet.
                    </td>
                  </tr>
                )}
                {detail.movements.map((m) => (
                  <tr key={m.id} className="border-t border-line-soft">
                    <td className="px-3 py-2 tabular-nums">{day(m.movementDate)}</td>
                    <td className="px-3 py-2">
                      {m.stepSeq}. {stepLabel(m.stepName ?? "")}
                    </td>
                    <td className="px-3 py-2">
                      <Chip size="sm" tone={m.direction === "OUT" ? "warning" : "success"}>
                        {m.direction === "OUT" ? "Out" : m.closesStep ? "In · step done" : "In"}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQty(m.qty, m.uom)}</td>
                    <td className="px-3 py-2">
                      {m.jobWorker?.name ?? "In-house"}
                      {m.challan && (
                        <span className="ml-1 font-mono text-[12px] text-ink-muted">
                          {m.challan.challanNo}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {m.undoable && can("process-routes.delete") && (
                        <ActionPill
                          variant="ghost"
                          size="sm"
                          icon={<Undo2 size={14} />}
                          onClick={() =>
                            void act(
                              () => processRoutesService.undoMovement(lot.id, m.id),
                              "Movement taken back"
                            )
                          }
                        >
                          Undo
                        </ActionPill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Tile>
  );
};

// ─── the page ────────────────────────────────────────────────────────────────

const LotBoardPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<Tab>("OPEN");
  const [board, setBoard] = useState<LotBoard | null>(null);
  const [others, setOthers] = useState<LotCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<RouteOptions | null>(null);
  const [routes, setRoutes] = useState<ProcessRoute[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    lotNo: "",
    routeId: "",
    inputQty: "",
    startDate: todayIso(),
    remarks: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (which: Tab, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const b = await processRoutesService.board();
      setBoard(b);
      setOthers(which === "OPEN" ? [] : await processRoutesService.listLots(which as LotStatus));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  useEffect(() => {
    processRoutesService
      .options()
      .then(setOptions)
      .catch(() => setOptions(null));
    processRoutesService
      .listRoutes()
      .then((r) => setRoutes(r.filter((x) => x.active)))
      .catch(() => setRoutes([]));
  }, []);

  const lots = tab === "OPEN" ? (board?.lots ?? []) : others;
  const s = board?.summary;
  const route = useMemo(() => routes.find((r) => r.id === form.routeId), [routes, form.routeId]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await processRoutesService.createLot({
        lotNo: form.lotNo.trim(),
        routeId: form.routeId,
        inputQty: Number(form.inputQty),
        startDate: form.startDate,
        remarks: form.remarks.trim() || undefined,
      });
      toast.success("Lot created");
      setForm({ lotNo: "", routeId: "", inputQty: "", startDate: todayIso(), remarks: "" });
      setShowForm(false);
      setTab("OPEN");
      await load("OPEN", true);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  };

  const atWorkers = s?.atJobWorkers ?? [];

  return (
    <PageBody>
      <PageHeader
        title="Lot board"
        icon={<Layers size={22} />}
        subtitle="Where every lot is on its route, what each job worker holds, and the loss at each step against the norm."
        actions={
          <Link to="/production/process-routes" className="sl-btn sl-pill-md">
            Process routes <ChevronRight size={16} />
          </Link>
        }
        primaryAction={
          can("process-routes.create") ? (
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
                New lot
              </ActionPill>
            )
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Open lots" value={s?.open ?? "—"} loading={!board} />
        <StatTile
          label="At job workers"
          value={atWorkers.reduce((n, w) => n + w.lots, 0)}
          hint={`${atWorkers.length} ${atWorkers.length === 1 ? "worker" : "workers"}`}
          loading={!board}
        />
        <StatTile
          label="Over loss norm"
          value={s?.overNormLots ?? "—"}
          deltaTone={s && s.overNormLots > 0 ? "danger" : undefined}
          hint="open lots with a step over its norm"
          loading={!board}
        />
        <StatTile label="Completed" value={s?.completed ?? "—"} loading={!board} />
      </div>

      {atWorkers.length > 0 && (
        <Tile title="Work in process at job workers" padding="sm">
          <ul className="flex flex-wrap gap-2">
            {atWorkers.map((w) => (
              <li key={w.jobWorkerId}>
                <Chip size="md" tone="warning">
                  {w.name ?? "Job worker"} · {w.qty.map((q) => formatQty(q.qty, q.uom)).join(" + ")}{" "}
                  · {w.lots} {w.lots === 1 ? "lot" : "lots"}
                </Chip>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      {showForm && (
        <Tile
          title="New lot"
          subtitle="The lot goes into the route's first step in that step's unit."
        >
          <form onSubmit={create} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
            <div>
              <Label htmlFor="lot-no" required>
                Lot no.
              </Label>
              <input
                id="lot-no"
                className={field}
                value={form.lotNo}
                onChange={(e) => setForm({ ...form, lotNo: e.target.value })}
                maxLength={30}
                placeholder="L-2409-01"
                required
              />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="lot-route" required>
                Route
              </Label>
              <select
                id="lot-route"
                className={field}
                value={form.routeId}
                onChange={(e) => setForm({ ...form, routeId: e.target.value })}
                required
              >
                <option value="">Pick a route</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.routeCode} · {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="lot-start" required>
                Start date
              </Label>
              <input
                id="lot-start"
                className={field}
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="lot-qty" required>
                Input quantity{route?.steps[0] ? ` (${route.steps[0].uomIn})` : ""}
              </Label>
              <input
                id="lot-qty"
                className={`${field} tabular-nums`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={form.inputQty}
                onChange={(e) => setForm({ ...form, inputQty: e.target.value })}
                required
              />
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="lot-remarks">Remarks</Label>
              <input
                id="lot-remarks"
                className={field}
                value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                maxLength={300}
              />
            </div>
            <div className="flex items-end justify-end gap-2.5 md:col-span-4">
              <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />} disabled={saving}>
                Create lot
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      <ChipTabs<Tab>
        ariaLabel="Lot status"
        items={[
          { key: "OPEN", label: "Open", count: s?.open },
          { key: "COMPLETED", label: "Completed", count: s?.completed },
          { key: "CANCELLED", label: "Cancelled", count: s?.cancelled },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading ? (
        <Tile padding="none">
          <SkeletonRows rows={4} columns={3} />
        </Tile>
      ) : lots.length === 0 ? (
        <Tile>
          <EmptyState
            icon={<Layers size={22} />}
            title={tab === "OPEN" ? "No open lots." : `No ${tab.toLowerCase()} lots.`}
            description={
              tab === "OPEN"
                ? routes.length === 0
                  ? "Set up a process route first, then start a lot on it."
                  : "Start a lot to follow it through knitting, dyeing, printing and stitching."
                : undefined
            }
            action={
              tab === "OPEN" && can("process-routes.create") ? (
                routes.length === 0 ? (
                  <Link to="/production/process-routes" className="sl-cta sl-pill-md">
                    Set up a route
                  </Link>
                ) : (
                  <ActionPill icon={<Plus size={18} />} onClick={() => setShowForm(true)}>
                    New lot
                  </ActionPill>
                )
              ) : undefined
            }
          />
        </Tile>
      ) : (
        <div className="flex flex-col gap-4">
          {lots.map((lot) => (
            <LotCardView
              key={`${lot.id}-${lot.status}-${lot.steps.map((x) => `${x.sent}/${x.received}`).join(",")}`}
              lot={lot}
              options={options}
              onChanged={() => void load(tab, true)}
            />
          ))}
        </div>
      )}
    </PageBody>
  );
};

export default LotBoardPage;
