import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { customerService } from "../../../services/customerService";
import {
  deliveryScheduleService,
  parseSchedulePaste,
  type AdherenceRow,
  type DueRow,
  type LineStatus,
  type ScheduleDetail,
  type ScheduleRow,
} from "../../../services/deliveryScheduleService";
import {
  Card,
  day,
  field,
  message,
  monthOptions,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Customer (OEM) delivery schedules and schedule adherence (TN-02): the schedules received, the
 * FIRM lines due this week, and adherence / OTIF per customer and month the way the OEM rates it.
 */
type Tab = "schedules" | "due" | "adherence";

const LINE_STYLE: Record<LineStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  MET: "bg-emerald-100 text-emerald-800",
  LATE: "bg-amber-100 text-amber-800",
  SHORT: "bg-rose-100 text-rose-700",
  EXCESS: "bg-violet-100 text-violet-800",
};

/** ≥95 green, 85–95 amber, <85 red — the bands an OEM vendor rating uses. */
const pctClass = (pct: number | null) =>
  pct === null
    ? "text-ink-muted"
    : pct >= 95
      ? "bg-emerald-50 text-emerald-800 font-semibold"
      : pct >= 85
        ? "bg-amber-50 text-amber-800 font-semibold"
        : "bg-rose-50 text-rose-700 font-semibold";
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const qty = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const todayIso = () => new Date().toISOString().slice(0, 10);

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
      toast.error(message(err));
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
        .catch((err) => toast.error(message(err)));
    if (tab === "adherence")
      deliveryScheduleService
        .adherence(from < to ? from : to, from < to ? to : from)
        .then(setRows)
        .catch((err) => toast.error(message(err)));
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
      toast.error(message(err));
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
      await loadSchedules();
    } catch (err) {
      toast.error(message(err));
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
      toast.error(message(err));
    }
  };

  const tabBtn = (key: Tab, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
        tab === key ? "bg-blue-600 text-white" : "text-ink hover:bg-card-2"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">Delivery Schedules</h1>
          <p className="text-sm text-ink-muted">
            Customer schedules, what is due this week, and schedule adherence the way the OEM rates
            it.
          </p>
        </div>
        <nav className="flex gap-1">
          {tabBtn("schedules", "Schedules")}
          {tabBtn("due", "Due this week")}
          {tabBtn("adherence", "Adherence")}
        </nav>
      </header>

      {tab === "schedules" && (
        <>
          {canCreate && (
            <Card title="New schedule">
              <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
                <input
                  className={field}
                  placeholder="Schedule / release no"
                  value={form.scheduleNo}
                  onChange={(e) => setForm({ ...form, scheduleNo: e.target.value })}
                  required
                  maxLength={40}
                />
                <select
                  className={field}
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
                <input
                  className={field}
                  placeholder="Customer PO / SA no"
                  value={form.customerPoNo}
                  onChange={(e) => setForm({ ...form, customerPoNo: e.target.value })}
                  maxLength={40}
                />
                <select
                  className={field}
                  value={form.periodMonth}
                  onChange={(e) => setForm({ ...form, periodMonth: e.target.value })}
                >
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className={field}
                  value={form.receivedOn}
                  onChange={(e) => setForm({ ...form, receivedOn: e.target.value })}
                  required
                />
                <textarea
                  className={`${field} font-mono md:col-span-4`}
                  rows={4}
                  placeholder={
                    "Paste from Excel: part no ⇥ due date ⇥ qty ⇥ F/T\nBRKT-101\t05/10/2026\t1200\tF"
                  }
                  value={form.paste}
                  onChange={(e) => setForm({ ...form, paste: e.target.value })}
                />
                <div className="flex items-end">
                  <button type="submit" className={primary}>
                    Save schedule
                  </button>
                </div>
              </form>
            </Card>
          )}

          <Card title="Schedules">
            {loading ? (
              <p className="text-sm text-ink-muted">Loading…</p>
            ) : schedules.length === 0 ? (
              <p className="text-sm text-ink-muted">No delivery schedules yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className={th}>Schedule</th>
                      <th className={th}>Customer</th>
                      <th className={th}>Month</th>
                      <th className={th}>Status</th>
                      <th className={`${th} text-right`}>Lines</th>
                      <th className={`${th} text-right`}>Adherence</th>
                      <th className={`${th} text-right`}>OTIF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr
                        key={s.id}
                        className="cursor-pointer border-t border-line-soft hover:bg-card-2"
                        onClick={() => void open(s.id)}
                      >
                        <td className={td}>
                          {s.scheduleNo}
                          {s.revision > 0 && (
                            <span className="ml-1 text-xs text-ink-muted">rev {s.revision}</span>
                          )}
                        </td>
                        <td className={td}>{s.customerName}</td>
                        <td className={td}>{s.periodMonth}</td>
                        <td className={td}>{s.status}</td>
                        <td className={`${td} text-right`}>{s.lineCount}</td>
                        <td className={`${td} text-right ${pctClass(s.adherencePct)}`}>
                          {pct(s.adherencePct)}
                        </td>
                        <td className={`${td} text-right ${pctClass(s.otifPct)}`}>
                          {pct(s.otifPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {selected && (
            <Card
              title={`${selected.scheduleNo} · ${selected.customerName} · ${selected.periodMonth}`}
              actions={
                <button type="button" className={secondary} onClick={() => setSelected(null)}>
                  Close
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className={th}>Part</th>
                      <th className={th}>Due</th>
                      <th className={th}>Firm</th>
                      <th className={`${th} text-right`}>Scheduled</th>
                      <th className={`${th} text-right`}>Dispatched</th>
                      <th className={`${th} text-right`}>On time</th>
                      <th className={`${th} text-right`}>Short</th>
                      <th className={th}>Status</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((l) => (
                      <tr key={l.id} className="border-t border-line-soft">
                        <td className={td}>{l.customerPartNo}</td>
                        <td className={td}>{day(l.dueDate)}</td>
                        <td className={td}>{l.firmness === "FIRM" ? "F" : "T"}</td>
                        <td className={`${td} text-right`}>{qty(l.scheduledQty)}</td>
                        <td className={`${td} text-right`}>{qty(l.metrics.dispatched)}</td>
                        <td className={`${td} text-right`}>{qty(l.metrics.onTime)}</td>
                        <td className={`${td} text-right`}>{qty(l.metrics.short)}</td>
                        <td className={td}>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${LINE_STYLE[l.metrics.status]}`}
                          >
                            {l.metrics.status}
                          </span>
                        </td>
                        <td className={td}>
                          {canCreate && selected.status !== "CANCELLED" && (
                            <>
                              {dispatch?.lineId === l.id ? (
                                <span className="flex gap-1">
                                  <input
                                    type="date"
                                    className={field}
                                    value={dispatch.date}
                                    onChange={(e) =>
                                      setDispatch({ ...dispatch, date: e.target.value })
                                    }
                                  />
                                  <input
                                    className={`${field} w-24`}
                                    inputMode="decimal"
                                    placeholder="Qty"
                                    value={dispatch.qty}
                                    onChange={(e) =>
                                      setDispatch({ ...dispatch, qty: e.target.value })
                                    }
                                  />
                                  <button type="button" className={primary} onClick={bookDispatch}>
                                    Save
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className={secondary}
                                  onClick={() =>
                                    setDispatch({
                                      lineId: l.id,
                                      qty: String(l.metrics.remaining || ""),
                                      date: todayIso(),
                                    })
                                  }
                                >
                                  Dispatch
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                Adherence{" "}
                <span className={`rounded px-1 ${pctClass(selected.totals.adherencePct)}`}>
                  {pct(selected.totals.adherencePct)}
                </span>{" "}
                · OTIF{" "}
                <span className={`rounded px-1 ${pctClass(selected.totals.otifPct)}`}>
                  {pct(selected.totals.otifPct)}
                </span>{" "}
                (FIRM lines only)
              </p>
            </Card>
          )}
        </>
      )}

      {tab === "due" && (
        <Card title="FIRM lines due in the next 7 days">
          {due.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing due this week.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Due</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Schedule</th>
                    <th className={th}>Part</th>
                    <th className={`${th} text-right`}>Scheduled</th>
                    <th className={`${th} text-right`}>Dispatched</th>
                    <th className={`${th} text-right`}>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {due.map((r) => (
                    <tr key={r.lineId} className="border-t border-line-soft">
                      <td className={`${td} ${r.overdue ? "font-semibold text-rose-700" : ""}`}>
                        {day(r.dueDate)}
                        {r.overdue && " (overdue)"}
                      </td>
                      <td className={td}>{r.customerName}</td>
                      <td className={td}>{r.scheduleNo}</td>
                      <td className={td}>{r.customerPartNo}</td>
                      <td className={`${td} text-right`}>{qty(r.scheduledQty)}</td>
                      <td className={`${td} text-right`}>{qty(r.dispatchedQty)}</td>
                      <td className={`${td} text-right font-semibold`}>{qty(r.remainingQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "adherence" && (
        <Card
          title="Schedule adherence"
          actions={
            <span className="flex gap-2">
              <select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </span>
          }
        >
          {rows.length === 0 ? (
            <p className="text-sm text-ink-muted">No schedules in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Customer</th>
                    <th className={th}>Month</th>
                    <th className={`${th} text-right`}>Scheduled</th>
                    <th className={`${th} text-right`}>On time</th>
                    <th className={`${th} text-right`}>Late</th>
                    <th className={`${th} text-right`}>Short</th>
                    <th className={`${th} text-right`}>Adherence</th>
                    <th className={`${th} text-right`}>OTIF</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.customerId}-${r.month}`} className="border-t border-line-soft">
                      <td className={td}>{r.customerName}</td>
                      <td className={td}>{r.month}</td>
                      <td className={`${td} text-right`}>{qty(r.scheduled)}</td>
                      <td className={`${td} text-right`}>{qty(r.onTime)}</td>
                      <td className={`${td} text-right`}>{qty(r.late)}</td>
                      <td className={`${td} text-right`}>{qty(r.short)}</td>
                      <td className={`${td} text-right ${pctClass(r.adherencePct)}`}>
                        {pct(r.adherencePct)}
                      </td>
                      <td className={`${td} text-right ${pctClass(r.otifPct)}`}>
                        {pct(r.otifPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default DeliverySchedulesPage;
