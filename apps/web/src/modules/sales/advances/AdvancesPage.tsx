import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Plus, Undo2, Wallet, X } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { advanceService, type AdvanceRow } from "../../../services/advanceService";
import { customerService } from "../../../services/customerService";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  Field,
  PageHeader,
  StatTile,
  Tile,
  Toolbar,
  fieldControlClass,
  type ChipTone,
} from "../../../components/ui/v2";
import { PAGE_CLASS, errorMessage, formatDateIN, formatINR } from "../shared/tradeUi";

/**
 * Advances received (P1-14).
 *
 * The amount is what the customer actually paid, tax included — an advance of ₹11,800 at 18% is
 * ₹10,000 plus ₹1,800 — so the form shows the split as it is typed. That is the number people
 * get wrong, and seeing it before saving is the point of the screen.
 */
const STATUS_TONE: Record<AdvanceRow["status"], ChipTone> = {
  OPEN: "warning",
  PART_ADJUSTED: "info",
  CLOSED: "muted",
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
      toast.error(errorMessage(err));
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

  const totals = useMemo(() => {
    let received = 0;
    let left = 0;
    let unused = 0;
    rows.forEach((r) => {
      received += Number(r.amount) || 0;
      left += Number(r.balance) || 0;
      if (r.status !== "CLOSED") unused += 1;
    });
    return { received, left, unused };
  }, [rows]);

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
      toast.error(errorMessage(err));
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
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const canCreate = can("advances.create");
  const recordButton = canCreate ? (
    <ActionPill
      icon={open ? <X size={18} /> : <Plus size={18} />}
      variant={open ? "secondary" : "cta"}
      onClick={() => setOpen((o) => !o)}
    >
      {open ? "Close" : "Record Advance"}
    </ActionPill>
  ) : null;

  const columns: DataTableColumn<AdvanceRow>[] = [
    {
      header: "Receipt",
      render: (r) => <span className="font-semibold text-ink">{r.receiptNo}</span>,
    },
    {
      header: "Customer",
      render: (r) => <span className="font-medium text-ink">{r.customer?.firmName ?? "—"}</span>,
    },
    {
      header: "Date",
      render: (r) => (
        <span className="tabular-nums text-ink-muted">{formatDateIN(r.receiptDate)}</span>
      ),
    },
    {
      header: "Received",
      align: "right",
      render: (r) => <span className="tabular-nums text-ink">{formatINR(r.amount)}</span>,
    },
    {
      header: "Tax in it",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-ink-muted">
          {formatINR(Number(r.igst) + Number(r.cgst) + Number(r.sgst))}
        </span>
      ),
    },
    {
      header: "Left",
      align: "right",
      render: (r) => (
        <span className="font-semibold tabular-nums text-ink">{formatINR(r.balance)}</span>
      ),
    },
    {
      header: "Status",
      render: (r) => (
        <Chip size="sm" dot tone={STATUS_TONE[r.status]}>
          {STATUS_LABEL[r.status]}
        </Chip>
      ),
    },
    {
      header: "Actions",
      align: "right",
      render: (r) =>
        can("advances.refund") && Number(r.balance) > 0 ? (
          <ActionPill
            variant="secondary"
            size="sm"
            icon={<Undo2 size={15} />}
            onClick={() => setRefunding(r)}
          >
            Refund
          </ActionPill>
        ) : null,
    },
  ];

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Advances received"
        subtitle="Money taken before the invoice. The tax on it is due the day it arrives."
        icon={<Wallet size={22} />}
        primaryAction={recordButton}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatTile label="Received" value={formatINR(totals.received)} loading={loading} />
        <StatTile
          label="Still to adjust"
          value={formatINR(totals.left)}
          hint="Against future invoices or refunds"
          loading={loading}
        />
        <StatTile label="Open advances" value={totals.unused} loading={loading} />
      </div>

      {open && (
        <Tile
          title="New advance"
          subtitle="Enter what the customer paid, tax included."
          className="mb-5"
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Field label="Customer" required>
              <select
                className={fieldControlClass()}
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
            </Field>
            <Field label="Received on">
              <input
                type="date"
                className={fieldControlClass()}
                value={form.receiptDate}
                onChange={(e) => setForm({ ...form, receiptDate: e.target.value })}
              />
            </Field>
            <Field label="Amount received (tax included)" required>
              <input
                type="number"
                inputMode="decimal"
                className={fieldControlClass(false, "text-right tabular-nums")}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </Field>
            <Field label="GST rate %">
              <input
                type="number"
                inputMode="decimal"
                className={fieldControlClass(false, "text-right tabular-nums")}
                value={form.gstRate}
                onChange={(e) => setForm({ ...form, gstRate: e.target.value })}
              />
            </Field>
            <Field label="Paid by">
              <input
                className={fieldControlClass()}
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              />
            </Field>
            <Field label="Reference">
              <input
                className={fieldControlClass()}
                value={form.referenceNumber}
                onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-col gap-3 rounded-[14px] bg-card-2 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-ink-muted" aria-live="polite">
              Of <strong className="tabular-nums text-ink">{formatINR(gross)}</strong> received,{" "}
              <strong className="tabular-nums text-ink">{formatINR(taxable)}</strong> is the value
              of the supply and <strong className="tabular-nums text-ink">{formatINR(tax)}</strong>{" "}
              is GST already due.
            </p>
            <div className="flex shrink-0 gap-2">
              <ActionPill variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </ActionPill>
              <ActionPill onClick={() => void save()} loading={busy} loadingText="Saving…">
                Save
              </ActionPill>
            </div>
          </div>
        </Tile>
      )}

      <Toolbar
        filters={[
          { key: "", label: "All" },
          { key: "OPEN", label: "Unused" },
          { key: "PART_ADJUSTED", label: "Part used" },
          { key: "CLOSED", label: "Closed" },
        ]}
        filterValue={status}
        onFilterChange={setStatus}
        filtersLabel="Advance status"
      />

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        loading={loading}
        ariaLabel="Advances"
        emptyMessage={status ? "No advances with this status." : "No advances yet."}
        emptyAction={status ? undefined : open ? undefined : recordButton}
      />

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
    <Tile
      title={`Refund ${row.receiptNo}`}
      subtitle={`${formatINR(row.balance)} is left. The GST paid on whatever is refunded comes back too.`}
      className="mt-5"
    >
      <div className="grid gap-4 md:grid-cols-[200px_1fr_auto] md:items-end">
        <Field label="Amount">
          <input
            type="number"
            inputMode="decimal"
            className={fieldControlClass(false, "text-right tabular-nums")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Why">
          <input
            className={fieldControlClass()}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Order cancelled"
          />
        </Field>
        <div className="flex gap-2">
          <ActionPill variant="secondary" onClick={onCancel}>
            Cancel
          </ActionPill>
          <ActionPill
            variant="danger"
            loading={busy}
            onClick={() => onConfirm(Number(amount), reason)}
          >
            Refund
          </ActionPill>
        </div>
      </div>
    </Tile>
  );
};

export default AdvancesPage;
