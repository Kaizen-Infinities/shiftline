import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { EmployeePicker } from "../../../components/common/EmployeePicker";
import { usePermission } from "../../../hooks/usePermission";
import {
  finesService,
  type FineKind,
  type FineRow,
  type FineStatus,
} from "../../../services/finesService";
import {
  Card,
  day,
  field,
  message,
  money,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Fines and deductions (P2-13): create, the employee's show-cause notice, approval against the
 * 3% ceiling, and the recovery status left by a payroll run.
 */
const STATUS_STYLE: Record<FineStatus, string> = {
  PENDING:
    "bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] text-[color:var(--color-warning)]",
  APPROVED:
    "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[color:var(--color-success)]",
  CANCELLED: "bg-card-2 text-ink",
};

const emptyForm = {
  employeeId: "",
  kind: "FINE" as FineKind,
  occurredOn: "",
  cause: "",
  amount: "",
  wagePeriod: "",
};

const FinesPage: React.FC = () => {
  const { can } = usePermission();
  const [kind, setKind] = useState<FineKind | "">("");
  const [status, setStatus] = useState<FineStatus | "">("");
  const [rows, setRows] = useState<FineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [showCauseId, setShowCauseId] = useState<string | null>(null);
  const [showCauseRemarks, setShowCauseRemarks] = useState("");
  const [showCauseDate, setShowCauseDate] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    occurredOn: "",
    cause: "",
    amount: "",
    wagePeriod: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await finesService.list({
          ...(kind ? { kind } : {}),
          ...(status ? { status } : {}),
        })
      );
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [kind, status]);
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

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.employeeId.trim()) {
      toast.error("Pick an employee first");
      return;
    }
    await act(async () => {
      await finesService.create({
        employeeId: form.employeeId.trim(),
        kind: form.kind,
        occurredOn: form.occurredOn,
        cause: form.cause.trim(),
        amount: Number(form.amount),
        wagePeriod: form.wagePeriod.trim(),
      });
      setForm(emptyForm);
      setShowForm(false);
    }, "Recorded");
  };

  const submitShowCause = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showCauseId) return;
    await act(async () => {
      await finesService.showCause(showCauseId, {
        showCauseDate,
        showCauseRemarks: showCauseRemarks.trim(),
      });
      setShowCauseId(null);
      setShowCauseRemarks("");
      setShowCauseDate("");
    }, "Show-cause recorded");
  };

  const submitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelId) return;
    await act(async () => {
      await finesService.cancel(cancelId, cancelReason.trim());
      setCancelId(null);
      setCancelReason("");
    }, "Cancelled");
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    await act(async () => {
      await finesService.update(editId, {
        occurredOn: editForm.occurredOn,
        cause: editForm.cause.trim(),
        amount: Number(editForm.amount),
        wagePeriod: editForm.wagePeriod.trim(),
      });
      setEditId(null);
    }, "Updated");
  };

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">Fines and deductions</h1>
        <p className="text-sm text-ink-muted">
          Fines (Payment of Wages Act s.8) and deductions for damage or loss (s.10) — recorded,
          shown to the employee, approved, and recovered once in the payroll run for the wage
          period.
        </p>
      </header>

      <Card
        title="Entries"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={field}
              value={kind}
              onChange={(e) => setKind(e.target.value as FineKind | "")}
              aria-label="Kind"
            >
              <option value="">Fines and deductions</option>
              <option value="FINE">Fines only</option>
              <option value="DEDUCTION">Deductions only</option>
            </select>
            <select
              className={field}
              value={status}
              onChange={(e) => setStatus(e.target.value as FineStatus | "")}
              aria-label="Status"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            {can("fines.manage") && (
              <button className={primary} onClick={() => setShowForm((v) => !v)}>
                {showForm ? "Close" : "New entry"}
              </button>
            )}
          </div>
        }
      >
        {showForm && (
          <form
            onSubmit={submitCreate}
            className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft p-3 sm:grid-cols-3"
          >
            <EmployeePicker
              value={form.employeeId}
              onChange={(employeeId) => setForm((f) => ({ ...f, employeeId }))}
              required
            />
            <select
              className={field}
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as FineKind }))}
            >
              <option value="FINE">Fine</option>
              <option value="DEDUCTION">Deduction (damage/loss)</option>
            </select>
            <label className="text-xs text-ink-muted">
              Wage period
              <input
                className={`${field} mt-1 w-full`}
                placeholder="YYYY-MM"
                value={form.wagePeriod}
                onChange={(e) => setForm((f) => ({ ...f, wagePeriod: e.target.value }))}
                required
              />
            </label>
            <label className="text-xs text-ink-muted">
              Date
              <input
                type="date"
                className={`${field} mt-1 w-full`}
                value={form.occurredOn}
                onChange={(e) => setForm((f) => ({ ...f, occurredOn: e.target.value }))}
                required
              />
            </label>
            <input
              className={field}
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
            <div />
            <input
              className={`${field} sm:col-span-3`}
              placeholder="Cause / act or omission"
              value={form.cause}
              onChange={(e) => setForm((f) => ({ ...f, cause: e.target.value }))}
              required
            />
            <button className={`${primary} sm:col-span-3`} disabled={busy} type="submit">
              Record
            </button>
          </form>
        )}

        {showCauseId && (
          <form
            onSubmit={submitShowCause}
            className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft bg-card-2 p-3 sm:grid-cols-3"
          >
            <p className="text-xs text-ink-muted sm:col-span-3">
              Recording that the employee was heard before this fine is imposed.
            </p>
            <label className="text-xs text-ink-muted">
              Date heard
              <input
                type="date"
                className={`${field} mt-1 w-full`}
                value={showCauseDate}
                onChange={(e) => setShowCauseDate(e.target.value)}
                required
              />
            </label>
            <input
              className={`${field} sm:col-span-2`}
              placeholder="Remarks"
              value={showCauseRemarks}
              onChange={(e) => setShowCauseRemarks(e.target.value)}
              required
            />
            <div className="flex gap-2 sm:col-span-3">
              <button className={primary} disabled={busy} type="submit">
                Save
              </button>
              <button type="button" className={secondary} onClick={() => setShowCauseId(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {editId && (
          <form
            onSubmit={submitEdit}
            className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft bg-card-2 p-3 sm:grid-cols-3"
          >
            <p className="text-xs text-ink-muted sm:col-span-3">
              Editing a pending entry — this is refused once a show-cause is recorded or it is
              approved.
            </p>
            <label className="text-xs text-ink-muted">
              Wage period
              <input
                className={`${field} mt-1 w-full`}
                placeholder="YYYY-MM"
                value={editForm.wagePeriod}
                onChange={(e) => setEditForm((f) => ({ ...f, wagePeriod: e.target.value }))}
                required
              />
            </label>
            <label className="text-xs text-ink-muted">
              Date
              <input
                type="date"
                className={`${field} mt-1 w-full`}
                value={editForm.occurredOn}
                onChange={(e) => setEditForm((f) => ({ ...f, occurredOn: e.target.value }))}
                required
              />
            </label>
            <input
              className={field}
              type="number"
              min="0"
              step="0.01"
              placeholder="Amount"
              value={editForm.amount}
              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
            <input
              className={`${field} sm:col-span-3`}
              placeholder="Cause / act or omission"
              value={editForm.cause}
              onChange={(e) => setEditForm((f) => ({ ...f, cause: e.target.value }))}
              required
            />
            <div className="flex gap-2 sm:col-span-3">
              <button className={primary} disabled={busy} type="submit">
                Save
              </button>
              <button type="button" className={secondary} onClick={() => setEditId(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {cancelId && (
          <form
            onSubmit={submitCancel}
            className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft bg-card-2 p-3 sm:grid-cols-3"
          >
            <input
              className={`${field} sm:col-span-2`}
              placeholder="Reason for cancelling"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              required
            />
            <div className="flex gap-2">
              <button className={primary} disabled={busy} type="submit">
                Confirm cancel
              </button>
              <button type="button" className={secondary} onClick={() => setCancelId(null)}>
                Back
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-soft">
                <th className={th}>Employee</th>
                <th className={th}>Kind</th>
                <th className={th}>Date</th>
                <th className={th}>Wage period</th>
                <th className={th}>Cause</th>
                <th className={th}>Amount</th>
                <th className={th}>Shown cause</th>
                <th className={th}>Status</th>
                <th className={th}>Recovered</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td className={td} colSpan={10}>
                    No fines or deductions.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line-soft/60">
                  <td className={td}>
                    {r.employee.fullName} ({r.employee.empCode})
                  </td>
                  <td className={td}>{r.kind === "FINE" ? "Fine" : "Deduction"}</td>
                  <td className={td}>{day(r.occurredOn)}</td>
                  <td className={td}>{r.wagePeriod}</td>
                  <td className={td}>{r.cause}</td>
                  <td className={td}>{money(r.amount)}</td>
                  <td className={td}>{r.shownCauseGiven ? "Yes" : "No"}</td>
                  <td className={td}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className={td}>{r.recovered ? "Recovered" : "—"}</td>
                  <td className={`${td} space-x-2`}>
                    {r.status === "PENDING" && !r.shownCauseGiven && can("fines.manage") && (
                      <button
                        className="text-xs font-semibold text-ink hover:underline"
                        disabled={busy}
                        onClick={() => {
                          setEditId(r.id);
                          setEditForm({
                            occurredOn: r.occurredOn.slice(0, 10),
                            cause: r.cause,
                            amount: String(r.amount),
                            wagePeriod: r.wagePeriod,
                          });
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {r.status === "PENDING" &&
                      r.kind === "FINE" &&
                      !r.shownCauseGiven &&
                      can("fines.manage") && (
                        <button
                          className="text-xs font-semibold text-accent hover:underline"
                          disabled={busy}
                          onClick={() => {
                            setShowCauseId(r.id);
                            setShowCauseRemarks("");
                            setShowCauseDate("");
                          }}
                        >
                          Show-cause
                        </button>
                      )}
                    {r.status === "PENDING" && can("fines.approve") && (
                      <button
                        className="text-xs font-semibold text-[color:var(--color-success)] hover:underline"
                        disabled={busy}
                        onClick={() => act(() => finesService.approve(r.id), "Approved")}
                      >
                        Approve
                      </button>
                    )}
                    {r.status !== "CANCELLED" && !r.recovered && can("fines.manage") && (
                      <button
                        className="text-xs font-semibold text-[color:var(--color-danger)] hover:underline"
                        disabled={busy}
                        onClick={() => {
                          setCancelId(r.id);
                          setCancelReason("");
                        }}
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
    </div>
  );
};

export default FinesPage;
