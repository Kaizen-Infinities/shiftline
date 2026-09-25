import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { labourService, type LeaveTypeRow } from "../../../services/labourService";
import {
  leaveService,
  type LeaveRequestStatus,
  type MyLeave,
} from "../../../services/leaveService";
import {
  Card,
  day,
  field,
  message,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/** Self-service: the calling user's own leave balances and requests (P2-09). */
const STATUS_STYLE: Record<LeaveRequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-700",
  CANCELLED: "bg-slate-100 text-slate-700",
};

const emptyForm = {
  leaveTypeCode: "",
  fromDate: "",
  toDate: "",
  halfDayStart: false,
  halfDayEnd: false,
  reason: "",
};

const MyLeavePage: React.FC = () => {
  const [data, setData] = useState<MyLeave | null>(null);
  const [types, setTypes] = useState<LeaveTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [me, leaveTypes] = await Promise.all([leaveService.me(), labourService.leaveTypes()]);
      setData(me);
      setTypes(leaveTypes);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await leaveService.createRequest({
        employeeId: data!.employee!.id,
        leaveTypeCode: form.leaveTypeCode,
        fromDate: form.fromDate,
        toDate: form.toDate,
        halfDayStart: form.halfDayStart,
        halfDayEnd: form.halfDayEnd,
        reason: form.reason.trim() || undefined,
      });
      toast.success("Leave requested");
      setForm(emptyForm);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await leaveService.cancel(id);
      toast.success("Cancelled");
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="p-4 text-sm text-ink-muted">Loading…</div>;
  }

  if (data && !data.linked) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-xl font-semibold text-ink">My Leave</h1>
        <Card title="No employee record">
          <p className="text-sm text-ink-muted">
            Your account is not linked to an employee record, so there is nothing to show here. Ask
            an administrator to link your user to your employee record.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">My Leave</h1>
        <p className="text-sm text-ink-muted">{data?.employee?.fullName}</p>
      </header>

      <Card title="Balances">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-soft">
                <th className={th}>Year</th>
                <th className={th}>Type</th>
                <th className={th}>Opening</th>
                <th className={th}>Accrued</th>
                <th className={th}>Taken</th>
                <th className={th}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {(data?.balances ?? []).length === 0 && (
                <tr>
                  <td className={td} colSpan={6}>
                    No balances yet.
                  </td>
                </tr>
              )}
              {data?.balances.map((b) => (
                <tr key={b.id} className="border-b border-line-soft/60">
                  <td className={td}>{b.fyCode}</td>
                  <td className={td}>
                    {b.leaveType.code} — {b.leaveType.name}
                  </td>
                  <td className={td}>{b.opening}</td>
                  <td className={td}>{b.accrued}</td>
                  <td className={td}>{b.taken}</td>
                  <td className={`${td} font-semibold`}>{b.closing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Apply for leave">
        <form onSubmit={submit} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
          <div className="flex items-center gap-3 text-xs text-ink-muted sm:col-span-3">
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
            Submit request
          </button>
        </form>
      </Card>

      <Card title="My requests">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-soft">
                <th className={th}>Type</th>
                <th className={th}>From</th>
                <th className={th}>To</th>
                <th className={th}>Days</th>
                <th className={th}>Status</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.requests ?? []).length === 0 && (
                <tr>
                  <td className={td} colSpan={6}>
                    No requests yet.
                  </td>
                </tr>
              )}
              {data?.requests.map((r) => (
                <tr key={r.id} className="border-b border-line-soft/60">
                  <td className={td}>{r.leaveType.code}</td>
                  <td className={td}>{day(r.fromDate)}</td>
                  <td className={td}>{day(r.toDate)}</td>
                  <td className={td}>{r.days}</td>
                  <td className={td}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className={td}>
                    {(r.status === "PENDING" || r.status === "APPROVED") && (
                      <button className={secondary} disabled={busy} onClick={() => cancel(r.id)}>
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
    </div>
  );
};

export default MyLeavePage;
