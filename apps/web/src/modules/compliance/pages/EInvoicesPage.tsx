import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { FileCheck2, Settings2 } from "lucide-react";

import {
  eInvoiceService,
  type EInvoiceRow,
  type EInvoiceStatus,
} from "../../../services/eInvoiceService";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  PageHeader,
  Tile,
  Toolbar,
  actionPillClass,
  type ChipTone,
} from "../../../components/ui/v2";
import { usePermission } from "../../../hooks/usePermission";

/** E-invoice register (P1-11): every IRN request with its outcome, filterable by status and type. */
const STATUS_TONE: Record<EInvoiceStatus, ChipTone> = {
  PENDING: "warning",
  GENERATED: "success",
  FAILED: "danger",
  CANCELLED: "muted",
};
const STATUS_LABEL: Record<EInvoiceStatus, string> = {
  PENDING: "Pending",
  GENERATED: "IRN generated",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
const TYPE: Record<EInvoiceRow["docType"], string> = {
  INV: "Invoice",
  CRN: "Credit note",
  DBN: "Debit note",
};
const linkFor = (r: EInvoiceRow) =>
  r.docType === "INV"
    ? `/sales-invoices/${r.docId}`
    : r.docType === "CRN"
      ? "/returns/sales"
      : "/returns/purchase";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" });
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const EInvoicesPage: React.FC = () => {
  const { can } = usePermission();
  const [rows, setRows] = useState<EInvoiceRow[]>([]);
  const [status, setStatus] = useState<EInvoiceStatus | "">("");
  const [docType, setDocType] = useState<EInvoiceRow["docType"] | "">("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(
        await eInvoiceService.list({ ...(status && { status }), ...(docType && { docType }) })
      );
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [status, docType]);
  useEffect(() => {
    void load();
  }, [load]);

  const failed = rows.filter((r) => r.status === "FAILED").length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.docNo, r.buyerGstin, r.irn, r.ackNo].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q)
      )
    );
  }, [rows, search]);
  const filtered = Boolean(status || docType || search);

  const columns: DataTableColumn<EInvoiceRow>[] = [
    {
      header: "Document",
      render: (r) => (
        <Link className="font-semibold text-accent hover:underline" to={linkFor(r)}>
          {TYPE[r.docType]} {r.docNo}
        </Link>
      ),
    },
    { header: "Date", render: (r) => <span className="tabular-nums">{day(r.docDate)}</span> },
    {
      header: "Buyer GSTIN",
      render: (r) => <span className="font-mono text-xs">{r.buyerGstin}</span>,
    },
    {
      header: "Status",
      render: (r) => (
        <div className="py-1">
          <Chip tone={STATUS_TONE[r.status]} size="sm" dot>
            {STATUS_LABEL[r.status]}
          </Chip>
          {r.error && (
            <div
              className="mt-1 max-w-xs truncate text-xs text-[color:var(--color-danger)]"
              title={r.error}
            >
              {r.error}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "IRN / Ack",
      render: (r) =>
        r.irn ? (
          <div className="font-mono text-xs">
            <div title={r.irn}>{r.irn.slice(0, 16)}…</div>
            <div className="text-ink-muted">{r.ackNo}</div>
          </div>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    {
      header: "Last change",
      render: (r) => <span className="text-xs text-ink-muted">{when(r.updatedAt)}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="E-invoice Register"
        icon={<FileCheck2 size={22} />}
        subtitle="Every IRN raised or refused by the portal for invoices, credit notes and debit notes. Failed ones can be retried from the document."
        meta={
          failed > 0 ? (
            <Chip tone="danger" dot>
              {failed} failed
            </Chip>
          ) : undefined
        }
        actions={
          can("e-invoice.settings") ? (
            <Link to="/settings/e-invoice" className={actionPillClass({ variant: "secondary" })}>
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </Link>
          ) : undefined
        }
        primaryAction={
          <Link to="/sales-invoices" className={actionPillClass({ size: "lg" })}>
            Generate IRN from an invoice
          </Link>
        }
      />

      <Toolbar<EInvoiceStatus | "">
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search number, GSTIN, IRN"
        filters={[
          { key: "", label: "All" },
          ...(Object.keys(STATUS_LABEL) as EInvoiceStatus[]).map((s) => ({
            key: s,
            label: STATUS_LABEL[s],
          })),
        ]}
        filterValue={status}
        onFilterChange={setStatus}
        filtersLabel="Status"
        right={
          <select
            className="sl-input h-11 w-full py-0 text-sm sm:w-48"
            value={docType}
            onChange={(e) => setDocType(e.target.value as EInvoiceRow["docType"] | "")}
            aria-label="Document type"
          >
            <option value="">All documents</option>
            {(Object.keys(TYPE) as EInvoiceRow["docType"][]).map((t) => (
              <option key={t} value={t}>
                {TYPE[t]}
              </option>
            ))}
          </select>
        }
      />

      <Tile padding="none" className="overflow-hidden">
        <DataTable
          ariaLabel="E-invoices"
          columns={columns}
          data={shown}
          rowKey={(r) => r.id}
          loading={loading}
          emptyMessage={
            filtered
              ? "No e-invoices match these filters."
              : "No e-invoices yet. Raise one from a B2B invoice once e-invoicing is enabled in Settings."
          }
          emptyAction={
            filtered ? (
              <ActionPill
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStatus("");
                  setDocType("");
                  setSearch("");
                }}
              >
                Clear filters
              </ActionPill>
            ) : undefined
          }
        />
      </Tile>
    </div>
  );
};

export default EInvoicesPage;
