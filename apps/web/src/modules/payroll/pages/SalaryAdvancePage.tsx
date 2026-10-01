import React, { useEffect, useState, useCallback } from "react";
import { Wallet, Plus, Trash2, X, Loader2 } from "lucide-react";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatTile,
  type ChipTone,
} from "../../../components/ui/v2";
import {
  Avatar,
  Notice,
  PageShell,
  formatDay,
  formatINR,
  formatINRCompact,
  errorMessage,
  num,
  td,
  th,
} from "../components/peopleUi";
import { toast } from "react-toastify";
import { payrollService } from "../../../services/payrollService";
import type { ApiSalaryAdvance, ApiEmployeePayroll } from "../../../services/payrollService";
import { usePermission } from "../../../hooks/usePermission";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtRs = (n: number) => formatINR(n);
const fmtDate = (s: string) => formatDay(s);

const STATUS_TONE: Record<string, ChipTone> = {
  PENDING: "warning",
  PARTIAL: "info",
  CLEARED: "success",
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PARTIAL: "Partly recovered",
  CLEARED: "Cleared",
};
type StatusFilter = "ALL" | "PENDING" | "PARTIAL" | "CLEARED";

// ─── Add-Advance slide-in panel ────────────────────────────────────────────────
interface AddPanelProps {
  employees: ApiEmployeePayroll[];
  onClose: () => void;
  onSaved: () => void;
}

const AddPanel: React.FC<AddPanelProps> = ({ employees, onClose, onSaved }) => {
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !amount || !date) {
      toast.error("Employee, amount and date are required.");
      return;
    }
    try {
      setSaving(true);
      await payrollService.createAdvance({
        employeeId: Number(employeeId),
        amount: Number(amount),
        disbursedDate: date,
        reason: reason.trim() || undefined,
      });
      toast.success("Salary advance recorded.");
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Failed to save advance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-xs transition-opacity" onClick={onClose} />
      {/* panel */}
      <div className="sl-tile relative z-10 flex h-full w-full max-w-md flex-col !rounded-r-none">
        <div className="flex items-center justify-between border-b border-line-soft px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-chip text-accent">
              <Wallet size={18} aria-hidden="true" />
            </span>
            <h2 className="sl-h2 m-0">Add Salary Advance</h2>
          </div>
          <button onClick={onClose} className="sl-icon-btn sl-icon-btn-md" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* Employee */}
          <div>
            <label className="sl-label">
              Employee <span className="sl-required">*</span>
            </label>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="sl-input h-11"
              required
            >
              <option value="">Select employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.empCode} – {emp.fullName}
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="sl-label">
              Amount (₹) <span className="sl-required">*</span>
            </label>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="sl-input h-11"
              required
            />
          </div>

          {/* Date */}
          <div>
            <label className="sl-label">
              Disbursed Date <span className="sl-required">*</span>
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="sl-input h-11"
              required
            />
          </div>

          {/* Reason */}
          <div>
            <label className="sl-label">
              Reason <span className="text-ink-subtle">(optional)</span>
            </label>
            <input
              type="text"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Medical emergency"
              className="sl-input h-11"
            />
          </div>
        </form>

        <div className="flex justify-end gap-3 border-t border-line-soft px-6 py-4">
          <button type="button" onClick={onClose} className="sl-btn sl-pill-md">
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className="sl-cta sl-pill-md">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            {saving ? "Saving…" : "Save Advance"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
const SalaryAdvancePage: React.FC = () => {
  const { can } = usePermission();
  const canCreateAdvance = can("payroll-advance.create");
  const canDeleteAdvance = can("payroll-advance.delete");

  const [advances, setAdvances] = useState<ApiSalaryAdvance[]>([]);
  const [employees, setEmployees] = useState<ApiEmployeePayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("ALL");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [adv, emps] = await Promise.all([
        payrollService.listAdvances(),
        payrollService.listEmployees(),
      ]);
      setAdvances(adv);
      setEmployees(emps);
    } catch (e: any) {
      setError(errorMessage(e, "Failed to load data."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      setDeleting(true);
      await payrollService.deleteAdvance(deleteId);
      toast.success("Advance deleted.");
      setDeleteId(null);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to delete advance.");
    } finally {
      setDeleting(false);
    }
  };

  const totalGiven = advances.reduce((sum, a) => sum + Number(a.amount), 0);
  const totalRecovered = advances.reduce((sum, a) => sum + Number(a.recoveredAmount), 0);
  const openCount = advances.filter((a) => a.status !== "CLEARED").length;
  const shown = filter === "ALL" ? advances : advances.filter((a) => a.status === filter);
  const countOf = (st: StatusFilter) =>
    st === "ALL" ? advances.length : advances.filter((a) => a.status === st).length;

  return (
    <PageShell>
      <PageHeader
        title="Salary advances"
        icon={<Wallet size={20} />}
        breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Salary advances" }]}
        subtitle="Record and track advances given to employees; recoveries come off the next payroll runs."
        primaryAction={
          canCreateAdvance ? (
            <ActionPill icon={<Plus size={17} />} onClick={() => setShowPanel(true)}>
              New Advance
            </ActionPill>
          ) : undefined
        }
      />

      {error && (
        <Notice
          tone="danger"
          title="Advances could not be loaded"
          action={
            <ActionPill variant="secondary" size="sm" onClick={load}>
              Retry
            </ActionPill>
          }
        >
          {error}
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Advanced"
          value={formatINRCompact(totalGiven)}
          loading={loading}
          hint={`${advances.length} advances`}
        />
        <StatTile label="Recovered" value={formatINRCompact(totalRecovered)} loading={loading} />
        <StatTile
          label="Outstanding"
          value={formatINRCompact(totalGiven - totalRecovered)}
          loading={loading}
          hint={`${openCount} still open`}
        />
      </div>

      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {(["ALL", "PENDING", "PARTIAL", "CLEARED"] as StatusFilter[]).map((st) => (
          <Chip
            key={st}
            size="lg"
            selected={filter === st}
            onClick={() => setFilter(st)}
            count={countOf(st)}
          >
            {st === "ALL" ? "All" : STATUS_LABEL[st]}
          </Chip>
        ))}
      </div>

      <div className="sl-tile overflow-hidden">
        {loading ? (
          <SkeletonRows rows={5} columns={7} label="Loading advances" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Wallet size={28} strokeWidth={1.75} />}
            title={
              advances.length === 0
                ? "No salary advances recorded yet."
                : "No advances with this status"
            }
            action={
              advances.length === 0 && canCreateAdvance ? (
                <ActionPill
                  variant="secondary"
                  icon={<Plus size={16} />}
                  onClick={() => setShowPanel(true)}
                >
                  Add the first advance
                </ActionPill>
              ) : advances.length > 0 ? (
                <ActionPill variant="secondary" onClick={() => setFilter("ALL")}>
                  Clear filter
                </ActionPill>
              ) : null
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Employee</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Date</th>
                  <th className={th}>Reason</th>
                  <th className={`${th} text-right`}>Recovered</th>
                  <th className={`${th} text-right`}>Pending</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((adv) => {
                  const pending = Number(adv.amount) - Number(adv.recoveredAmount);
                  const canDelete =
                    canDeleteAdvance &&
                    adv.status === "PENDING" &&
                    Number(adv.recoveredAmount) === 0;
                  return (
                    <tr key={adv.id} className="sl-row-hover border-t border-line-soft">
                      <td className={td}>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={adv.employee.fullName} size={32} />
                          <span>
                            <span className="block font-semibold">{adv.employee.fullName}</span>
                            <span className="block text-[12px] text-ink-subtle">
                              {adv.employee.empCode}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className={`${td} ${num} font-semibold`}>{fmtRs(Number(adv.amount))}</td>
                      <td className={`${td} whitespace-nowrap text-ink-muted`}>
                        {fmtDate(adv.disbursedDate)}
                      </td>
                      <td className={`${td} max-w-[200px] truncate text-ink-muted`}>
                        {adv.reason ?? <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className={`${td} ${num} text-ink-muted`}>
                        {fmtRs(Number(adv.recoveredAmount))}
                      </td>
                      <td className={`${td} ${num} font-semibold`}>{fmtRs(pending)}</td>
                      <td className={td}>
                        <Chip size="sm" tone={STATUS_TONE[adv.status] ?? "muted"}>
                          {STATUS_LABEL[adv.status] ?? adv.status}
                        </Chip>
                      </td>
                      <td className={`${td} text-right`}>
                        {canDelete ? (
                          <button
                            onClick={() => setDeleteId(adv.id)}
                            className="sl-icon-btn sl-icon-btn-md sl-icon-btn-hover-danger"
                            title="Delete advance"
                            aria-label={`Delete advance for ${adv.employee.fullName}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : (
                          <span className="text-xs text-ink-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add panel ── */}
      {showPanel && (
        <AddPanel
          employees={employees}
          onClose={() => setShowPanel(false)}
          onSaved={() => {
            setShowPanel(false);
            load();
          }}
        />
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteId != null && (
        <div className="sl-backdrop fixed inset-0 z-50 flex items-center justify-center">
          <div role="dialog" aria-modal="true" className="sl-dialog mx-4 w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] flex items-center justify-center">
                <Trash2 size={18} className="text-[color:var(--color-danger)]" />
              </div>
              <h3 className="text-base font-bold text-ink">Delete Advance?</h3>
            </div>
            <p className="text-sm text-ink-muted mb-5">
              This action cannot be undone. The advance will be permanently removed.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                disabled={deleting}
                className="sl-btn sl-pill-md"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="sl-btn-danger sl-pill-md"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default SalaryAdvancePage;
