import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { advanceService, type AdvanceRow } from "../../../services/advanceService";
import { customerService } from "../../../services/customerService";
import {
  Card,
  danger,
  day,
  field,
  message,
  money,
  primary,
  secondary,
  success,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Advances received (P1-14).
 *
 * The amount is what the customer actually paid, tax included — an advance of ₹11,800 at 18% is
 * ₹10,000 plus ₹1,800 — so the form shows the split as it is typed. That is the number people
 * get wrong, and seeing it before saving is the point of the screen.
 */
const STATUS_STYLE: Record<AdvanceRow["status"], string> = {
  OPEN: "bg-amber-100 text-amber-800",
  PART_ADJUSTED: "bg-sky-100 text-sky-800",
  CLOSED: "bg-slate-100 text-slate-700",
};
const STATUS_LABEL: Record<AdvanceRow["status"], string> = {
  OPEN: "Unused",
  PART_ADJUSTED: "Part used",
  CLOSED: "Closed",
};
const today = () => new Date().toISOString().slice(0, 10);

const AdvancesPage: React.FC = () => {
  const { can } = usePermission();
  const [rows, setRows] = useState<AdvanceRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; firmName: string }[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [refunding, setRefunding] = useState<AdvanceRow | null>(null);
  const [form, setForm] = useState({
    customerId: "",
    receiptDate: today(),
    amount: "",
    gstRate: "18",
    paymentMethod: "Bank Transfer",
    referenceNumber: "",
    narration: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await advanceService.list(status ? { status } : {}));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    customerService
      .fetchAll({ limit: 500, status: "Active" })
      .then((res) => setCustomers(res.customers.map((c) => ({ id: c.id, firmName: c.firmName }))))
      .catch(() => setCustomers([]));
  }, []);

  // The tax lives inside the amount, so show the split while it is being typed.
  const gross = Number(form.amount) || 0;
  const rate = Number(form.gstRate) || 0;
  const taxable = rate > 0 ? Math.round((gross / (1 + rate / 100)) * 100) / 100 : gross;
  const tax = Math.round((gross - taxable) * 100) / 100;

  const save = async () => {
    if (!form.customerId || !(gross > 0)) {
      toast.error("Pick a customer and an amount");
      return;
    }
    setBusy(true);
    try {
      await advanceService.create({
        customerId: form.customerId,
        receiptDate: form.receiptDate,
        amount: gross,
        gstRate: rate,
        paymentMethod: form.paymentMethod,
        referenceNumber: form.referenceNumber || null,
        narration: form.narration || null,
      });
      toast.success("Advance recorded");
      setOpen(false);
      setForm({ ...form, amount: "", referenceNumber: "", narration: "" });
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const refund = async (row: AdvanceRow, amount: number, reason: string) => {
    setBusy(true);
    try {
      await advanceService.refund(row.id, { amount, reason });
      toast.success("Refunded");
      setRefunding(null);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Advances Received</h1>
          <p className="text-sm text-ink-muted">
            Money taken before the invoice. The tax on it is due the day it arrives.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
          >
            <option value="">All</option>
            <option value="OPEN">Unused</option>
            <option value="PART_ADJUSTED">Part used</option>
            <option value="CLOSED">Closed</option>
          </select>
          {can("advances.create") && (
            <button className={primary} onClick={() => setOpen((o) => !o)}>
              {open ? "Close" : "Record an advance"}
            </button>
          )}
        </div>
      </header>

      {open && (
        <Card title="New advance">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="text-ink-muted">Customer</span>
              <select
                className={`${field} mt-1 w-full`}
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">Choose…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firmName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">Received on</span>
              <input
                type="date"
                className={`${field} mt-1 w-full`}
                value={form.receiptDate}
                onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">Amount received (tax included)</span>
              <input
                type="number"
                className={`${field} mt-1 w-full`}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">GST rate %</span>
              <input
                type="number"
                className={`${field} mt-1 w-full`}
                value={form.gstRate}
                onChange={(e) => setForm({ ...form, gstRate: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">Paid by</span>
              <input
                className={`${field} mt-1 w-full`}
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">Reference</span>
              <input
                className={`${field} mt-1 w-full`}
                value={form.referenceNumber}
                onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
              />
            </label>
          </div>
          <div className="mt-3 rounded-lg border border-line-soft bg-card-2 p-3 text-sm">
            Of {money(gross)} received, <strong>{money(taxable)}</strong> is the value of the supply
            and <strong>{money(tax)}</strong> is GST already due.
          </div>
          <button className={`${primary} mt-3`} onClick={() => void save()} disabled={busy}>
            Save
          </button>
        </Card>
      )}

      <Card title="Advances">
        {loading && <p className="text-sm text-ink-muted">Loading…</p>}
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Receipt</th>
                <th className={th}>Customer</th>
                <th className={th}>Date</th>
                <th className={`${th} text-right`}>Received</th>
                <th className={`${th} text-right`}>Tax in it</th>
                <th className={`${th} text-right`}>Left</th>
                <th className={th}>Status</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className={td}>{r.receiptNo}</td>
                  <td className={td}>{r.customer?.firmName ?? "—"}</td>
                  <td className={td}>{day(r.receiptDate)}</td>
                  <td className={`${td} text-right`}>{money(r.amount)}</td>
                  <td className={`${td} text-right`}>
                    {money(Number(r.igst) + Number(r.cgst) + Number(r.sgst))}
                  </td>
                  <td className={`${td} text-right font-semibold`}>{money(r.balance)}</td>
                  <td className={td}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className={`${td} text-right`}>
                    {can("advances.refund") && Number(r.balance) > 0 && (
                      <button className={danger} onClick={() => setRefunding(r)}>
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={8}>
                    No advances.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {refunding && (
        <RefundDialog
          row={refunding}
          busy={busy}
          onCancel={() => setRefunding(null)}
          onConfirm={(amount, reason) => refund(refunding, amount, reason)}
        />
      )}
    </div>
  );
};

const RefundDialog: React.FC<{
  row: AdvanceRow;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (amount: number, reason: string) => void;
}> = ({ row, busy, onCancel, onConfirm }) => {
  const [amount, setAmount] = useState(String(row.balance));
  const [reason, setReason] = useState("");
  return (
    <Card title={`Refund ${row.receiptNo}`}>
      <p className="mb-2 text-sm text-ink-muted">
        {money(row.balance)} is left. The GST paid on whatever is refunded comes back too.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-ink-muted">Amount</span>
          <input
            type="number"
            className={`${field} mt-1`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="text-ink-muted">Why</span>
          <input
            className={`${field} mt-1 w-full`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Order cancelled"
          />
        </label>
        <button
          className={success}
          disabled={busy}
          onClick={() => onConfirm(Number(amount), reason)}
        >
          Refund
        </button>
        <button className={secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Card>
  );
};

export default AdvancesPage;
