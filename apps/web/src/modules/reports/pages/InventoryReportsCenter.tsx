import React, { useState, useEffect, useMemo, useCallback } from "react";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { reportsService } from "../../../services/reportsService";
import { storeService } from "../../../services/storeService";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import ColumnToggle from "../../../components/ui/ColumnToggle/ColumnToggle";
import DataTable from "../../../components/ui/table/DataTable";
import type { DataTableColumn } from "../../../components/ui/table/DataTable";
import { useListCache } from "../../../hooks/useListCache";
import { usePermission } from "../../../hooks/usePermission";
import { Boxes, Play } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../../components/ui/v2";

const InventoryReportsCenter: React.FC = () => {
  const { can } = usePermission();
  // Filters state
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("");
  const [storeId, setStoreId] = useState("");
  const [search, setSearch] = useState("");

  const [draftDate, setDraftDate] = useState(date);
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftStoreId, setDraftStoreId] = useState(storeId);
  const [draftSearch, setDraftSearch] = useState(search);

  const [stores, setStores] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const LIMIT = 10;
  const [asOfDate, setAsOfDate] = useState("");

  const DEFAULT_COLUMNS = [
    "#",
    "DATE",
    "ITEM CODE",
    "ITEM NAME",
    "CATEGORY",
    "STORE",
    "START QTY",
    "EOD QTY",
  ];

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem("inventoryReportVisibleColumns");
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
    localStorage.setItem("inventoryReportVisibleColumns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    const loadStores = async () => {
      try {
        const res = await storeService.fetchAll();
        const storeArray = res.stores || res.data?.stores || res.data || res || [];
        setStores(Array.isArray(storeArray) ? storeArray : []);
      } catch (err) {
        console.error("Failed to load stores", err);
      }
    };
    loadStores();
  }, []);

  // Load report data via useListCache
  const cacheKey = `inventoryReport:${page}:${LIMIT}:${date}:${category}:${storeId}:${search}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const res = await reportsService.getInventoryReport({
        date,
        category,
        storeId,
        search,
        page,
        limit: LIMIT,
      });
      if (res.asOf) setAsOfDate(res.asOf);
      const data = res.data || [];
      let tot = data.length;
      if (res.pagination) {
        tot = res.pagination.total || tot;
      } else if (res.total) {
        tot = res.total;
      }
      return { data, total: tot };
    },
    [date, category, storeId, search, page]
  );

  const {
    data: backendReports,
    total,
    loading: loadingBackend,
    error: listError,
    refresh: retryList,
  } = useListCache({
    cacheKey,
    socketModule: "inventorySnapshot",
    fetcher,
  });

  const totalPages = Math.ceil((total || 0) / LIMIT) || 1;

  // CSV Data Configuration
  const { csvData, csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Item Code", accessor: (item: any) => item.itemCode },
      { header: "Item Name", accessor: (item: any) => item.itemName },
      { header: "Category", accessor: (item: any) => item.category },
      {
        header: "Store",
        accessor: (item: any) =>
          stores.find((s) => String(s.storeId) === String(item.storeId))?.storeName || item.storeId,
      },
      {
        header: "Date",
        accessor: (item: any) =>
          item.snapshotDate ? new Date(item.snapshotDate).toLocaleDateString() : "-",
      },
      {
        header: "Start Qty",
        accessor: (item: any) =>
          item.startQty !== null && item.startQty !== undefined && item.startQty !== ""
            ? `${item.startQty} ${item.uom ? item.uom.split(",")[0] : ""}`.trim()
            : "-",
      },
      {
        header: "EOD Qty",
        accessor: (item: any) =>
          item.eodQty !== null && item.eodQty !== undefined && item.eodQty !== ""
            ? `${item.eodQty} ${item.uom ? item.uom.split(",")[0] : ""}`.trim()
            : "-",
      },
    ];

    // For CSV, we ideally want all data, but here we just export the current page or loaded data
    return {
      csvData: backendReports,
      csvColumns: columns,
      csvFilename: `Inventory_Report_${date || asOfDate}.csv`,
    };
  }, [backendReports, date, asOfDate, stores]);

  const handleApplyFilters = () => {
    setDate(draftDate);
    setCategory(draftCategory);
    setStoreId(draftStoreId);
    setSearch(draftSearch);
    setPage(1);
  };

  const handleClearFilters = () => {
    setDraftDate("");
    setDraftCategory("");
    setDraftStoreId("");
    setDraftSearch("");

    setDate("");
    setCategory("");
    setStoreId("");
    setSearch("");
    setPage(1);
  };

  const tableColumns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "60px",
      render: (_item, index) => (page - 1) * 10 + index + 1,
    },
    {
      header: "DATE",
      render: (item: any) => (
        <span className="text-ink-subtle font-medium">
          {item.snapshotDate ? new Date(item.snapshotDate).toLocaleDateString() : "-"}
        </span>
      ),
    },
    {
      header: "ITEM CODE",
      render: (item: any) => <span className="font-semibold text-ink">{item.itemCode || "-"}</span>,
    },
    {
      header: "ITEM NAME",
      render: (item: any) => item.itemName || "-",
    },
    {
      header: "CATEGORY",
      render: (item: any) => <span className="text-sm font-medium">{item.category}</span>,
    },
    {
      header: "STORE",
      render: (item: any) => {
        const st = stores.find((s) => String(s.storeId) === String(item.storeId));
        return st ? st.storeName : item.storeId;
      },
    },

    {
      header: "START QTY",
      render: (item: any) => (
        <span className="text-ink-muted">
          {item.startQty !== null && item.startQty !== undefined && item.startQty !== ""
            ? `${item.startQty} ${item.uom ? item.uom.split(",")[0] : ""}`
            : "-"}
        </span>
      ),
    },
    {
      header: "EOD QTY",
      render: (item: any) => (
        <span className="text-ink font-semibold">
          {item.eodQty !== null && item.eodQty !== undefined && item.eodQty !== ""
            ? `${item.eodQty} ${item.uom ? item.uom.split(",")[0] : ""}`
            : "-"}
        </span>
      ),
    },
  ];

  const finalColumns = tableColumns.filter((c) => visibleColumns.includes(c.header as string));

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Inventory Reports"
        subtitle={
          asOfDate
            ? `Data as of: ${new Date(asOfDate).toLocaleDateString("en-IN")}`
            : "Opening and closing stock of every item, by snapshot date"
        }
        icon={<Boxes size={22} />}
        actions={
          can("inventory-reports.export") && (
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="sl-label">Snapshot Date</label>
            <DatePickerCalendar
              name="draftDate"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
            />
          </div>
          <div>
            <label className="sl-label">Category</label>
            <SelectInput
              name="draftCategory"
              value={draftCategory}
              options={[
                { label: "Raw Materials", value: "RAW_MATERIAL" },
                { label: "Finished Products", value: "FINISHED_PRODUCT" },
              ]}
              defaultOptionLabel="All Categories"
              hideLabel={true}
              onChange={(e) => setDraftCategory(e.target.value)}
            />
          </div>
          <div>
            <label className="sl-label">Store</label>
            <SelectInput
              name="draftStoreId"
              value={draftStoreId}
              options={stores.map((s) => ({
                label: s.storeName,
                value: (s.storeId || s.id || "").toString(),
              }))}
              defaultOptionLabel="All Stores"
              hideLabel={true}
              onChange={(e) => setDraftStoreId(e.target.value)}
            />
          </div>
          <div>
            <label className="sl-label">Search Item</label>
            <input
              type="text"
              className="sl-input h-11 w-full px-4"
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Search code or name..."
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
        rowKey={(row) => row.id || row.itemId || Math.random().toString()}
        loading={loadingBackend}
        pagination={{
          currentPage: page,
          totalPages: totalPages,
          onPageChange: setPage,
        }}
        emptyMessage="No inventory data found for the selected filters."
      />
    </div>
  );
};

export default InventoryReportsCenter;
