import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { CalendarDays, Plus, Umbrella, X } from "lucide-react";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type ChipTone,
} from "../../../components/ui/v2";
import { EmployeePicker } from "../../../components/common/EmployeePicker";
import { usePermission } from "../../../hooks/usePermission";
import { labourService, type LeaveTypeRow } from "../../../services/labourService";
import {
  leaveService,
  type CalendarRow,
  type LeaveRequestRow,
  type LeaveRequestStatus,
} from "../../../services/leaveService";
import {
  Avatar,
  Card,
  PageShell,
  TableWrap,
  linkBtn,
  day,
  field,
  message,
  monthOptions,
  primary,
  td,
  th,
} from "../../payroll/components/peopleUi";

/**
 * Leave requests, approval and the calendar (P2-09) — the manager's view of what
 * `labourService` accrues and `leaveService` moves against it.
 */
type Tab = "requests" | "calendar";
const STATUS_TONE: Record<LeaveRequestStatus, ChipTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "muted",
};
const STATUS_LABEL: Record<LeaveRequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const daysInMonth = (month: string): number => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

/** One row per employee, one column per day of the month — built client-side from the flat list
 *  the calendar endpoint already returns (P2-15); no backend change since a day-by-day grid is
 *  cheap to fold from a month's worth of approved requests. */
interface CalendarGridRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  departmentName: string | null;
  cells: (string | null)[];
}

const buildCalendarGrid = (rows: CalendarRow[], month: string): CalendarGridRow[] => {
  const totalDays = daysInMonth(month);
  const byEmployee = new Map<string, CalendarGridRow>();
  for (const r of rows) {
    let grid = byEmployee.get(r.employeeId);
    if (!grid) {
      grid = {
        employeeId: r.employeeId,
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        departmentName: r.departmentName,
        cells: new Array(totalDays).fill(null),
      };
      byEmployee.set(r.employeeId, grid);
    }
    const from = new Date(`${r.fromDate}T00:00:00Z`).getTime();
    const to = new Date(`${r.toDate}T00:00:00Z`).getTime();
    for (let d = 1; d <= totalDays; d++) {
      const asDate = new Date(`${month}-${String(d).padStart(2, "0")}T00:00:00Z`).getTime();
      if (asDate >= from && asDate <= to) grid.cells[d - 1] = r.leaveTypeCode;
    }
  }
  return Array.from(byEmployee.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );
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
  const calendarGrid = useMemo(() => buildCalendarGrid(calendar, month), [calendar, month]);

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
    if (!form.employeeId.trim()) {
      toast.error("Pick an employee first");
      return;
    }
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
    <PageShell className="space-y-5">
      <PageHeader
        title="Leave"
        icon={<Umbrella size={20} />}
        subtitle="Requests waiting on a decision, and who is off on the calendar."
        primaryAction={
          tab === "requests" && can("leave.request") ? (
            <ActionPill
              icon={showForm ? <X size={17} /> : <Plus size={17} />}
              variant={showForm ? "secondary" : "cta"}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Close" : "Apply Leave"}
            </ActionPill>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ChipTabs
            ariaLabel="Leave view"
            value={tab}
            onChange={(k) => setTab(k as Tab)}
            items={[
              { key: "requests", label: "Requests" },
              { key: "calendar", label: "Calendar", icon: <CalendarDays size={14} /> },
            ]}
          />
          {tab === "requests" && (
            <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
              {(["", "PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const).map((st) => (
                <Chip
                  key={st || "all"}
                  selected={status === st}
                  onClick={() => setStatus(st)}
                  tone={st ? STATUS_TONE[st] : "default"}
                >
                  {st ? STATUS_LABEL[st] : "All"}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </PageHeader>

      {tab === "requests" && (
        <Card
          title="Leave requests"
          subtitle={`${requests.length} ${requests.length === 1 ? "request" : "requests"}`}
        >
          {showForm && (
            <form
              onSubmit={submitRequest}
              className="mb-5 grid grid-cols-1 gap-3 rounded-[14px] bg-card-2 p-4 sm:grid-cols-3"
            >
              <EmployeePicker
                value={form.employeeId}
                onChange={(employeeId) => setForm((f) => ({ ...f, employeeId }))}
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
              <label className="sl-label flex-col !items-start">
                From
                <input
                  type="date"
                  className={`${field} !w-full`}
                  value={form.fromDate}
                  onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
                  required
                />
              </label>
              <label className="sl-label flex-col !items-start">
                To
                <input
                  type="date"
                  className={`${field} !w-full`}
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
              <div className="flex justify-end sm:col-span-3">
                <button className={primary} disabled={busy} type="submit">
                  Submit
                </button>
              </div>
            </form>
          )}

          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
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
                {loading && (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <SkeletonRows rows={4} columns={6} header={false} />
                    </td>
                  </tr>
                )}
                {!loading && requests.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState
                        compact
                        icon={<Umbrella size={22} strokeWidth={1.75} />}
                        title={status ? "No requests with this status" : "No leave requests."}
                      />
                    </td>
                  </tr>
                )}
                {requests.map((r) => (
                  <tr key={r.id} className="sl-row-hover border-t border-line-soft">
                    <td className={td}>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={r.employee.fullName} size={32} />
                        <span className="min-w-0">
                          <span className="block font-semibold">{r.employee.fullName}</span>
                          <span className="block text-[12px] text-ink-subtle">
                            {r.employee.empCode}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={td}>
                      <Chip size="sm">{r.leaveType.code}</Chip>
                    </td>
                    <td className={td}>{day(r.fromDate)}</td>
                    <td className={td}>{day(r.toDate)}</td>
                    <td className={`${td} tabular-nums`}>{r.days}</td>
                    <td className={td}>{r.reason ?? "—"}</td>
                    <td className={td}>
                      <Chip size="sm" tone={STATUS_TONE[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Chip>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {r.status === "PENDING" && can("leave.approve") && (
                        <>
                          <button
                            className={linkBtn}
                            disabled={busy}
                            onClick={() => act(() => leaveService.approve(r.id), "Approved")}
                          >
                            Approve
                          </button>
                          <button
                            className={linkBtn}
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
                            className={linkBtn}
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
          </TableWrap>
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
          {!loading && calendarGrid.length === 0 && (
            <EmptyState
              compact
              icon={<CalendarDays size={22} strokeWidth={1.75} />}
              title="Nobody is off this month."
            />
          )}
          {calendarGrid.length > 0 && (
            <div className="overflow-x-auto rounded-[14px] border border-line-soft">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={`${th} sticky left-0 z-10`}>Employee</th>
                    {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map((d) => (
                      <th key={d} className={`${th} text-center`}>
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendarGrid.map((row) => (
                    <tr key={row.employeeId} className="border-t border-line-soft">
                      <td className={`${td} sticky left-0 bg-card whitespace-nowrap`}>
                        {row.employeeName} ({row.employeeCode})
                        {row.departmentName && (
                          <div className="text-xs text-ink-muted">{row.departmentName}</div>
                        )}
                      </td>
                      {row.cells.map((c, i) => (
                        <td
                          key={i}
                          className={`${td} text-center ${c ? "bg-nav-active font-semibold text-nav-active-fg" : ""}`}
                        >
                          {c ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
};

export default LeaveHrPage;
