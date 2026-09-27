import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  FaFileInvoice,
  FaHistory,
  FaList,
  FaSync,
  FaBuilding,
  FaMoneyBillWave,
  FaCheckCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { FileText, Plus, RefreshCw } from "lucide-react";
import { ActionPill, Chip, PageHeader } from "../../../../components/ui/v2";
import StatementPanel from "../../components/StatementPanel";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";
import ColumnToggle from "../../../../components/ui/ColumnToggle/ColumnToggle";
import type { DataTableColumn } from "../../../../components/ui/table/DataTable";
import DataTable from "../../../../components/ui/table/DataTable";
import { DATE_RANGE_OPTIONS } from "../../../../constants/selectOption";
import { payableService, type SupplierPayableDetail } from "../../../../services/payableService";
import { useListCache } from "../../../../hooks/useListCache";

export const SupplierBreakdownPage: React.FC = () => {
  const { supplierId } = useParams<{ supplierId: string }>();
  const [showStatement, setShowStatement] = useState(false);
  const navigate = useNavigate();

  // Applied filter state
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Draft filter state for Apply / Clear All
  const [draftStartDate, setDraftStartDate] = useState<string>(startDate);
  const [draftEndDate, setDraftEndDate] = useState<string>(endDate);
  const [dateRangePreset, setDateRangePreset] = useState<string>("custom");

  const [activeTab, setActiveTab] = useState<"invoices" | "payments" | "statement">("invoices");

  // Columns & Column Toggle for Invoices tab
  const DEFAULT_INVOICE_COLUMNS = ["#", "INVOICE NO", "DATE", "DUE DATE", "INVOICE AMOUNT"];

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem("supplierBreakdownVisibleColumns");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_INVOICE_COLUMNS;
      }
    }
    return DEFAULT_INVOICE_COLUMNS;
  });

  useEffect(() => {
    localStorage.setItem("supplierBreakdownVisibleColumns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const cacheKey = `accounts:supplier-breakdown-${supplierId || "none"}:${startDate}:${endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      if (!supplierId) return { data: [], total: 0 };
      try {
        const data = await payableService.getSupplierPayableDetail(parseInt(supplierId, 10), {
          startDate,
          endDate,
        });
        return { data: data ? [data] : [], total: data ? 1 : 0 };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load supplier breakdown statement");
        throw err;
      }
    },
    [supplierId, startDate, endDate]
  );

  const {
    data: supplierDetailList,
    loading,
    refreshing,
    refresh,
  } = useListCache<SupplierPayableDetail>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
    enabled: !!supplierId,
  });

  const supplierDetail: SupplierPayableDetail | null = supplierDetailList[0] || null;

  // Only show the table loader on the very first fetch (no detail yet).
  // Once the detail has loaded, silent refreshes should not blank the tables —
  // the `refreshing` badge in the header already indicates background work.
  const tableLoading = loading && !supplierDetail;

  // Date range preset handler
  const handleDateRangeChange = (val: string) => {
    setDateRangePreset(val);
    if (val === "custom") return;

    const today = new Date();
    const start = new Date();
    const end = new Date();

    if (val === "today") {
      // both today
    } else if (val === "yesterday") {
      start.setDate(today.getDate() - 1);
      end.setDate(today.getDate() - 1);
    } else if (val === "last_week") {
      start.setDate(today.getDate() - 7);
    } else if (val === "last_month") {
      start.setMonth(today.getMonth() - 1);
    } else if (val === "last_6_months") {
      start.setMonth(today.getMonth() - 6);
    } else if (val === "last_year") {
      start.setFullYear(today.getFullYear() - 1);
    }

    setDraftStartDate(start.toISOString().split("T")[0]);
    setDraftEndDate(end.toISOString().split("T")[0]);
  };

  const handleApplyFilters = () => {
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
  };

  const handleClearFilters = () => {
    setDraftStartDate("");
    setDraftEndDate("");
    setDateRangePreset("custom");
    setStartDate("");
    setEndDate("");
  };

  // CSV Export Configuration based on active tab
  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    if (!supplierDetail)
      return { csvData: [], csvColumns: [], csvFilename: "Supplier_Statement.csv" };

    const legalName = supplierDetail.supplier?.legalName || "Supplier";

    if (activeTab === "invoices") {
      return {
        csvData: supplierDetail.invoices || [],
        csvColumns: [
          { header: "Invoice No", accessor: (item: any) => item.invoiceNo },
          { header: "Date", accessor: (item: any) => item.date },
          { header: "Due Date", accessor: (item: any) => item.dueDate || "-" },
          { header: "Invoice Amount", accessor: (item: any) => item.amount },
        ],
        csvFilename: `${legalName}_Invoices_${new Date().toISOString().split("T")[0]}.csv`,
      };
    } else if (activeTab === "payments") {
      return {
        csvData: supplierDetail.paymentHistory || [],
        csvColumns: [
          { header: "Voucher No", accessor: (item: any) => item.voucherNo },
          { header: "Date", accessor: (item: any) => item.date },
          { header: "Payment Mode", accessor: (item: any) => item.paymentMode || "General" },
          { header: "Amount Paid", accessor: (item: any) => item.amount },
          { header: "Reference No", accessor: (item: any) => item.referenceNo || "-" },
          { header: "Narration", accessor: (item: any) => item.narration || "-" },
        ],
        csvFilename: `${legalName}_Payments_${new Date().toISOString().split("T")[0]}.csv`,
      };
    } else {
      return {
        csvData: supplierDetail.statementEntries || [],
        csvColumns: [
          { header: "Date", accessor: (item: any) => item.date },
          { header: "Voucher No", accessor: (item: any) => item.voucherNo },
          { header: "Particulars", accessor: (item: any) => item.particulars },
          { header: "Debit (Dr)", accessor: (item: any) => item.debit },
          { header: "Credit (Cr)", accessor: (item: any) => item.credit },
          { header: "Running Balance", accessor: (item: any) => item.runningBalance },
        ],
        csvFilename: `${legalName}_Ledger_Statement_${new Date().toISOString().split("T")[0]}.csv`,
      };
    }
  }, [supplierDetail, activeTab]);

  const invoices = supplierDetail?.invoices || [];
  const payments = supplierDetail?.paymentHistory || [];
  const statements = supplierDetail?.statementEntries || [];

  // Invoice Table Columns
  const invoiceColumns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "50px",
      render: (_item, index) => index + 1,
    },
    {
      header: "INVOICE NO",
      render: (item: any) => (
        <span className="tabular-nums font-bold text-ink">{item.invoiceNo}</span>
      ),
    },
    {
      header: "DATE",
      render: (item: any) => <span className="text-ink-muted tabular-nums">{item.date}</span>,
    },
    {
      header: "DUE DATE",
      render: (item: any) => (
        <span className="text-ink-subtle tabular-nums">{item.dueDate || "-"}</span>
      ),
    },
    {
      header: "INVOICE AMOUNT",
      render: (item: any) => (
        <div className="text-right tabular-nums font-semibold text-ink">
          ₹{" "}
          {item.amount.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      ),
    },
  ];

  // Payment Table Columns
  const paymentColumns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "50px",
      render: (_item, index) => index + 1,
    },
    {
      header: "VOUCHER / REF NO",
      render: (item: any) => (
        <div className="flex items-center gap-2">
          <span className="tabular-nums font-bold text-ink">{item.voucherNo}</span>
          {item.postedToLedger === false && (
            <span className="px-1.5 py-0.5 rounded text-[11.5px] font-semibold bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)] border border-[color:var(--color-warning)]/40">
              Not posted
            </span>
          )}
        </div>
      ),
    },
    {
      header: "DATE",
      render: (item: any) => <span className="text-ink-muted tabular-nums">{item.date}</span>,
    },
    {
      header: "PAYMENT MODE",
      render: (item: any) => (
        <span className="px-1.5 py-0.5 rounded text-[11.5px] font-semibold bg-card-2 text-ink-muted border border-line">
          {item.paymentMode || "General"}
        </span>
      ),
    },
    {
      header: "AMOUNT PAID",
      render: (item: any) => (
        <div className="text-right tabular-nums font-semibold text-[color:var(--color-success)]">
          ₹{" "}
          {item.amount.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      ),
    },
    {
      header: "REFERENCE NO",
      render: (item: any) => (
        <span className="text-ink-muted tabular-nums text-[12.5px]">{item.referenceNo || "-"}</span>
      ),
    },
    {
      header: "NARRATION",
      render: (item: any) => (
        <span className="text-ink-muted text-[12.5px]">{item.narration || "-"}</span>
      ),
    },
  ];

  // Statement Table Columns
  const statementColumns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "50px",
      render: (_item, index) => index + 1,
    },
    {
      header: "DATE",
      render: (item: any) => <span className="text-ink-muted tabular-nums">{item.date}</span>,
    },
    {
      header: "VOUCHER NO",
      render: (item: any) => (
        <span className="tabular-nums font-bold text-ink">{item.voucherNo}</span>
      ),
    },
    {
      header: "PARTICULARS",
      render: (item: any) => (
        <span className="text-ink text-[12.5px] font-medium">{item.particulars}</span>
      ),
    },
    {
      header: "DEBIT (DR)",
      render: (item: any) => (
        <div className="text-right tabular-nums text-ink-muted">
          {item.debit > 0
            ? `₹ ${item.debit.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "-"}
        </div>
      ),
    },
    {
      header: "CREDIT (CR)",
      render: (item: any) => (
        <div className="text-right tabular-nums text-ink-muted">
          {item.credit > 0
            ? `₹ ${item.credit.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : "-"}
        </div>
      ),
    },
    {
      header: "RUNNING BALANCE",
      render: (item: any) => (
        <div className="text-right tabular-nums font-semibold text-[color:var(--color-warning)]">
          ₹{" "}
          {item.runningBalance.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full space-y-4 text-ink">
      <PageHeader
        back="/accounts/payable"
        backLabel="Back to payables"
        breadcrumbs={[
          { label: "Amount Payable", to: "/accounts/payable" },
          { label: supplierDetail?.supplier.legalName || "Supplier" },
        ]}
        title={supplierDetail?.supplier.legalName || "Supplier Breakdown"}
        subtitle="Bills, payments and the running balance for this supplier"
        meta={
          supplierDetail?.supplier.supplierCode ? (
            <Chip size="sm">{supplierDetail.supplier.supplierCode}</Chip>
          ) : undefined
        }
        primaryAction={
          <ActionPill
            icon={<Plus size={18} />}
            onClick={() => navigate("/accounts/payment-voucher/add")}
          >
            Record Payment
          </ActionPill>
        }
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
              onClick={refresh}
              title="Refresh"
            >
              Refresh
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<FileText size={16} />}
              onClick={() => setShowStatement((v) => !v)}
              aria-pressed={showStatement}
              title="Statement of account"
            >
              Statement
            </ActionPill>
            <ExportCSVButton
              data={csvData}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          </>
        }
      />
      <div className="sl-tile overflow-hidden">
        {showStatement && supplierId && (
          <div className="px-3 py-2 border-b border-line">
            <StatementPanel
              partyType="supplier"
              partyId={supplierId}
              onClose={() => setShowStatement(false)}
            />
          </div>
        )}

        {/* Filter Row - single compact row */}
        <div className="p-4 sm:p-5 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-[170px]">
            <label className="sl-label">Range</label>
            <SelectInput
              name="dateRangePreset"
              value={dateRangePreset}
              options={DATE_RANGE_OPTIONS}
              hideLabel={true}
              onChange={(e) => handleDateRangeChange(e.target.value)}
            />
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="sl-label">From</label>
            <DatePickerCalendar
              name="draftStartDate"
              value={draftStartDate}
              onChange={(e) => {
                setDraftStartDate(e.target.value);
                setDateRangePreset("custom");
              }}
            />
          </div>

          <div className="w-full sm:w-[170px]">
            <label className="sl-label">To</label>
            <DatePickerCalendar
              name="draftEndDate"
              value={draftEndDate}
              onChange={(e) => {
                setDraftEndDate(e.target.value);
                setDateRangePreset("custom");
              }}
            />
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5">
            {activeTab === "invoices" && (
              <ColumnToggle
                columns={invoiceColumns}
                visibleColumns={visibleColumns}
                setVisibleColumns={setVisibleColumns}
              />
            )}
            <button
              onClick={handleClearFilters}
              className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink hover:bg-card rounded transition-colors border border-line"
            >
              Clear
            </button>
            <button onClick={handleApplyFilters} className="sl-btn-blue sl-pill-sm">
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* COMPACT KPI CARDS */}
      {supplierDetail && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="sl-tile p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                Opening
              </span>
              <FaMoneyBillWave className="text-ink-muted text-xs" />
            </div>
            <div className="text-lg tabular-nums font-bold text-ink mt-1">
              ₹{" "}
              {supplierDetail.summary.openingBalance.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-[11.5px] text-ink-subtle mt-0.5">Starting liability</div>
          </div>

          <div className="sl-tile p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                Invoiced
              </span>
              <FaBuilding className="text-[color:var(--color-warning)] text-xs" />
            </div>
            <div className="text-lg tabular-nums font-bold text-ink mt-1">
              ₹{" "}
              {supplierDetail.summary.totalBilled.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-[11.5px] text-ink-subtle mt-0.5">GRN bills posted</div>
          </div>

          <div className="sl-tile p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                Paid
              </span>
              <FaCheckCircle className="text-[color:var(--color-success)] text-xs" />
            </div>
            <div className="text-lg tabular-nums font-bold text-[color:var(--color-success)] mt-1">
              ₹{" "}
              {supplierDetail.summary.totalPaid.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-[11.5px] text-ink-subtle mt-0.5">Payments settled</div>
          </div>

          <div className="sl-tile p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                Outstanding
              </span>
              <FaExclamationTriangle className="text-[color:var(--color-warning)] text-xs" />
            </div>
            <div className="text-lg tabular-nums font-bold text-[color:var(--color-warning)] mt-1">
              ₹{" "}
              {supplierDetail.summary.closingBalance.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
            <div className="text-[11.5px] text-ink-subtle mt-0.5">Net balance due</div>
          </div>
        </div>
      )}

      {/* TABS & TABLE */}
      <div className="sl-tile overflow-hidden">
        <div className="flex items-center gap-1 border-b border-line bg-card-2 px-2">
          <button
            onClick={() => setActiveTab("invoices")}
            className={`flex items-center gap-1.5 px-3 py-2 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === "invoices"
                ? "border-[color:var(--color-warning)]/40 text-[color:var(--color-warning)]"
                : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            <FaFileInvoice className="text-[11.5px]" /> Invoices (
            {supplierDetail?.invoices?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("payments")}
            className={`flex items-center gap-1.5 px-3 py-2 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === "payments"
                ? "border-[color:var(--color-warning)]/40 text-[color:var(--color-warning)]"
                : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            <FaHistory className="text-[11.5px]" /> Payments (
            {supplierDetail?.paymentHistory?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("statement")}
            className={`flex items-center gap-1.5 px-3 py-2 font-semibold text-xs border-b-2 transition-colors ${
              activeTab === "statement"
                ? "border-[color:var(--color-warning)]/40 text-[color:var(--color-warning)]"
                : "border-transparent text-ink-subtle hover:text-ink"
            }`}
          >
            <FaList className="text-[11.5px]" /> Ledger (
            {supplierDetail?.statementEntries?.length || 0})
          </button>
        </div>

        {activeTab === "invoices" && (
          <DataTable
            columns={invoiceColumns.filter(
              (c) => typeof c.header === "string" && visibleColumns.includes(c.header)
            )}
            data={invoices}
            rowKey={(item: any) => item.id}
            loading={tableLoading}
            emptyMessage="No purchase invoices recorded for this supplier."
          />
        )}

        {activeTab === "payments" && (
          <DataTable
            columns={paymentColumns}
            data={payments}
            rowKey={(item: any) => item.id}
            loading={tableLoading}
            emptyMessage="No payment vouchers recorded for this supplier."
          />
        )}

        {activeTab === "statement" && (
          <DataTable
            columns={statementColumns}
            data={statements}
            rowKey={(item: any) => item.id}
            loading={tableLoading}
            emptyMessage="No ledger statement entries recorded for this supplier."
          />
        )}
      </div>
    </div>
  );
};

export default SupplierBreakdownPage;
