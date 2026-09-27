import React, { useState, useEffect, useCallback } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useListCache, markStaleByPrefix } from "../../../hooks/useListCache";
import { stockAdjustmentService } from "../../../services/stockAdjustmentService";
import { usePermission } from "../../../hooks/usePermission";
import { Search } from "lucide-react";
import DataTable from "../../../components/ui/table/DataTable";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { formatDate } from "../../../utils/dateUtils";
import { ArrowUpDown, Plus } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar } from "../../../components/ui/v2";
import { qty } from "../../stock/lib/format";

const ITEMS_PER_PAGE = 15;

const getReasonLabel = (reasonStr?: string) => {
  if (!reasonStr) return "";
  const REASONS: Record<string, string> = {
    PHYSICAL_COUNT_VARIANCE: "Physical Count Variance",
    DAMAGED_GOODS: "Damaged Goods",
    EXPIRED_STOCK: "Expired Stock",
    PRODUCTION_CONSUMPTION: "Production Consumption",
    SUPPLIER_RETURN: "Supplier Return",
    CUSTOMER_RETURN: "Customer Return",
    WASTAGE: "Wastage",
    SCRAP: "Scrap",
    OPENING_STOCK: "Opening Stock",
    MANUAL_CORRECTION: "Manual Correction",
    OTHER: "Other",
  };
  return REASONS[reasonStr] || reasonStr;
};

const getAdjustmentDisplayReason = (item: any) => {
  const firstItem = item.items?.[0];

  if (firstItem?.remarks && firstItem.remarks.trim()) {
    const parts = firstItem.remarks.trim().split(" - ");
    return parts[0];
  }

  if (firstItem?.reason && firstItem.reason.trim()) {
    return getReasonLabel(firstItem.reason.trim());
  }

  if (item.remarks && item.remarks.trim()) {
    const parts = item.remarks.trim().split(" - ");
    return parts[0];
  }

  if (item.reason && item.reason.trim()) {
    const r = item.reason.trim();
    const label = getReasonLabel(r);
    if (label !== r || r.toLowerCase() === "other") {
      return label;
    }
  }

  return "—";
};

const getStockAdjustmentTypeInfo = (item: any) => {
  const diff = Number(item.items?.[0]?.difference || 0);
  const type = item.adjustmentType || "";

  if (diff < 0) {
    return { label: "Stock Decrease", variant: "danger" };
  }
  if (diff > 0) {
    return { label: "Stock Increase", variant: "success" };
  }

  if (
    type === "STOCK_DECREASE" ||
    type === "DAMAGE" ||
    type === "SCRAP" ||
    type === "PRODUCTION_MATERIAL_ISSUE"
  ) {
    return { label: "Stock Decrease", variant: "danger" };
  }

  return { label: "Stock Increase", variant: "success" };
};

const NEUTRAL_CHIP_CLASS = "border border-line bg-card-2 text-ink-muted";

const getStockAdjustmentSourceInfo = (item: any) => {
  const poId = item.productionOrderId;
  const srcDoc = (item.sourceDocument || "").toLowerCase();
  const type = (item.adjustmentType || "").toLowerCase();

  if (
    poId ||
    type.includes("production") ||
    type.includes("pmi") ||
    srcDoc.includes("prod") ||
    srcDoc.includes("pmi")
  ) {
    return {
      module: "Production",
      detail: poId ? `PO: ${poId}` : item.sourceDocId ? `#${item.sourceDocId}` : "",
      badgeClass: NEUTRAL_CHIP_CLASS,
    };
  }

  if (srcDoc.includes("purchase") || srcDoc.includes("grn") || srcDoc.includes("po-rec")) {
    return {
      module: "Purchase",
      detail: item.sourceDocId ? `#${item.sourceDocId}` : "",
      badgeClass: NEUTRAL_CHIP_CLASS,
    };
  }

  if (srcDoc.includes("sales") || srcDoc.includes("so") || srcDoc.includes("dispatch")) {
    return {
      module: "Sales",
      detail: item.sourceDocId ? `#${item.sourceDocId}` : "",
      badgeClass: NEUTRAL_CHIP_CLASS,
    };
  }

  return {
    module: "Manual",
    detail: "",
    badgeClass: NEUTRAL_CHIP_CLASS,
  };
};

const getPrimaryUom = (uomStr?: string) => {
  if (!uomStr) return "";
  const first = uomStr.split(",")[0].trim();
  const l = first.toLowerCase();
  if (l === "ea" || l === "each" || l === "piece" || l === "pcs") return "pcs";
  return first;
};

const getItemPrimaryUom = (item: any) => {
  if (!item) return "";
  if (item.uom) {
    const raw =
      typeof item.uom === "object"
        ? item.uom.uomCode || item.uom.uomName || item.uom.code || item.uom.name
        : String(item.uom);
    if (raw) return getPrimaryUom(raw);
  }
  const isProduct =
    item.itemType === "PRODUCT" ||
    item.itemType === "FINISHED_GOODS" ||
    !!item.product ||
    !!item.productItemId;
  if (isProduct) {
    const pUom = item.product?.uom;
    const prodUom =
      typeof pUom === "object"
        ? pUom.uomCode || pUom.uomName || pUom.code || pUom.name
        : pUom || item.product?.baseUom || item.product?.unit;
    if (prodUom) return getPrimaryUom(String(prodUom));
    return "pcs";
  }
  const rmUom = item.rawMaterial?.baseUom || item.rawMaterial?.uom;
  if (rmUom) return getPrimaryUom(String(rmUom));
  return "";
};

const SA_CACHE_PREFIX = "stockAdjustments:";

const StockAdjustmentList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [adjustmentType, setAdjustmentType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // Draft filter states for popover
  const [draftStatus, setDraftStatus] = useState("");
  const [draftAdjustmentType, setDraftAdjustmentType] = useState("");
  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");

  const hasActiveFilters = !!(status || adjustmentType || dateFrom || dateTo);

  // Debounce search — 300 ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const cacheKey = `${SA_CACHE_PREFIX}${currentPage}:${ITEMS_PER_PAGE}:${debouncedSearch}:${status}:${adjustmentType}:${dateFrom}:${dateTo}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const res = await stockAdjustmentService.fetchAll({
        search: debouncedSearch,
        status,
        adjustmentType,
        dateFrom,
        dateTo,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      });
      const list = Array.isArray(res) ? res : res.data || [];
      const tot = Array.isArray(res) ? res.length : res.meta?.total || res.total || list.length;
      return { data: list, total: tot };
    },
    [debouncedSearch, status, adjustmentType, dateFrom, dateTo, currentPage]
  );

  const { data, total, loading, refresh } = useListCache({
    cacheKey,
    socketModule: "stockAdjustment",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh() });

  const handleOpenFilter = useCallback(() => {
    setDraftStatus(status);
    setDraftAdjustmentType(adjustmentType);
    setDraftDateFrom(dateFrom);
    setDraftDateTo(dateTo);
  }, [status, adjustmentType, dateFrom, dateTo]);

  const handleApplyFilters = useCallback(() => {
    setStatus(draftStatus);
    setAdjustmentType(draftAdjustmentType);
    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setCurrentPage(1);
  }, [draftStatus, draftAdjustmentType, draftDateFrom, draftDateTo]);

  const handleClearFilters = useCallback(() => {
    setDraftStatus("");
    setDraftAdjustmentType("");
    setDraftDateFrom("");
    setDraftDateTo("");
    setStatus("");
    setAdjustmentType("");
    setDateFrom("");
    setDateTo("");
    setCurrentPage(1);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteId || isDeleting) return;
    setIsDeleting(true);
    try {
      await stockAdjustmentService.delete(deleteId);
      toast.success("Stock Adjustment deleted successfully");
      setDeleteId(null);
      markStaleByPrefix(SA_CACHE_PREFIX);
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete stock adjustment");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteId, isDeleting, refresh]);

  const totalPages = Math.ceil((total || 0) / ITEMS_PER_PAGE) || 1;

  const STATUS_CHIPS = [
    { key: "", label: "All" },
    { key: "DRAFT", label: "Draft" },
    { key: "PENDING_APPROVAL", label: "Pending Approval" },
    { key: "APPROVED", label: "Approved" },
    { key: "REJECTED", label: "Rejected" },
  ];

  const createCta = can("stock-adjustments.create") ? (
    <ActionPill
      icon={<Plus size={18} />}
      onClick={() => navigate("/inventory/stock-adjustments/create")}
    >
      New Adjustment
    </ActionPill>
  ) : null;

  const filtered = Boolean(hasActiveFilters || debouncedSearch);

  const moreLines = (item: any) =>
    item.items && item.items.length > 1 ? (
      <div className="mt-0.5 text-[11px] text-ink-subtle">+{item.items.length - 1} more</div>
    ) : null;

  return (
    <div>
      <div className="w-full min-w-0">
        <PageHeader
          title="Stock Adjustments"
          subtitle={`${total || 0} adjustments · issues, returns, corrections and write-offs`}
          icon={<ArrowUpDown size={22} />}
          primaryAction={createCta}
        />

        <Toolbar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search by No, Reason, PO..."
          searchLabel="Search stock adjustments"
          filters={STATUS_CHIPS}
          filterValue={status}
          onFilterChange={(key) => {
            setStatus(key);
            setDraftStatus(key);
            setCurrentPage(1);
          }}
          filtersLabel="Status"
          right={
            <FilterPopover
              activeFilterCount={[adjustmentType, dateFrom, dateTo].filter(Boolean).length}
              hasActiveFilters={Boolean(adjustmentType || dateFrom || dateTo)}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
              onOpen={handleOpenFilter}
            >
              <div className="space-y-3">
                <SelectInput
                  label="Adjustment Type"
                  name="draftAdjustmentType"
                  value={draftAdjustmentType}
                  onChange={(e) => setDraftAdjustmentType(e.target.value)}
                  options={[
                    { value: "PRODUCTION_MATERIAL_ISSUE", label: "Production Material Issue" },
                    { value: "PRODUCTION_MATERIAL_RETURN", label: "Production Material Return" },
                    { value: "STOCK_INCREASE", label: "Stock Increase" },
                    { value: "STOCK_DECREASE", label: "Stock Decrease" },
                    { value: "DAMAGE", label: "Damage" },
                    { value: "SCRAP", label: "Scrap" },
                    { value: "OPENING_STOCK", label: "Opening Stock" },
                    { value: "MANUAL_CORRECTION", label: "Manual Correction" },
                    { value: "OTHER", label: "Other" },
                  ]}
                  defaultOptionLabel="All Types"
                  noMargin
                />
                <DatePickerCalendar
                  label="From Date"
                  name="fromDate"
                  value={draftDateFrom}
                  maxDate={draftDateTo || undefined}
                  onChange={(e) => setDraftDateFrom(e.target.value)}
                />
                <DatePickerCalendar
                  label="To Date"
                  name="toDate"
                  value={draftDateTo}
                  minDate={draftDateFrom || undefined}
                  onChange={(e) => setDraftDateTo(e.target.value)}
                />
              </div>
            </FilterPopover>
          }
        />

        <DataTable
          data={data || []}
          rowKey={(item) => item.id}
          loading={loading}
          ariaLabel="Stock adjustments"
          emptyMessage={
            filtered ? "No adjustments match these filters." : "No stock adjustments found."
          }
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
            totalPages > 1
              ? { currentPage, totalPages, onPageChange: (page) => setCurrentPage(page) }
              : undefined
          }
          columns={[
            {
              header: "Adjustment no",
              accessor: "adjustmentNumber",
              render: (item) => (
                <div>
                  <button
                    type="button"
                    onClick={() => navigate(`/inventory/stock-adjustments/view/${item.id}`)}
                    className="font-semibold text-accent hover:underline underline-offset-4"
                  >
                    {item.adjustmentNumber}
                  </button>
                  <div className="text-xs text-ink-subtle">{formatDate(item.adjustmentDate)}</div>
                </div>
              ),
            },
            {
              header: "Type",
              render: (item) => {
                const info = getStockAdjustmentTypeInfo(item);
                return (
                  <Chip
                    size="sm"
                    tone={info.variant === "success" ? "success" : "danger"}
                    className="whitespace-nowrap"
                  >
                    {info.label}
                  </Chip>
                );
              },
            },
            {
              header: "Source",
              render: (item) => {
                const src = getStockAdjustmentSourceInfo(item);
                return (
                  <div>
                    <Chip size="sm" tone="muted">
                      {src.module}
                    </Chip>
                    {src.detail && (
                      <div className="mt-0.5 font-mono text-xs text-ink-subtle">{src.detail}</div>
                    )}
                  </div>
                );
              },
            },
            {
              header: "Item",
              render: (item) => {
                const product = item.productionOrder?.productItem || item.items?.[0]?.product;
                const rawMaterial = item.items?.[0]?.rawMaterial;
                if (product?.productName) {
                  return (
                    <div>
                      <div className="font-semibold text-ink">{product.productName}</div>
                      <div className="font-mono text-xs text-ink-subtle">{product.productCode}</div>
                      {moreLines(item)}
                    </div>
                  );
                }
                if (rawMaterial?.materialName) {
                  return (
                    <div>
                      <div className="font-semibold text-ink">{rawMaterial.materialName}</div>
                      {moreLines(item)}
                    </div>
                  );
                }
                return <span className="text-ink-subtle">—</span>;
              },
            },
            {
              header: "Original qty",
              align: "right",
              render: (item) => {
                const firstItem = item.items?.[0];
                if (!firstItem || firstItem.currentQty == null)
                  return <span className="text-ink-subtle">—</span>;
                const primaryUom = getItemPrimaryUom(firstItem);
                return (
                  <span className="tabular-nums text-ink-muted">
                    {qty(firstItem.currentQty)}
                    {primaryUom ? ` ${primaryUom}` : ""}
                  </span>
                );
              },
            },
            {
              header: "Adjusted qty",
              align: "right",
              render: (item) => {
                const firstItem = item.items?.[0];
                if (!firstItem || firstItem.adjustedQty == null)
                  return <span className="text-ink-subtle">—</span>;
                const diff = Number(firstItem.difference || 0);
                const primaryUom = getItemPrimaryUom(firstItem);
                const uomStr = primaryUom ? ` ${primaryUom}` : "";
                return (
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums text-ink">
                      {qty(firstItem.adjustedQty)}
                      {uomStr}
                    </span>
                    {diff !== 0 && (
                      <Chip
                        size="sm"
                        tone={diff > 0 ? "success" : "danger"}
                        className="tabular-nums"
                      >
                        {diff > 0 ? "+" : ""}
                        {qty(diff)}
                        {uomStr}
                      </Chip>
                    )}
                  </div>
                );
              },
            },
            {
              header: "Reason",
              render: (item) => {
                const firstItem = item.items?.[0];
                const displayReason = getAdjustmentDisplayReason(item);
                const fullTooltip = firstItem?.remarks || displayReason;
                return (
                  <span title={fullTooltip} className="block max-w-[220px] truncate text-ink-muted">
                    {displayReason}
                  </span>
                );
              },
            },
            {
              header: "Actions",
              align: "right",
              render: (item: any) => (
                <div
                  className="table-action-group w-full justify-end"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ViewButton
                    onClick={() => navigate(`/inventory/stock-adjustments/view/${item.id}`)}
                  />
                  {can("stock-adjustments.delete") && item.status !== "APPROVED" && (
                    <DeleteButton onClick={() => setDeleteId(String(item.id))} />
                  )}
                </div>
              ),
            },
          ]}
        />

        <CommonConfirmModal
          isOpen={!!deleteId}
          onClose={() => setDeleteId(null)}
          onConfirm={handleDeleteConfirm}
          title="Delete Stock Adjustment"
          message="Are you sure you want to delete this stock adjustment? This action cannot be undone."
          isDangerous
          isLoading={isDeleting}
        />
      </div>
    </div>
  );
};

export default StockAdjustmentList;
