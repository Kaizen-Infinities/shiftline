import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { labourService, type LeaveTypeRow } from "../../../services/labourService";
import {
  leaveService,
  type LeaveRequestStatus,
  type MyLeave,
} from "../../../services/leaveService";
import { Send, Umbrella } from "lucide-react";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonTile,
  StatTile,
  type ChipTone,
} from "../../../components/ui/v2";
import {
  Card,
  PageShell,
  TableWrap,
  day,
  field,
  linkBtn,
  message,
  td,
  th,
} from "../../payroll/components/peopleUi";

/** Self-service: the calling user's own leave balances and requests (P2-09). */
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
    return (
      <PageShell>
        <PageHeader title="My Leave" subtitle="Loading…" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <StatTile key={i} label=" " value="" loading />
          ))}
        </div>
        <SkeletonTile lines={4} />
      </PageShell>
    );
  }

  if (data && !data.linked) {
    return (
      <PageShell>
        <PageHeader title="My Leave" icon={<Umbrella size={20} />} />
        <div className="sl-tile">
          <EmptyState
            icon={<Umbrella size={28} strokeWidth={1.75} />}
            title="No employee record"
            description="Your account is not linked to an employee record, so there is nothing to show here. Ask an administrator to link your user to your employee record."
          />
        </div>
      </PageShell>
    );
  }

  const balances = data?.balances ?? [];
  const requests = data?.requests ?? [];
  const pending = requests.filter((r) => r.status === "PENDING").length;

  return (
    <PageShell>
      <PageHeader
        title="My Leave"
        icon={<Umbrella size={20} />}
        subtitle={data?.employee?.fullName}
        meta={
          pending > 0 ? (
            <Chip tone="warning" size="sm">
              {pending} pending
            </Chip>
          ) : undefined
        }
      />

      <section aria-labelledby="balances-heading">
        <h2 id="balances-heading" className="sl-section-label m-0 mb-2">
          Balances
        </h2>
        {balances.length === 0 ? (
          <div className="sl-tile">
            <EmptyState compact title="No balances yet." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((b) => (
              <StatTile
                key={b.id}
                label={`${b.leaveType.name} · ${b.fyCode}`}
                value={
                  <>
                    {b.closing}
                    <span className="ml-1 text-base font-semibold text-ink-subtle">days</span>
                  </>
                }
                delta={b.leaveType.code}
                deltaTone="default"
                hint={`Opening ${b.opening} · accrued ${b.accrued} · taken ${b.taken}`}
              />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title="Apply for leave" className="lg:col-span-2">
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="sl-label">Leave type</span>
              <select
                className={`${field} !w-full`}
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
            </label>
            <label className="flex flex-col gap-1">
              <span className="sl-label">From</span>
              <input
                type="date"
                className={`${field} !w-full`}
                value={form.fromDate}
                onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="sl-label">To</span>
              <input
                type="date"
                className={`${field} !w-full`}
                value={form.toDate}
                onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
                required
              />
            </label>
            <div className="flex flex-wrap items-center gap-4 text-sm text-ink-muted sm:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="sl-check"
                  checked={form.halfDayStart}
                  onChange={(e) => setForm((f) => ({ ...f, halfDayStart: e.target.checked }))}
                />
                Half day start
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="sl-check"
                  checked={form.halfDayEnd}
                  onChange={(e) => setForm((f) => ({ ...f, halfDayEnd: e.target.checked }))}
                />
                Half day end
              </label>
            </div>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="sl-label">Reason (optional)</span>
              <input
                className={`${field} !w-full`}
                placeholder="Reason (optional)"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </label>
            <div className="sm:col-span-2">
              <ActionPill type="submit" loading={busy} icon={<Send size={16} />} fullWidth>
                Submit request
              </ActionPill>
            </div>
          </form>
        </Card>

        <Card title="My requests" className="lg:col-span-3">
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={th}>Type</th>
                  <th className={th}>From</th>
                  <th className={th}>To</th>
                  <th className={th}>Days</th>
                  <th className={th}>Status</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState compact title="No requests yet." />
                    </td>
                  </tr>
                )}
                {requests.map((r) => (
                  <tr key={r.id} className="sl-row-hover border-t border-line-soft">
                    <td className={td}>
                      <Chip size="sm">{r.leaveType.code}</Chip>
                    </td>
                    <td className={td}>{day(r.fromDate)}</td>
                    <td className={td}>{day(r.toDate)}</td>
                    <td className={`${td} tabular-nums`}>{r.days}</td>
                    <td className={td}>
                      <Chip size="sm" tone={STATUS_TONE[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Chip>
                    </td>
                    <td className={td}>
                      {(r.status === "PENDING" || r.status === "APPROVED") && (
                        <button className={linkBtn} disabled={busy} onClick={() => cancel(r.id)}>
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
      </div>
    </PageShell>
  );
};

export default MyLeavePage;
