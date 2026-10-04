import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { CalendarClock, Plus, Truck, X } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { customerService } from "../../../services/customerService";
import {
  deliveryScheduleService,
  parseSchedulePaste,
  type AdherenceRow,
  type DueRow,
  type LineStatus,
  type ScheduleDetail,
  type ScheduleLine,
  type ScheduleRow,
} from "../../../services/deliveryScheduleService";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  ChipTabs,
  Field,
  PageHeader,
  Tile,
  cx,
  fieldControlClass,
  type ChipTone,
} from "../../../components/ui/v2";
import { PAGE_CLASS, errorMessage, formatDateIN, monthOptions } from "../shared/tradeUi";

/**
 * Customer (OEM) delivery schedules and schedule adherence (TN-02): the schedules received, the
 * FIRM lines due this week, and adherence / OTIF per customer and month the way the OEM rates it.
 */
type Tab = "schedules" | "due" | "adherence";

const LINE_TONE: Record<LineStatus, ChipTone> = {
  PENDING: "muted",
  MET: "success",
  LATE: "warning",
  SHORT: "danger",
  EXCESS: "info",
};

/** ≥95 green, 85–95 amber, <85 red — the bands an OEM vendor rating uses. */
const pctTone = (v: number | null): ChipTone =>
  v === null ? "muted" : v >= 95 ? "success" : v >= 85 ? "warning" : "danger";
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const PctChip: React.FC<{ value: number | null }> = ({ value }) =>
  value === null ? (
    <span className="text-ink-subtle">—</span>
  ) : (
    <Chip size="sm" tone={pctTone(value)} className="tabular-nums">
      {pct(value)}
    </Chip>
  );
const qty = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const todayIso = () => new Date().toISOString().slice(0, 10);
const num = (v: number) => <span className="tabular-nums">{qty(v)}</span>;

const DeliverySchedulesPage: React.FC = () => {
  const { can } = usePermission();
  const canCreate = can("delivery-schedules.create");
  const months = monthOptions(12);
  const [tab, setTab] = useState<Tab>("schedules");

  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [selected, setSelected] = useState<ScheduleDetail | null>(null);
  const [due, setDue] = useState<DueRow[]>([]);
  const [rows, setRows] = useState<AdherenceRow[]>([]);
  const [from, setFrom] = useState(months[5].value);
  const [to, setTo] = useState(months[0].value);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    scheduleNo: "",
    customerId: "",
    customerPoNo: "",
    periodMonth: months[0].value,
    receivedOn: todayIso(),
    paste: "",
  });
  const [dispatch, setDispatch] = useState<{ lineId: string; qty: string; date: string } | null>(
    null
  );

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      setSchedules(await deliveryScheduleService.list({}));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "schedules") void loadSchedules();
    if (tab === "due")
      deliveryScheduleService
        .due(7)
        .then(setDue)
        .catch((err) => toast.error(errorMessage(err)));
    if (tab === "adherence")
      deliveryScheduleService
        .adherence(from < to ? from : to, from < to ? to : from)
        .then(setRows)
        .catch((err) => toast.error(errorMessage(err)));
  }, [tab, from, to, loadSchedules]);

  useEffect(() => {
    if (!canCreate) return;
    customerService
      .fetchAll({ limit: 200 })
      .then((r) =>
        setCustomers(
          r.customers.map((c) => ({
            id: String(c.id),
            name: (c as { displayName?: string }).displayName || c.firmName,
          }))
        )
      )
      .catch(() => setCustomers([]));
  }, [canCreate]);

  const open = async (id: string) => {
    try {
      setSelected(await deliveryScheduleService.get(id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const { lines, skipped } = parseSchedulePaste(form.paste);
    if (skipped.length > 0) {
      toast.error(`Could not read pasted row(s) ${skipped.join(", ")}`);
      return;
    }
    try {
      const created = await deliveryScheduleService.create({
        scheduleNo: form.scheduleNo.trim(),
        customerId: form.customerId,
        customerPoNo: form.customerPoNo.trim() || undefined,
        periodMonth: form.periodMonth,
        receivedOn: form.receivedOn,
        lines,
      });
      toast.success(`Schedule ${created.scheduleNo} saved with ${created.lines.length} lines`);
      setForm((f) => ({ ...f, scheduleNo: "", customerPoNo: "", paste: "" }));
      setSelected(created);
      setShowForm(false);
      await loadSchedules();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const bookDispatch = async () => {
    if (!dispatch || !selected) return;
    try {
      await deliveryScheduleService.addDispatch(dispatch.lineId, {
        dispatchDate: dispatch.date,
        qty: Number(dispatch.qty),
      });
      setDispatch(null);
      await open(selected.id);
      toast.success("Dispatch recorded");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const newButton = canCreate ? (
    <ActionPill
      icon={showForm ? <X size={18} /> : <Plus size={18} />}
      variant={showForm ? "secondary" : "cta"}
      onClick={() => {
        setTab("schedules");
        setShowForm((v) => !v);
      }}
    >
      {showForm ? "Close" : "New Schedule"}
    </ActionPill>
  ) : null;

  const scheduleColumns: DataTableColumn<ScheduleRow>[] = [
    {
      header: "Schedule",
      render: (s) => (
        <button
          type="button"
          onClick={() => void open(s.id)}
          className="font-semibold text-accent hover:underline underline-offset-4"
        >
          {s.scheduleNo}
          {s.revision > 0 && (
            <span className="ml-1.5 text-xs font-medium text-ink-subtle">rev {s.revision}</span>
          )}
        </button>
      ),
    },
    { header: "Customer", render: (s) => <span className="text-ink">{s.customerName}</span> },
    { header: "Month", render: (s) => <span className="tabular-nums">{s.periodMonth}</span> },
    {
      header: "Status",
      render: (s) => (
        <Chip
          size="sm"
          dot
          tone={s.status === "OPEN" ? "info" : s.status === "CANCELLED" ? "danger" : "muted"}
        >
          {s.status}
        </Chip>
      ),
    },
    { header: "Lines", align: "right", render: (s) => num(s.lineCount) },
    { header: "Adherence", align: "right", render: (s) => <PctChip value={s.adherencePct} /> },
    { header: "OTIF", align: "right", render: (s) => <PctChip value={s.otifPct} /> },
  ];

  const lineColumns: DataTableColumn<ScheduleLine>[] = [
    { header: "Part", render: (l) => <span className="font-medium">{l.customerPartNo}</span> },
    {
      header: "Due",
      render: (l) => <span className="tabular-nums">{formatDateIN(l.dueDate)}</span>,
    },
    {
      header: "Firm",
      render: (l) => (
        <Chip size="sm" tone={l.firmness === "FIRM" ? "default" : "muted"}>
          {l.firmness === "FIRM" ? "F" : "T"}
        </Chip>
      ),
    },
    { header: "Scheduled", align: "right", render: (l) => num(l.scheduledQty) },
    { header: "Dispatched", align: "right", render: (l) => num(l.metrics.dispatched) },
    { header: "On time", align: "right", render: (l) => num(l.metrics.onTime) },
    { header: "Short", align: "right", render: (l) => num(l.metrics.short) },
    {
      header: "Status",
      render: (l) => (
        <Chip size="sm" dot tone={LINE_TONE[l.metrics.status]}>
          {l.metrics.status}
        </Chip>
      ),
    },
    {
      header: "Dispatch",
      align: "right",
      render: (l) =>
        canCreate && selected && selected.status !== "CANCELLED" ? (
          dispatch?.lineId === l.id ? (
            <span className="flex items-center gap-1.5">
              <input
                type="date"
                aria-label="Dispatch date"
                className="sl-input h-9 w-36 text-sm"
                value={dispatch.date}
                onChange={(e) => setDispatch({ ...dispatch, date: e.target.value })}
              />
              <input
                className="sl-input h-9 w-24 text-right text-sm tabular-nums"
                inputMode="decimal"
                aria-label="Dispatch quantity"
                placeholder="Qty"
                value={dispatch.qty}
                onChange={(e) => setDispatch({ ...dispatch, qty: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void bookDispatch();
                  if (e.key === "Escape") setDispatch(null);
                }}
              />
              <ActionPill size="sm" onClick={bookDispatch}>
                Save
              </ActionPill>
            </span>
          ) : (
            <ActionPill
              size="sm"
              variant="secondary"
              icon={<Truck size={15} />}
              onClick={() =>
                setDispatch({
                  lineId: l.id,
                  qty: String(l.metrics.remaining || ""),
                  date: todayIso(),
                })
              }
            >
              Dispatch
            </ActionPill>
          )
        ) : null,
    },
  ];

  const dueColumns: DataTableColumn<DueRow>[] = [
    {
      header: "Due",
      render: (r) => (
        <span className="flex items-center gap-2 tabular-nums">
          {formatDateIN(r.dueDate)}
          {r.overdue && (
            <Chip size="sm" tone="danger">
              Overdue
            </Chip>
          )}
        </span>
      ),
    },
    { header: "Customer", render: (r) => <span className="text-ink">{r.customerName}</span> },
    { header: "Schedule", accessor: "scheduleNo" },
    { header: "Part", render: (r) => <span className="font-medium">{r.customerPartNo}</span> },
    { header: "Scheduled", align: "right", render: (r) => num(r.scheduledQty) },
    { header: "Dispatched", align: "right", render: (r) => num(r.dispatchedQty) },
    {
      header: "Remaining",
      align: "right",
      render: (r) => <span className="font-semibold tabular-nums">{qty(r.remainingQty)}</span>,
    },
  ];

  const adherenceColumns: DataTableColumn<AdherenceRow>[] = [
    { header: "Customer", render: (r) => <span className="text-ink">{r.customerName}</span> },
    { header: "Month", render: (r) => <span className="tabular-nums">{r.month}</span> },
    { header: "Scheduled", align: "right", render: (r) => num(r.scheduled) },
    { header: "On time", align: "right", render: (r) => num(r.onTime) },
    { header: "Late", align: "right", render: (r) => num(r.late) },
    { header: "Short", align: "right", render: (r) => num(r.short) },
    { header: "Adherence", align: "right", render: (r) => <PctChip value={r.adherencePct} /> },
    { header: "OTIF", align: "right", render: (r) => <PctChip value={r.otifPct} /> },
  ];

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Delivery schedules"
        subtitle="Customer schedules, what is due this week, and schedule adherence the way the OEM rates it."
        icon={<CalendarClock size={22} />}
        primaryAction={newButton}
      >
        <ChipTabs<Tab>
          ariaLabel="Delivery schedule views"
          value={tab}
          onChange={setTab}
          items={[
            { key: "schedules", label: "Schedules" },
            { key: "due", label: "Due this week" },
            { key: "adherence", label: "Adherence" },
          ]}
        />
      </PageHeader>

      {tab === "schedules" && (
        <div className="flex flex-col gap-5">
          {canCreate && showForm && (
            <Tile
              title="New schedule"
              subtitle="Paste the release straight from the customer's Excel sheet."
            >
              <form onSubmit={create} className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <Field label="Schedule / release no" required>
                  <input
                    className={fieldControlClass()}
                    value={form.scheduleNo}
                    onChange={(e) => setForm({ ...form, scheduleNo: e.target.value })}
                    required
                    maxLength={40}
                  />
                </Field>
                <Field label="Customer" required>
                  <select
                    className={fieldControlClass()}
                    value={form.customerId}
                    onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                    required
                  >
                    <option value="">Customer…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Customer PO / SA no">
                  <input
                    className={fieldControlClass()}
                    value={form.customerPoNo}
                    onChange={(e) => setForm({ ...form, customerPoNo: e.target.value })}
                    maxLength={40}
                  />
                </Field>
                <Field label="Month">
                  <select
                    className={fieldControlClass()}
                    value={form.periodMonth}
                    onChange={(e) => setForm({ ...form, periodMonth: e.target.value })}
                  >
                    {months.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Received on" required>
                  <input
                    type="date"
                    className={fieldControlClass()}
                    value={form.receivedOn}
                    onChange={(e) => setForm({ ...form, receivedOn: e.target.value })}
                    required
                  />
                </Field>
                <Field
                  label="Lines"
                  hint="One line per row: part no ⇥ due date ⇥ qty ⇥ F/T"
                  className="md:col-span-2 lg:col-span-5"
                >
                  <textarea
                    className="sl-input w-full py-2.5 font-mono text-sm"
                    rows={5}
                    placeholder={
                      "Paste from Excel: part no ⇥ due date ⇥ qty ⇥ F/T\nBRKT-101\t05/10/2026\t1200\tF"
                    }
                    value={form.paste}
                    onChange={(e) => setForm({ ...form, paste: e.target.value })}
                  />
                </Field>
                <div className="flex justify-end gap-2 md:col-span-2 lg:col-span-5">
                  <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                    Cancel
                  </ActionPill>
                  <ActionPill type="submit">Save schedule</ActionPill>
                </div>
              </form>
            </Tile>
          )}

          <DataTable
            columns={scheduleColumns}
            data={schedules}
            rowKey={(s) => s.id}
            loading={loading}
            ariaLabel="Delivery schedules"
            onRowClick={(s) => void open(s.id)}
            emptyMessage="No delivery schedules yet."
            emptyAction={showForm ? undefined : newButton}
          />

          {selected && (
            <Tile
              padding="none"
              title={selected.scheduleNo}
              subtitle={`${selected.customerName} · ${selected.periodMonth}`}
              actions={
                <>
                  <span className="text-[13px] text-ink-subtle">FIRM lines only</span>
                  <Chip tone={pctTone(selected.totals.adherencePct)}>
                    Adherence {pct(selected.totals.adherencePct)}
                  </Chip>
                  <Chip tone={pctTone(selected.totals.otifPct)}>
                    OTIF {pct(selected.totals.otifPct)}
                  </Chip>
                  <button
                    type="button"
                    className="sl-icon-btn sl-icon-btn-md"
                    aria-label="Close schedule"
                    onClick={() => setSelected(null)}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </>
              }
            >
              <DataTable
                columns={lineColumns}
                data={selected.lines}
                rowKey={(l) => l.id}
                density="compact"
                ariaLabel={`Lines of schedule ${selected.scheduleNo}`}
                className="!rounded-none !border-0 !shadow-none"
                emptyMessage="This schedule has no lines."
              />
            </Tile>
          )}
        </div>
      )}

      {tab === "due" && (
        <div>
          <p className="sl-muted m-0 mb-3 text-sm">FIRM lines due in the next 7 days</p>
          <DataTable
            columns={dueColumns}
            data={due}
            rowKey={(r) => r.lineId}
            ariaLabel="FIRM lines due in the next 7 days"
            rowClassName={(r) => cx(r.overdue && "bg-[color:var(--color-danger)]/5")}
            emptyMessage="Nothing due this week."
          />
        </div>
      )}

      {tab === "adherence" && (
        <div className="flex flex-col gap-4">
          <Tile padding="sm">
            <div className="flex flex-wrap items-end gap-4">
              <Field label="From" className="w-full sm:w-56">
                <select
                  className={fieldControlClass()}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="To" className="w-full sm:w-56">
                <select
                  className={fieldControlClass()}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                >
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="sl-muted m-0 pb-3 text-[13px]">
                ≥95% green · 85–95% amber · below 85% red, as OEM vendor ratings band it.
              </p>
            </div>
          </Tile>
          <DataTable
            columns={adherenceColumns}
            data={rows}
            rowKey={(r) => `${r.customerId}-${r.month}`}
            ariaLabel="Schedule adherence"
            emptyMessage="No schedules in this range."
          />
        </div>
      )}
    </div>
  );
};

export default DeliverySchedulesPage;
