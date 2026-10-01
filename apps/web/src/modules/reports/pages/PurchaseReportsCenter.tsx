import React, { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "react-toastify";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { reportsService } from "../../../services/reportsService";
import { supplierService } from "../../../services/supplierService";
import { DATE_RANGE_OPTIONS } from "../../../constants/selectOption";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import ColumnToggle from "../../../components/ui/ColumnToggle/ColumnToggle";
import type { DataTableColumn } from "../../../components/ui/table/DataTable";
import DataTable from "../../../components/ui/table/DataTable";
import { useListCache } from "../../../hooks/useListCache";
import { usePermission } from "../../../hooks/usePermission";
import { ShoppingCart, Play } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../../components/ui/v2";

const PurchaseReportsCenter: React.FC = () => {
  const { can } = usePermission();
  // Filters state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [status, setStatus] = useState("");

  const [draftStartDate, setDraftStartDate] = useState(startDate);
  const [draftEndDate, setDraftEndDate] = useState(endDate);
  const [dateRangePreset, setDateRangePreset] = useState("custom");
  const [draftPoNumber, setDraftPoNumber] = useState(poNumber);
  const [draftSupplierId, setDraftSupplierId] = useState(supplierId);
  const [draftStatus, setDraftStatus] = useState(status);

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const LIMIT = 10;

  const DEFAULT_COLUMNS = [
    "#",
    "PO NUMBER",
    "PO DATE",
    "DELIVERY DATE",
    "SUPPLIER",
    "BILLING ADDRESS",
    "SHIPPING ADDRESS",
    "ITEMS (QTY)",
    "TAXES",
    "DISCOUNT",
    "NET AMOUNT",
    "STATUS",
  ];

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem("purchaseReportVisibleColumns");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_COLUMNS;
      }
    }
    return DEFAULT_COLUMNS;
  });

  useEffect(() => {
    localStorage.setItem("purchaseReportVisibleColumns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const res = await supplierService.fetchAll();
        setSuppliers(res || []);
      } catch (err) {
        console.error("Failed to load suppliers", err);
      }
    };
    loadSuppliers();
  }, []);

  // Load report data via useListCache
  const cacheKey = `purchaseReport:${page}:${LIMIT}:${startDate}:${endDate}:${poNumber}:${supplierId}:${status}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const res = await reportsService.getPurchaseOrderReport({
        startDate,
        endDate,
        poNumber,
        supplierId,
        status,
        page,
        limit: LIMIT,
      });
      const data = res?.data?.data || [];
      const tp = res?.data?.totalPages || 1;
      return { data, total: tp * LIMIT };
    },
    [startDate, endDate, poNumber, supplierId, status, page]
  );

  const {
    data: backendReports,
    total,
    loading: loadingBackend,
    error: listError,
    refresh: retryList,
  } = useListCache({
    cacheKey,
    socketModule: "purchaseOrder",
    fetcher,
  });

  const totalPages = Math.ceil((total || 0) / LIMIT) || 1;

  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "PO NUMBER", accessor: (item: any) => item.poNumber },
      { header: "PO DATE", accessor: (item: any) => item.poDate?.split("T")[0] },
      {
        header: "DELIVERY DATE",
        accessor: (item: any) => item.expectedDeliveryDate?.split("T")[0],
      },
      { header: "SUPPLIER", accessor: (item: any) => item.supplierName },
      { header: "BILLING ADDRESS", accessor: (item: any) => item.billingAddress },
      { header: "SHIPPING ADDRESS", accessor: (item: any) => item.shippingAddress },
      { header: "ITEMS (QTY)", accessor: (item: any) => item.itemsCount },
      {
        header: "TAXES",
        accessor: (item: any) =>
          (item.totalCgst || 0) + (item.totalSgst || 0) + (item.totalIgst || 0),
      },
      { header: "DISCOUNT", accessor: (item: any) => item.totalDiscount },
      { header: "NET AMOUNT", accessor: (item: any) => item.netAmount },
      { header: "STATUS", accessor: (item: any) => item.status },
    ];
    return {
      csvData: backendReports,
      csvColumns: columns,
      csvFilename: `Purchase_Order_Report_${startDate}_${endDate}.csv`,
    };
  }, [backendReports, startDate, endDate]);

  const handleApplyFilters = () => {
    if (draftStartDate && draftEndDate && new Date(draftStartDate) > new Date(draftEndDate)) {
      toast.error("Start Date cannot be after End Date");
      return;
    }

    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setPoNumber(draftPoNumber);
    setSupplierId(draftSupplierId);
    setStatus(draftStatus);
    setPage(1);
  };

  const handleClearFilters = () => {
    setDraftStartDate("");
    setDraftEndDate("");
    setDateRangePreset("custom");
    setDraftPoNumber("");
    setDraftSupplierId("");
    setDraftStatus("");

    setStartDate("");
    setEndDate("");
    setPoNumber("");
    setSupplierId("");
    setStatus("");
    setPage(1);
  };

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

  const tableColumns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "60px",
      render: (_item, index) => index + 1,
    },
    {
      header: "PO NUMBER",
      render: (item: any) => <span className="font-semibold text-ink">{item.poNumber || "-"}</span>,
    },
    {
      header: "PO DATE",
      render: (item: any) =>
        item.poDate
          ? new Date(item.poDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })
          : "-",
    },
    {
      header: "DELIVERY DATE",
      render: (item: any) =>
        item.expectedDeliveryDate
          ? new Date(item.expectedDeliveryDate).toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })
          : "-",
    },
    {
      header: "SUPPLIER",
      render: (item: any) => (
        <div>
          <div className="font-semibold">{item.supplierName || "N/A"}</div>
          <div className="text-[10px] text-ink-subtle">{item.supplierCode || "-"}</div>
        </div>
      ),
    },
    {
      header: "BILLING ADDRESS",
      render: (item: any) => (
        <div className="text-xs max-w-[200px]" title={item.billingAddress}>
          {item.billingAddress || "-"}
        </div>
      ),
    },
    {
      header: "SHIPPING ADDRESS",
      render: (item: any) => (
        <div className="text-xs max-w-[200px]" title={item.shippingAddress}>
          {item.shippingAddress || "-"}
        </div>
      ),
    },
    {
      header: "ITEMS (QTY)",
      render: (item: any) => (
        <div className="text-xs max-w-[250px]">
          {item.items && item.items.length > 0
            ? item.items.map((i: any, idx: number) => (
                <div key={idx}>
                  {i.productId} ({i.quantity} {i.uom})
                </div>
              ))
            : "-"}
        </div>
      ),
    },
    {
      header: "TAXES",
      render: (item: any) => (
        <div className="text-xs">
          <div>CGST: ₹{item.totalCgst || 0}</div>
          <div>SGST: ₹{item.totalSgst || 0}</div>
          <div>IGST: ₹{item.totalIgst || 0}</div>
        </div>
      ),
    },
    {
      header: "DISCOUNT",
      render: (item: any) =>
        `₹${(item.totalDiscount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      header: "NET AMOUNT",
      render: (item: any) =>
        `₹${(item.netAmount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    },
    {
      header: "STATUS",
      render: (item: any) => <StatusBadge status={item.status} />,
    },
  ];

  const finalColumns = tableColumns.filter((c) => visibleColumns.includes(c.header));

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Purchase reports"
        subtitle="Purchase orders by period, supplier and status"
        icon={<ShoppingCart size={22} />}
        actions={
          can("purchase-reports.export") && (
            <ExportCSVButton
              data={csvData}
              columns={csvColumns.filter((c) =>
                visibleColumns.map((v) => v.toLowerCase()).includes(c.header.toLowerCase())
              )}
              filename={csvFilename}
              text="Export CSV"
            />
          )
        }
      />

      <Tile className="mb-4" title="Filters" subtitle="Set the filters, then run the report">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <div>
            <label className="sl-label">Date Range</label>
            <SelectInput
              name="dateRangePreset"
              ariaLabel="Date range"
              value={dateRangePreset}
              options={DATE_RANGE_OPTIONS}
              hideLabel={true}
              onChange={(e) => handleDateRangeChange(e.target.value)}
            />
          </div>
          <div>
            <label className="sl-label">Start Date</label>
            <DatePickerCalendar
              name="draftStartDate"
              ariaLabel="Start date"
              value={draftStartDate}
              onChange={(e) => {
                setDraftStartDate(e.target.value);
                setDateRangePreset("custom");
              }}
            />
          </div>
          <div>
            <label className="sl-label">End Date</label>
            <DatePickerCalendar
              name="draftEndDate"
              ariaLabel="End date"
              value={draftEndDate}
              onChange={(e) => {
                setDraftEndDate(e.target.value);
                setDateRangePreset("custom");
              }}
            />
          </div>
          <div>
            <label htmlFor="purchase-report-po-no" className="sl-label">
              PO No
            </label>
            <input
              id="purchase-report-po-no"
              type="text"
              className="sl-input h-11 w-full px-4"
              value={draftPoNumber}
              onChange={(e) => setDraftPoNumber(e.target.value)}
              placeholder="Search PO No..."
            />
          </div>
          <div>
            <label className="sl-label">Supplier</label>
            <SelectInput
              name="draftSupplierId"
              ariaLabel="Supplier"
              value={draftSupplierId}
              options={suppliers.map((s) => ({ label: s.displayName, value: s.id.toString() }))}
              defaultOptionLabel="All Suppliers"
              hideLabel={true}
              searchable
              onChange={(e) => setDraftSupplierId(e.target.value)}
            />
          </div>
          <div>
            <label className="sl-label">Status</label>
            <SelectInput
              name="draftStatus"
              ariaLabel="Status"
              value={draftStatus}
              options={[
                { label: "Draft", value: "DRAFT" },
                { label: "Pending", value: "PENDING" },
                { label: "Open", value: "OPEN" },
                { label: "Approved", value: "APPROVED" },
                { label: "Rejected", value: "REJECTED" },
                { label: "Partially Received", value: "PARTIALLY_RECEIVED" },
                { label: "Received", value: "RECEIVED" },
                { label: "Completed", value: "COMPLETED" },
                { label: "Closed", value: "CLOSED" },
                { label: "Cancelled", value: "CANCELLED" },
              ]}
              defaultOptionLabel="All Statuses"
              hideLabel={true}
              onChange={(e) => setDraftStatus(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
          <div>
            <ColumnToggle
              columns={tableColumns}
              visibleColumns={visibleColumns}
              setVisibleColumns={setVisibleColumns}
            />
          </div>
          <div className="flex items-center gap-3">
            <ActionPill variant="secondary" size="sm" onClick={handleClearFilters}>
              Clear All
            </ActionPill>
            <ActionPill
              variant="blue"
              size="sm"
              icon={<Play size={14} />}
              onClick={handleApplyFilters}
            >
              Run report
            </ActionPill>
          </div>
        </div>
      </Tile>

      <DataTable
        columns={finalColumns}
        data={backendReports}
        error={listError}
        sourceRowCount={backendReports.length}
        onRetry={retryList}
        rowKey={(item: any) => item.id || item.poNumber}
        loading={loadingBackend}
        emptyMessage="No purchase order data found in date range."
        pagination={{
          currentPage: page,
          totalPages: totalPages,
          onPageChange: (newPage) => setPage(newPage),
        }}
      />
    </div>
  );
};

export default PurchaseReportsCenter;
