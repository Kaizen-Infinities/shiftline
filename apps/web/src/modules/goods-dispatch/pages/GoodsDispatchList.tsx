import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchGoodsDispatches,
  goodsDispatchCreated,
  goodsDispatchUpdated,
  goodsDispatchDeleted,
} from "../../../features/goods-dispatch/goodsDispatchSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { goodsDispatchService } from "../../../services/goodsDispatchService";
import type { DataTableColumn } from "../../../components/ui/table/DataTable";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { formatDate } from "../../../utils/dateUtils";
import { usePermission } from "../../../hooks/usePermission";
import { AlertCircle, Plus, Truck } from "lucide-react";
import { ActionPill, PageHeader, Tile, Toolbar } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 15;

const GoodsDispatchList: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const { dispatches, meta, loading, error } = useAppSelector((state) => state.goodsDispatch);

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Filter states (applied)
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Draft filter states (for popover)
  const [, setDraftFilterStatus] = useState("");
  const [draftFilterDateFrom, setDraftFilterDateFrom] = useState("");
  const [draftFilterDateTo, setDraftFilterDateTo] = useState("");

  const [currentPage, setCurrentPage] = useState(1);

  const hasActiveFilters = !!(filterStatus || filterDateFrom || filterDateTo);

  usePageShortcuts({
    onRefresh: () => dispatch(fetchGoodsDispatches({ page: currentPage, limit: ITEMS_PER_PAGE })),
  });

  // Handle search debouncing
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Backend-driven fetch
  useEffect(() => {
    dispatch(
      fetchGoodsDispatches({
        page: currentPage,
        limit: ITEMS_PER_PAGE,
        search: debouncedSearch,
        status: filterStatus || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
      })
    );
  }, [dispatch, currentPage, debouncedSearch, filterStatus, filterDateFrom, filterDateTo]);

  useSocketSync("goodsDispatch", {
    created: goodsDispatchCreated,
    updated: goodsDispatchUpdated,
    deleted: goodsDispatchDeleted,
  });

  const handleApplyFilters = () => {
    setFilterDateFrom(draftFilterDateFrom);
    setFilterDateTo(draftFilterDateTo);
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setDraftFilterStatus("");
    setDraftFilterDateFrom("");
    setDraftFilterDateTo("");
    setFilterStatus("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setCurrentPage(1);
  };

  const handleOpenFilter = () => {
    setDraftFilterStatus(filterStatus);
    setDraftFilterDateFrom(filterDateFrom);
    setDraftFilterDateTo(filterDateTo);
  };

  const fetchDispatchesForExport = useCallback(async () => {
    try {
      const res = await goodsDispatchService.fetchAll({ page: 1, limit: 100000 });
      const list = res?.dispatches || (Array.isArray(res) ? res : res?.data || []);
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // fallback
    }
    return Array.isArray(dispatches) ? dispatches : [];
  }, [dispatches]);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Dispatch No", accessor: (item: any) => item.dispatchNumber || "" },
      {
        header: "Date",
        accessor: (item: any) => (item.dispatchDate ? formatDate(item.dispatchDate) : ""),
      },
      { header: "Vehicle No", accessor: (item: any) => item.vehicleNumber || "" },
      { header: "Driver Name", accessor: (item: any) => item.driverName || "" },
      {
        header: "Destination Store",
        accessor: (item: any) => item.store?.storeName || item.destinationStoreId || "",
      },
      { header: "Total Items", accessor: (item: any) => item.items?.length || 0 },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Goods_Dispatch_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Stats computed from current filtered data on current page (showing what's on screen)
  // Or we could compute from allData if we had it. For now use meta totals.
  // const totalCount = meta?.total || 0;

  const STATUS_CHIPS = [
    { key: "", label: "All" },
    { key: "PENDING_GATE_APPROVAL", label: "Pending Gate" },
    { key: "PENDING_STORE_RECEIPT", label: "Pending Store" },
    { key: "WAREHOUSE_RECEIVED", label: "Received" },
    { key: "GATE_REJECTED", label: "Gate Rejected" },
    { key: "STORE_REJECTED", label: "Store Rejected" },
  ];

  const filtered = Boolean(hasActiveFilters || debouncedSearch);

  const columns: DataTableColumn<any>[] = [
    {
      header: "Dispatch No",
      accessor: "dispatchNumber",
      render: (item: any) =>
        can("goods-dispatch.view") ? (
          <button
            type="button"
            onClick={() => navigate(`/production/goods-dispatch/detail/${item.id}`)}
            className="font-semibold text-accent hover:underline underline-offset-4"
          >
            {item.dispatchNumber}
          </button>
        ) : (
          <span className="font-semibold text-ink">{item.dispatchNumber}</span>
        ),
    },
    {
      header: "Date",
      accessor: "dispatchDate",
      render: (item: any) => (
        <span className="text-ink-muted">{formatDate(item.dispatchDate)}</span>
      ),
    },
    {
      header: "Vehicle",
      accessor: "vehicleNumber",
      render: (item: any) => (
        <span className="font-mono text-sm text-ink">{item.vehicleNumber || "—"}</span>
      ),
    },
    {
      header: "Driver",
      accessor: "driverName",
      render: (item: any) => <span className="text-ink">{item.driverName || "—"}</span>,
    },
    {
      header: "Items",
      accessor: "items",
      align: "right",
      render: (item: any) => (
        <span className="tabular-nums text-ink-muted">{item.items?.length || 0} PO(s)</span>
      ),
    },
    {
      header: "Status",
      accessor: "status",
      render: (item: any) => <StatusBadge status={item.status} />,
    },
    {
      header: "Actions",
      accessor: "id",
      align: "right",
      render: (item: any) => (
        <div className="table-action-group w-full justify-end">
          {can("goods-dispatch.view") && (
            <ViewButton onClick={() => navigate(`/production/goods-dispatch/detail/${item.id}`)} />
          )}
          {item.status === "PENDING_GATE_APPROVAL" && can("goods-dispatch.edit") && (
            <EditButton
              onClick={() => navigate(`/production/goods-dispatch/gate-approval/${item.id}`)}
            />
          )}
          {item.status === "PENDING_STORE_RECEIPT" && can("goods-dispatch.edit") && (
            <EditButton
              onClick={() => navigate(`/production/goods-dispatch/store-approval/${item.id}`)}
            />
          )}
        </div>
      ),
    },
  ];

  const createCta = can("goods-dispatch.create") ? (
    <ActionPill
      icon={<Plus size={18} />}
      onClick={() => navigate("/production/goods-dispatch/create")}
    >
      Create Dispatch
    </ActionPill>
  ) : null;

  return (
    <div>
      <div className="w-full min-w-0">
        <PageHeader
          title="Goods dispatch"
          subtitle="Manage finished goods dispatches to warehouse"
          icon={<Truck size={22} />}
          actions={
            can("goods-dispatch.export") ? (
              <ExportCSVButton
                fetchData={fetchDispatchesForExport}
                columns={csvColumns}
                filename={csvFilename}
                text="Export"
              />
            ) : null
          }
          primaryAction={createCta}
        />

        <Toolbar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search by Dispatch No, Vehicle, Driver..."
          searchLabel="Search dispatches"
          filters={STATUS_CHIPS}
          filterValue={filterStatus}
          onFilterChange={(key) => {
            setFilterStatus(key);
            setDraftFilterStatus(key);
            setCurrentPage(1);
          }}
          filtersLabel="Status"
          right={
            <FilterPopover
              activeFilterCount={[filterDateFrom, filterDateTo].filter(Boolean).length}
              hasActiveFilters={Boolean(filterDateFrom || filterDateTo)}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
              onOpen={handleOpenFilter}
            >
              <div className="space-y-3">
                <DatePickerCalendar
                  label="Date From"
                  name="dateFrom"
                  value={draftFilterDateFrom}
                  onChange={(e) => setDraftFilterDateFrom(e.target.value)}
                  placeholder="Select date"
                />
                <DatePickerCalendar
                  label="Date To"
                  name="dateTo"
                  value={draftFilterDateTo}
                  onChange={(e) => setDraftFilterDateTo(e.target.value)}
                  placeholder="Select date"
                />
              </div>
            </FilterPopover>
          }
        />

        {error && (
          <Tile className="mb-4 flex items-center gap-3">
            <AlertCircle
              size={18}
              className="shrink-0 text-[color:var(--color-danger)]"
              aria-hidden="true"
            />
            <p role="alert" className="m-0 text-sm font-semibold text-ink">
              Could not load dispatches. Press F5 to retry.
            </p>
          </Tile>
        )}

        <DataTable
          columns={columns}
          data={dispatches || []}
          loading={loading}
          rowKey={(item) => item.id.toString()}
          ariaLabel="Goods dispatches"
          emptyMessage={filtered ? "No dispatches match these filters." : "No dispatches found"}
          emptyAction={
            filtered ? (
              <ActionPill
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  handleClearFilters();
                }}
              >
                Clear filters
              </ActionPill>
            ) : (
              createCta
            )
          }
          pagination={
            meta && meta.totalPages > 1
              ? {
                  currentPage,
                  totalPages: meta.totalPages,
                  onPageChange: handlePageChange,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
};

export default GoodsDispatchList;
