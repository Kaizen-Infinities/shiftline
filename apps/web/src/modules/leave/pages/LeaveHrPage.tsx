import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { labourService, type LeaveTypeRow } from "../../../services/labourService";
import {
  leaveService,
  type CalendarRow,
  type LeaveRequestRow,
  type LeaveRequestStatus,
} from "../../../services/leaveService";
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
 * Leave requests, approval and the calendar (P2-09) — the manager's view of what
 * `labourService` accrues and `leaveService` moves against it.
 */
type Tab = "requests" | "calendar";
const STATUS_STYLE: Record<LeaveRequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-700",
};

const emptyForm = {
  employeeId: "",
  leaveTypeCode: "",
  fromDate: "",
  toDate: "",
  halfDayStart: false,
  halfDayEnd: false,
  reason: "",
};

const LeaveHrPage: React.FC = () => {
  const { can } = usePermission();
  const months = useMemo(() => monthOptions(6), []);
  const [tab, setTab] = useState<Tab>("requests");
  const [status, setStatus] = useState<LeaveRequestStatus | "">("");
  const [requests, setRequests] = useState<LeaveRequestRow[]>([]);
  const [types, setTypes] = useState<LeaveTypeRow[]>([]);
  const [month, setMonth] = useState(months[0].value);
  const [calendar, setCalendar] = useState<CalendarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "requests") {
        const [rows, leaveTypes] = await Promise.all([
          leaveService.listRequests(status ? { status } : {}),
          labourService.leaveTypes(),
        ]);
        setRequests(rows);
        setTypes(leaveTypes);
      } else {
        const report = await leaveService.calendar(month);
        setCalendar(report.rows);
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, status, month]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(async () => {
      await leaveService.createRequest({
        employeeId: form.employeeId.trim(),
        leaveTypeCode: form.leaveTypeCode,
        fromDate: form.fromDate,
        toDate: form.toDate,
        halfDayStart: form.halfDayStart,
        halfDayEnd: form.halfDayEnd,
        reason: form.reason.trim() || undefined,
      });
      setForm(emptyForm);
      setShowForm(false);
    }, "Leave requested");
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Leave</h1>
          <p className="text-sm text-ink-muted">
            Requests waiting on a decision, and who is off on the calendar.
          </p>
        </div>
        <nav className="flex gap-2">
          <button
            className={tab === "requests" ? primary : secondary}
            onClick={() => setTab("requests")}
          >
            Requests
          </button>
          <button
            className={tab === "calendar" ? primary : secondary}
            onClick={() => setTab("calendar")}
          >
            Calendar
          </button>
        </nav>
      </header>

      {tab === "requests" && (
        <Card
          title="Leave requests"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <select
                className={field}
                value={status}
                onChange={(e) => setStatus(e.target.value as LeaveRequestStatus | "")}
                aria-label="Status"
              >
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              {can("leave.request") && (
                <button className={primary} onClick={() => setShowForm((v) => !v)}>
                  {showForm ? "Close" : "New request"}
                </button>
              )}
            </div>
          }
        >
          {showForm && (
            <form
              onSubmit={submitRequest}
              className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft p-3 sm:grid-cols-3"
            >
              <input
                className={field}
                placeholder="Employee ID"
                value={form.employeeId}
                onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                required
              />
              <select
                className={field}
                value={form.leaveTypeCode}
                onChange={(e) => setForm((f) => ({ ...f, leaveTypeCode: e.target.value }))}
                required
              >
                <option value="">Leave type</option>
                {types.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
              <div />
              <label className="text-xs text-ink-muted">
                From
                <input
                  type="date"
                  className={`${field} mt-1 w-full`}
                  value={form.fromDate}
                  onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
                  required
                />
              </label>
              <label className="text-xs text-ink-muted">
                To
                <input
                  type="date"
                  className={`${field} mt-1 w-full`}
                  value={form.toDate}
                  onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
                  required
                />
              </label>
              <div className="flex items-end gap-3 text-xs text-ink-muted">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.halfDayStart}
                    onChange={(e) => setForm((f) => ({ ...f, halfDayStart: e.target.checked }))}
                  />
                  Half day start
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={form.halfDayEnd}
                    onChange={(e) => setForm((f) => ({ ...f, halfDayEnd: e.target.checked }))}
                  />
                  Half day end
                </label>
              </div>
              <input
                className={`${field} sm:col-span-3`}
                placeholder="Reason (optional)"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
              <button className={`${primary} sm:col-span-3`} disabled={busy} type="submit">
                Submit
              </button>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>Type</th>
                  <th className={th}>From</th>
                  <th className={th}>To</th>
                  <th className={th}>Days</th>
                  <th className={th}>Reason</th>
                  <th className={th}>Status</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loading && requests.length === 0 && (
                  <tr>
                    <td className={td} colSpan={8}>
                      No leave requests.
                    </td>
                  </tr>
                )}
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-line-soft/60">
                    <td className={td}>{r.employeeId}</td>
                    <td className={td}>{r.leaveType.code}</td>
                    <td className={td}>{day(r.fromDate)}</td>
                    <td className={td}>{day(r.toDate)}</td>
                    <td className={td}>{r.days}</td>
                    <td className={td}>{r.reason ?? "—"}</td>
                    <td className={td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className={`${td} space-x-2`}>
                      {r.status === "PENDING" && can("leave.approve") && (
                        <>
                          <button
                            className="text-xs font-semibold text-emerald-700 hover:underline"
                            disabled={busy}
                            onClick={() => act(() => leaveService.approve(r.id), "Approved")}
                          >
                            Approve
                          </button>
                          <button
                            className="text-xs font-semibold text-rose-700 hover:underline"
                            disabled={busy}
                            onClick={() => act(() => leaveService.reject(r.id), "Rejected")}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(r.status === "PENDING" || r.status === "APPROVED") &&
                        can("leave.approve") && (
                          <button
                            className="text-xs font-semibold text-ink-muted hover:underline"
                            disabled={busy}
                            onClick={() => act(() => leaveService.cancel(r.id), "Cancelled")}
                          >
                            Cancel
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "calendar" && (
        <Card
          title="Who is off"
          actions={
            <select className={field} value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Employee</th>
                  <th className={th}>Department</th>
                  <th className={th}>Type</th>
                  <th className={th}>From</th>
                  <th className={th}>To</th>
                  <th className={th}>Days</th>
                </tr>
              </thead>
              <tbody>
                {!loading && calendar.length === 0 && (
                  <tr>
                    <td className={td} colSpan={6}>
                      Nobody is off this month.
                    </td>
                  </tr>
                )}
                {calendar.map((c) => (
                  <tr key={c.requestId} className="border-b border-line-soft/60">
                    <td className={td}>
                      {c.employeeName} ({c.employeeCode})
                    </td>
                    <td className={td}>{c.departmentName ?? "—"}</td>
                    <td className={td}>{c.leaveTypeCode}</td>
                    <td className={td}>{day(c.fromDate)}</td>
                    <td className={td}>{day(c.toDate)}</td>
                    <td className={td}>{c.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default LeaveHrPage;
