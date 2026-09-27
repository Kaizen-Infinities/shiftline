import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { Gavel, Plus, X } from "lucide-react";
import { EmployeePicker } from "../../../components/common/EmployeePicker";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  type ChipTone,
} from "../../../components/ui/v2";
import { usePermission } from "../../../hooks/usePermission";
import {
  finesService,
  type FineKind,
  type FineRow,
  type FineStatus,
} from "../../../services/finesService";
import {
  Card,
  TableWrap,
  PageShell,
  linkBtn,
  num,
  day,
  field,
  message,
  money,
  primary,
  secondary,
  td,
  th,
} from "../components/peopleUi";

/**
 * Fines and deductions (P2-13): create, the employee's show-cause notice, approval against the
 * 3% ceiling, and the recovery status left by a payroll run.
 */
const STATUS_TONE: Record<FineStatus, ChipTone> = {
  PENDING: "warning",
  APPROVED: "success",
  CANCELLED: "muted",
};
const STATUS_LABEL: Record<FineStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
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
    <PageShell className="space-y-5">
      <PageHeader
        title="Fines and deductions"
        icon={<Gavel size={20} />}
        breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Fines and deductions" }]}
        subtitle="Fines (Payment of Wages Act s.8) and deductions for damage or loss (s.10) — recorded, shown to the employee, approved, and recovered once in the payroll run for the wage period."
        primaryAction={
          can("fines.manage") ? (
            <ActionPill
              icon={showForm ? <X size={17} /> : <Plus size={17} />}
              variant={showForm ? "secondary" : "cta"}
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? "Close" : "Add Fine"}
            </ActionPill>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {(["", "PENDING", "APPROVED", "CANCELLED"] as const).map((st) => (
            <Chip
              key={st || "all"}
              size="lg"
              selected={status === st}
              onClick={() => setStatus(st)}
              count={st ? rows.filter((r) => r.status === st).length || undefined : undefined}
            >
              {st ? STATUS_LABEL[st] : "All"}
            </Chip>
          ))}
        </div>
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
      </div>

      <Card title="Entries" subtitle={`${rows.length} ${rows.length === 1 ? "entry" : "entries"}`}>
        {showForm && (
          <form
            onSubmit={submitCreate}
            className="mb-5 grid grid-cols-1 gap-3 rounded-[14px] bg-card-2 p-4 sm:grid-cols-3"
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
            <label className="sl-label">
              Wage period
              <input
                className={`${field} !w-full`}
                placeholder="YYYY-MM"
                value={form.wagePeriod}
                onChange={(e) => setForm((f) => ({ ...f, wagePeriod: e.target.value }))}
                required
              />
            </label>
            <label className="sl-label">
              Date
              <input
                type="date"
                className={`${field} !w-full`}
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
            <div className="flex justify-end sm:col-span-3">
              <button className={primary} disabled={busy} type="submit">
                Record
              </button>
            </div>
          </form>
        )}

        {showCauseId && (
          <form
            onSubmit={submitShowCause}
            className="mb-5 grid grid-cols-1 gap-3 rounded-[14px] bg-card-2 p-4 sm:grid-cols-3"
          >
            <p className="text-xs text-ink-muted sm:col-span-3">
              Recording that the employee was heard before this fine is imposed.
            </p>
            <label className="sl-label">
              Date heard
              <input
                type="date"
                className={`${field} !w-full`}
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
            className="mb-5 grid grid-cols-1 gap-3 rounded-[14px] bg-card-2 p-4 sm:grid-cols-3"
          >
            <p className="text-xs text-ink-muted sm:col-span-3">
              Editing a pending entry — this is refused once a show-cause is recorded or it is
              approved.
            </p>
            <label className="sl-label">
              Wage period
              <input
                className={`${field} !w-full`}
                placeholder="YYYY-MM"
                value={editForm.wagePeriod}
                onChange={(e) => setEditForm((f) => ({ ...f, wagePeriod: e.target.value }))}
                required
              />
            </label>
            <label className="sl-label">
              Date
              <input
                type="date"
                className={`${field} !w-full`}
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
            className="mb-5 grid grid-cols-1 gap-3 rounded-[14px] bg-card-2 p-4 sm:grid-cols-3"
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

        <TableWrap>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Employee</th>
                <th className={th}>Kind</th>
                <th className={th}>Date</th>
                <th className={th}>Wage period</th>
                <th className={th}>Cause</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Shown cause</th>
                <th className={th}>Status</th>
                <th className={th}>Recovered</th>
                <th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="p-0">
                    <SkeletonRows rows={4} columns={6} header={false} />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      compact
                      icon={<Gavel size={22} strokeWidth={1.75} />}
                      title={
                        kind || status
                          ? "No entries match these filters"
                          : "No fines or deductions."
                      }
                      description="Anything recorded here is recovered once, in the payroll run for its wage period."
                    />
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="sl-row-hover border-t border-line-soft">
                  <td className={td}>
                    <span className="block font-semibold">{r.employee.fullName}</span>
                    <span className="block text-[12px] text-ink-subtle">{r.employee.empCode}</span>
                  </td>
                  <td className={td}>
                    <Chip size="sm" tone={r.kind === "FINE" ? "default" : "info"}>
                      {r.kind === "FINE" ? "Fine" : "Deduction"}
                    </Chip>
                  </td>
                  <td className={td}>{day(r.occurredOn)}</td>
                  <td className={td}>{r.wagePeriod}</td>
                  <td className={td}>{r.cause}</td>
                  <td className={`${td} ${num} font-semibold`}>{money(r.amount)}</td>
                  <td className={td}>{r.shownCauseGiven ? "Yes" : "No"}</td>
                  <td className={td}>
                    <Chip size="sm" tone={STATUS_TONE[r.status]}>
                      {STATUS_LABEL[r.status]}
                    </Chip>
                  </td>
                  <td className={td}>{r.recovered ? "Recovered" : "—"}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {r.status === "PENDING" && !r.shownCauseGiven && can("fines.manage") && (
                      <button
                        className={linkBtn}
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
                          className={linkBtn}
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
                        className={linkBtn}
                        disabled={busy}
                        onClick={() => act(() => finesService.approve(r.id), "Approved")}
                      >
                        Approve
                      </button>
                    )}
                    {r.status !== "CANCELLED" && !r.recovered && can("fines.manage") && (
                      <button
                        className={linkBtn}
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
        </TableWrap>
      </Card>
    </PageShell>
  );
};

export default FinesPage;
