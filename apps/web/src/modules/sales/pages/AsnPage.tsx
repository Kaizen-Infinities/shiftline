import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  AlertTriangle,
  Ban,
  Check,
  CheckCheck,
  Download,
  FileText,
  Plus,
  Printer,
  Send,
  Tags,
  Truck,
  X,
} from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  asnService,
  type AsnDetail,
  type AsnPrefill,
  type AsnRow,
  type AsnStatus,
  type ExportFormat,
  type InvoiceOption,
  type LabelSize,
} from "../../../services/asnService";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  Field,
  PageHeader,
  SearchField,
  SkeletonRows,
  Tile,
  cx,
  fieldControlClass,
  type ChipTone,
} from "../../../components/ui/v2";
import { PAGE_CLASS, errorMessage, formatDateIN } from "../shared/tradeUi";

/**
 * OEM advance shipping notices (TN-07): raise an ASN from a sales invoice (lines prefilled from
 * the customer part map and the open delivery-schedule lines), mark it sent so the dispatch
 * counts toward schedule adherence, export it for the OEM portal and print a QR label per pack.
 */
type StatusTab = "ALL" | AsnStatus;

const STATUS_TONE: Record<AsnStatus, ChipTone> = {
  DRAFT: "muted",
  SENT: "info",
  ACKNOWLEDGED: "success",
  CANCELLED: "danger",
};
const STATUS_LABEL: Record<AsnStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACKNOWLEDGED: "Acknowledged",
  CANCELLED: "Cancelled",
};

const StatusChip: React.FC<{ status: AsnStatus }> = ({ status }) => (
  <Chip size="sm" dot tone={STATUS_TONE[status]}>
    {STATUS_LABEL[status]}
  </Chip>
);

const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-2.5 text-sm text-ink align-middle";
const qtyFmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const packsOf = (qty: number, pack: number) =>
  qty > 0 && pack > 0 ? Math.ceil(Math.round(qty * 1000) / Math.round(pack * 1000)) : 0;
/** `YYYY-MM-DDTHH:mm` in India time, for a datetime-local input. */
const nowLocal = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);
const dateTimeIN = (v: string) =>
  new Date(v).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

interface DraftLine {
  key: string;
  productId: string;
  productLabel: string;
  customerPartNo: string;
  description: string;
  qty: string;
  packQty: string;
  scheduleLineId: string;
}

const emptyHeader = {
  asnNo: "",
  dispatchAt: nowLocal(),
  vehicleNo: "",
  transporterName: "",
  lrNo: "",
  lrDate: "",
  notes: "",
};

// ── Create from invoice ─────────────────────────────────────────────────────
const CreateAsn: React.FC<{ onDone: (a: AsnDetail) => void; onClose: () => void }> = ({
  onDone,
  onClose,
}) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [invoices, setInvoices] = useState<InvoiceOption[] | null>(null);
  const [prefill, setPrefill] = useState<AsnPrefill | null>(null);
  const [header, setHeader] = useState(emptyHeader);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      asnService
        .invoices(search.trim() ? { q: search.trim() } : {})
        .then(setInvoices)
        .catch((err) => {
          setInvoices([]);
          toast.error(errorMessage(err));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const pick = async (id: string) => {
    try {
      const p = await asnService.prefill(id);
      setPrefill(p);
      setHeader({
        ...emptyHeader,
        dispatchAt: nowLocal(),
        vehicleNo: p.transport.vehicleNo ?? "",
        transporterName: p.transport.transporterName ?? "",
        lrNo: p.transport.lrNo ?? "",
        lrDate: p.transport.lrDate ?? "",
      });
      setLines(
        p.lines.map((l, i) => ({
          key: `${l.productId}-${i}`,
          productId: l.productId,
          productLabel: `${l.productCode} · ${l.productName}`,
          customerPartNo: l.customerPartNo ?? "",
          description: l.description ?? "",
          qty: String(l.qty),
          packQty: String(l.packQty),
          scheduleLineId: l.scheduleLineId ?? "",
        }))
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefill) return;
    setSaving(true);
    try {
      const created = await asnService.create({
        salesInvoiceId: prefill.invoice.id,
        asnNo: header.asnNo.trim() || undefined,
        dispatchAt: header.dispatchAt,
        vehicleNo: header.vehicleNo.trim() || undefined,
        transporterName: header.transporterName.trim() || undefined,
        lrNo: header.lrNo.trim() || undefined,
        lrDate: header.lrDate || undefined,
        notes: header.notes.trim() || undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          customerPartNo: l.customerPartNo.trim(),
          description: l.description.trim() || undefined,
          qty: Number(l.qty),
          packQty: Number(l.packQty),
          scheduleLineId: l.scheduleLineId || null,
        })),
      });
      toast.success(`ASN ${created.asnNo} created`);
      onDone(created);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (!prefill) {
    return (
      <Tile
        title="New ASN"
        subtitle="Pick the sales invoice the truck carries. Invoices that already have an ASN are hidden."
        actions={
          <ActionPill variant="ghost" size="sm" icon={<X size={15} />} onClick={onClose}>
            Close
          </ActionPill>
        }
      >
        <SearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search invoice number"
          className="sm:w-96"
        />
        <div className="mt-4">
          {invoices === null ? (
            <SkeletonRows rows={3} columns={3} header={false} />
          ) : invoices.length === 0 ? (
            <EmptyState
              compact
              icon={<FileText size={22} />}
              title="No invoices waiting for an ASN."
            />
          ) : (
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2 xl:grid-cols-3">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <button
                    type="button"
                    onClick={() => void pick(inv.id)}
                    className="sl-tile sl-tile-hover flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[13px] font-semibold text-accent">
                        {inv.invoiceNo}
                      </span>
                      <span className="block truncate text-sm text-ink">{inv.customerName}</span>
                    </span>
                    <span className="shrink-0 text-right text-[12px] text-ink-subtle">
                      {formatDateIN(inv.invoiceDate)}
                      <br />
                      {inv.itemCount} item{inv.itemCount === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Tile>
    );
  }

  const unmapped = lines.filter((l) => !l.customerPartNo.trim()).length;
  const optionsFor = (l: DraftLine) =>
    prefill.openScheduleLines.filter(
      (o) =>
        o.productId === l.productId ||
        (l.customerPartNo && o.customerPartNo.toUpperCase() === l.customerPartNo.toUpperCase())
    );

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <Tile
        title={`New ASN · ${prefill.invoice.invoiceNo}`}
        subtitle={`${prefill.invoice.customerName} · invoice of ${formatDateIN(prefill.invoice.invoiceDate)}`}
        actions={
          <ActionPill variant="ghost" size="sm" onClick={() => setPrefill(null)}>
            Change invoice
          </ActionPill>
        }
      >
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
          <Field label="ASN number" hint={`Blank uses ASN-${prefill.invoice.invoiceNo}`}>
            <input
              className={fieldControlClass()}
              value={header.asnNo}
              maxLength={40}
              onChange={(e) => setHeader((h) => ({ ...h, asnNo: e.target.value }))}
            />
          </Field>
          <Field label="Dispatch time" required>
            <input
              type="datetime-local"
              className={fieldControlClass()}
              value={header.dispatchAt}
              onChange={(e) => setHeader((h) => ({ ...h, dispatchAt: e.target.value }))}
              required
            />
          </Field>
          <Field label="Vehicle no.">
            <input
              className={fieldControlClass(false, "uppercase")}
              placeholder="TN09AB1234"
              value={header.vehicleNo}
              maxLength={15}
              onChange={(e) => setHeader((h) => ({ ...h, vehicleNo: e.target.value }))}
            />
          </Field>
          <Field label="Transporter">
            <input
              className={fieldControlClass()}
              value={header.transporterName}
              maxLength={100}
              onChange={(e) => setHeader((h) => ({ ...h, transporterName: e.target.value }))}
            />
          </Field>
          <Field label="LR no.">
            <input
              className={fieldControlClass()}
              value={header.lrNo}
              maxLength={30}
              onChange={(e) => setHeader((h) => ({ ...h, lrNo: e.target.value }))}
            />
          </Field>
          <Field label="LR date">
            <input
              type="date"
              className={fieldControlClass()}
              value={header.lrDate}
              onChange={(e) => setHeader((h) => ({ ...h, lrDate: e.target.value }))}
            />
          </Field>
        </div>
      </Tile>

      <Tile
        padding="none"
        divider
        title="Parts"
        subtitle="Quantities come from the invoice, split across the customer's open schedule lines."
        actions={
          unmapped > 0 ? (
            <Chip tone="warning" onClick={() => navigate("/sales/customer-part-numbers")}>
              <AlertTriangle size={14} aria-hidden="true" /> {unmapped} without a customer part no.
            </Chip>
          ) : undefined
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]" aria-label="ASN lines">
            <thead className="bg-card-2">
              <tr>
                <th scope="col" className={th}>
                  Item
                </th>
                <th scope="col" className={th}>
                  Customer part no.
                </th>
                <th scope="col" className={`${th} !text-right`}>
                  Qty
                </th>
                <th scope="col" className={`${th} !text-right`}>
                  Std pack
                </th>
                <th scope="col" className={`${th} !text-right`}>
                  Packs
                </th>
                <th scope="col" className={th}>
                  Schedule line
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-line-soft">
                  <td className={cx(td, "max-w-[220px]")}>
                    <span className="block truncate font-medium">{l.productLabel}</span>
                  </td>
                  <td className={td}>
                    <input
                      className={cx(
                        "sl-input h-9 w-40 font-mono text-sm",
                        !l.customerPartNo.trim() && "is-invalid"
                      )}
                      aria-label={`Customer part number for ${l.productLabel}`}
                      value={l.customerPartNo}
                      maxLength={40}
                      required
                      onChange={(e) => setLine(l.key, { customerPartNo: e.target.value })}
                    />
                  </td>
                  <td className={cx(td, "text-right")}>
                    <input
                      className="sl-input h-9 w-24 text-right text-sm tabular-nums"
                      inputMode="decimal"
                      aria-label={`Quantity for ${l.productLabel}`}
                      value={l.qty}
                      required
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    />
                  </td>
                  <td className={cx(td, "text-right")}>
                    <input
                      className="sl-input h-9 w-24 text-right text-sm tabular-nums"
                      inputMode="decimal"
                      aria-label={`Standard pack for ${l.productLabel}`}
                      value={l.packQty}
                      required
                      onChange={(e) => setLine(l.key, { packQty: e.target.value })}
                    />
                  </td>
                  <td className={cx(td, "text-right font-semibold tabular-nums")}>
                    {packsOf(Number(l.qty), Number(l.packQty)) || "—"}
                  </td>
                  <td className={td}>
                    <select
                      className="sl-input h-9 w-64 pr-8 text-sm"
                      aria-label={`Schedule line for ${l.productLabel}`}
                      value={l.scheduleLineId}
                      onChange={(e) => setLine(l.key, { scheduleLineId: e.target.value })}
                    >
                      <option value="">Not against a schedule</option>
                      {optionsFor(l).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.scheduleNo}
                          {o.revision > 0 ? ` r${o.revision}` : ""} · due {formatDateIN(o.dueDate)}{" "}
                          · {qtyFmt(o.remaining)} open
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cx(td, "text-right")}>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="sl-icon-btn sl-icon-btn-ghost"
                        aria-label={`Remove ${l.productLabel}`}
                        onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tile>
      <div className="flex justify-end gap-2.5">
        <ActionPill variant="secondary" onClick={onClose}>
          Cancel
        </ActionPill>
        <ActionPill
          type="submit"
          icon={<Check size={17} />}
          disabled={saving || lines.length === 0}
        >
          Create ASN
        </ActionPill>
      </div>
    </form>
  );
};

// ── Detail ──────────────────────────────────────────────────────────────────
const AsnDetailTile: React.FC<{
  asn: AsnDetail;
  formats: ExportFormat[];
  onChange: (a: AsnDetail) => void;
}> = ({ asn, formats, onChange }) => {
  const { can } = usePermission();
  const canEdit = can("asn.edit");
  const canExport = can("asn.export");
  const [format, setFormat] = useState("GENERIC_CSV");
  const [size, setSize] = useState<LabelSize>("A4");
  const [prompt, setPrompt] = useState<null | "ack" | "cancel">(null);
  const [text, setText] = useState("");

  const status = async (body: Parameters<typeof asnService.setStatus>[1], ok: string) => {
    try {
      onChange(await asnService.setStatus(asn.id, body));
      setPrompt(null);
      setText("");
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const live = asn.status !== "CANCELLED";

  return (
    <Tile
      padding="none"
      divider
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{asn.asnNo}</span> <StatusChip status={asn.status} />
        </span>
      }
      subtitle={`${asn.customerName} · invoice ${asn.invoiceNo} · ${dateTimeIN(asn.dispatchAt)}`}
      actions={
        canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {asn.status === "DRAFT" && (
              <ActionPill
                size="sm"
                icon={<Send size={15} />}
                onClick={() => void status({ status: "SENT" }, "Marked sent; dispatch booked")}
              >
                Mark sent
              </ActionPill>
            )}
            {asn.status === "SENT" && (
              <ActionPill
                size="sm"
                variant="blue"
                icon={<CheckCheck size={15} />}
                onClick={() => setPrompt("ack")}
              >
                Acknowledged
              </ActionPill>
            )}
            {(asn.status === "DRAFT" || asn.status === "SENT") && (
              <ActionPill
                size="sm"
                variant="ghost"
                icon={<Ban size={15} />}
                onClick={() => setPrompt("cancel")}
              >
                Cancel
              </ActionPill>
            )}
          </div>
        )
      }
    >
      {prompt && (
        <div className="flex flex-wrap items-end gap-2 border-b border-line-soft px-4 py-3">
          <Field
            label={prompt === "ack" ? "OEM acknowledgement / GRN ref" : "Reason for cancelling"}
            className="min-w-[240px] flex-1"
          >
            <input
              className={fieldControlClass()}
              value={text}
              maxLength={prompt === "ack" ? 60 : 300}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </Field>
          <ActionPill
            size="sm"
            variant={prompt === "cancel" ? "danger" : "cta"}
            onClick={() =>
              void (prompt === "ack"
                ? status(
                    { status: "ACKNOWLEDGED", ackRef: text.trim() || undefined },
                    "Acknowledged"
                  )
                : status({ status: "CANCELLED", reason: text.trim() }, "ASN cancelled"))
            }
          >
            {prompt === "ack" ? "Save" : "Cancel ASN"}
          </ActionPill>
          <ActionPill size="sm" variant="ghost" onClick={() => setPrompt(null)}>
            Back
          </ActionPill>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 px-4 py-4 text-sm md:grid-cols-4">
        {[
          ["Vehicle", asn.vehicleNo],
          ["Transporter", asn.transporterName],
          [
            "LR",
            asn.lrNo ? `${asn.lrNo}${asn.lrDate ? ` · ${formatDateIN(asn.lrDate)}` : ""}` : null,
          ],
          ["Packs", `${asn.totalPacks} · ${qtyFmt(asn.totalQty)} pcs`],
          ...(asn.ackRef ? [["OEM ref", asn.ackRef]] : []),
          ...(asn.cancelReason ? [["Cancelled", asn.cancelReason]] : []),
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-[12px] font-medium text-ink-subtle">{k}</dt>
            <dd className="m-0 font-medium text-ink">{v || "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto border-t border-line-soft">
        <table className="w-full min-w-[640px]" aria-label="ASN lines">
          <thead className="bg-card-2">
            <tr>
              <th scope="col" className={th}>
                #
              </th>
              <th scope="col" className={th}>
                Part no.
              </th>
              <th scope="col" className={`${th} !text-right`}>
                Qty
              </th>
              <th scope="col" className={`${th} !text-right`}>
                Packs
              </th>
              <th scope="col" className={th}>
                Schedule
              </th>
            </tr>
          </thead>
          <tbody>
            {asn.lines.map((l) => (
              <tr key={l.id} className="border-t border-line-soft">
                <td className={`${td} tabular-nums text-ink-subtle`}>{l.seq}</td>
                <td className={td}>
                  <span className="block font-mono font-semibold">{l.customerPartNo}</span>
                  <span className="block text-[12px] text-ink-subtle">
                    {l.productCode} · {l.description ?? l.productName}
                  </span>
                </td>
                <td className={`${td} text-right tabular-nums`}>{qtyFmt(l.qty)}</td>
                <td className={`${td} text-right tabular-nums`}>
                  {l.packs} × {qtyFmt(l.packQty)}
                </td>
                <td className={td}>
                  {l.schedule ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {l.schedule.scheduleNo} · {formatDateIN(l.schedule.dueDate)}
                      {l.dispatchBooked && (
                        <Chip size="sm" tone="success">
                          booked
                        </Chip>
                      )}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canExport && live && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3">
          <select
            className="sl-input h-10 w-auto pr-9 text-sm"
            aria-label="Export format"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {formats.map((f) => (
              <option key={f.key} value={f.key} disabled={!f.available}>
                {f.label}
                {f.available ? "" : " (coming)"}
              </option>
            ))}
          </select>
          <ActionPill
            size="sm"
            variant="secondary"
            icon={<Download size={15} />}
            onClick={() =>
              void asnService
                .download(asn.id, format, `${asn.asnNo}.csv`)
                .catch((err) => toast.error(errorMessage(err)))
            }
          >
            Export
          </ActionPill>
          <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
          <select
            className="sl-input h-10 w-auto pr-9 text-sm"
            aria-label="Label size"
            value={size}
            onChange={(e) => setSize(e.target.value as LabelSize)}
          >
            <option value="A4">A4 sheet (8 per page)</option>
            <option value="100X150">100 × 150 mm thermal</option>
          </select>
          <ActionPill
            size="sm"
            variant="secondary"
            icon={<Printer size={15} />}
            onClick={() =>
              void asnService
                .printLabels(asn.id, size)
                .catch((err) => toast.error(errorMessage(err)))
            }
          >
            Print labels
          </ActionPill>
        </div>
      )}
    </Tile>
  );
};

// ── Page ────────────────────────────────────────────────────────────────────
const AsnPage: React.FC = () => {
  const { can } = usePermission();
  const navigate = useNavigate();
  const [tab, setTab] = useState<StatusTab>("ALL");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AsnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AsnDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await asnService.list({
          ...(tab !== "ALL" ? { status: tab } : {}),
          ...(search.trim() ? { q: search.trim() } : {}),
        })
      );
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    asnService
      .formats()
      .then(setFormats)
      .catch(() => setFormats([]));
  }, []);

  const open = async (id: string) => {
    try {
      setSelected(await asnService.get(id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const drafts = useMemo(() => rows.filter((r) => r.status === "DRAFT").length, [rows]);

  return (
    <div className={cx(PAGE_CLASS, "flex flex-col gap-5")}>
      <PageHeader
        title="ASN & labels"
        icon={<Truck size={22} />}
        subtitle="Advance shipping notices for OEM customers, with a QR label on every pack."
        meta={
          tab === "ALL" && drafts > 0 ? (
            <Chip size="sm" dot tone="warning">
              {drafts} draft{drafts === 1 ? "" : "s"}
            </Chip>
          ) : undefined
        }
        actions={
          <ActionPill
            variant="secondary"
            icon={<Tags size={17} />}
            onClick={() => navigate("/sales/customer-part-numbers")}
          >
            Part numbers
          </ActionPill>
        }
        primaryAction={
          can("asn.create") && !creating ? (
            <ActionPill icon={<Plus size={18} />} onClick={() => setCreating(true)}>
              New ASN
            </ActionPill>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ChipTabs<StatusTab>
            ariaLabel="ASN status"
            value={tab}
            onChange={setTab}
            items={[
              { key: "ALL", label: "All" },
              { key: "DRAFT", label: "Draft" },
              { key: "SENT", label: "Sent" },
              { key: "ACKNOWLEDGED", label: "Acknowledged" },
              { key: "CANCELLED", label: "Cancelled" },
            ]}
          />
          <SearchField
            value={search}
            onValueChange={setSearch}
            placeholder="ASN, invoice or vehicle"
          />
        </div>
      </PageHeader>

      {creating && (
        <CreateAsn
          onClose={() => setCreating(false)}
          onDone={(a) => {
            setCreating(false);
            setSelected(a);
            void load();
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Tile padding="none" divider title="Notices">
            {loading ? (
              <SkeletonRows rows={4} columns={3} header={false} />
            ) : rows.length === 0 ? (
              <EmptyState
                compact
                icon={<Truck size={22} />}
                title="No ASNs here yet."
                description={
                  can("asn.create")
                    ? "Raise one from a sales invoice when the truck is loaded."
                    : undefined
                }
              />
            ) : (
              <ul className="m-0 list-none p-0" aria-label="ASNs">
                {rows.map((r) => (
                  <li key={r.id} className="border-t border-line-soft first:border-t-0">
                    <button
                      type="button"
                      aria-pressed={selected?.id === r.id}
                      onClick={() => void open(r.id)}
                      className={cx(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                        selected?.id === r.id ? "bg-nav-active" : "hover:bg-card-2"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-accent">
                            {r.asnNo}
                          </span>
                          <StatusChip status={r.status} />
                        </div>
                        <div className="truncate text-sm font-medium text-ink">
                          {r.customerName}
                        </div>
                        <div className="sl-muted text-[12px]">
                          Inv {r.invoiceNo}
                          {r.vehicleNo ? ` · ${r.vehicleNo}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[11px] font-medium text-ink-subtle">
                          {dateTimeIN(r.dispatchAt)}
                        </div>
                        <div className="text-sm font-semibold text-ink tabular-nums">
                          {r.totalPacks} packs
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </div>
        <div className="lg:col-span-3">
          {selected ? (
            <AsnDetailTile
              asn={selected}
              formats={formats}
              onChange={(a) => {
                setSelected(a);
                void load();
              }}
            />
          ) : (
            <Tile title="Details">
              <EmptyState
                compact
                icon={<FileText size={22} />}
                title="Pick an ASN to see its parts, export it or print labels."
              />
            </Tile>
          )}
        </div>
      </div>
    </div>
  );
};

export default AsnPage;
