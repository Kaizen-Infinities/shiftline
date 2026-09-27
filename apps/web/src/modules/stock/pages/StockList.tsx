import React, { useState, useCallback, useEffect } from "react";
import { useListCache } from "../../../hooks/useListCache";
import { rawMaterialStockService } from "../../../services/rawMaterialStockService";
import { useSocketSync } from "../../../hooks/useSocketSync";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import { formatLocationAddress } from "../../../utils/addressUtils";
import { categoryService } from "../../../services/categoryService";
import { usePermission } from "../../../hooks/usePermission";
import { Layers } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 20;

interface StockListProps {
  storeId?: string;
}

const parseBaseUom = (uomStr?: string) => {
  if (!uomStr) return { primary: "N/A", secondary: "None", list: [] };
  const list = uomStr
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  if (list.length === 0) return { primary: "N/A", secondary: "None", list: [] };
  const primary = list[0];
  const secondaryList = list.slice(1);
  const secondary = secondaryList.length > 0 ? secondaryList.join(", ") : "None";
  return { primary, secondary, list };
};

const StockList: React.FC<StockListProps> = ({ storeId: propStoreId }) => {
  const { can } = usePermission();

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const activeStoreId = propStoreId ?? "";
  const [currentPage, setCurrentPage] = useState(1);
  const [showView, setShowView] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const [, setCategoryFilter] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");
  const [, setStatusFilter] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);

  const fetchCategoriesData = useCallback(async () => {
    try {
      const res = await categoryService.fetchAll({ type: "RAW_MATERIAL", isActive: true });
      const list = res?.categories ?? (Array.isArray(res) ? res : []);
      setCategoryOptions(
        list.map((c: any) => ({ value: String(c.id), label: c.name || c.categoryName || c.code }))
      );
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchCategoriesData();
  }, [fetchCategoriesData]);

  // Debounce search — 300 ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const cacheKey = `rawMaterialStock:${currentPage}:${ITEMS_PER_PAGE}:${debouncedSearch}:${activeStoreId}:${appliedCategory}:${appliedStatus}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const res = await rawMaterialStockService.fetchAll({
        search: debouncedSearch || undefined,
        storeId: activeStoreId || undefined,
        storeCategory: "RAW_MATERIAL",
        itemType: "RAW_MATERIAL",
        categoryId: appliedCategory || undefined,
        status: appliedStatus || undefined,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      });
      return { data: res.data || [], total: res.total || 0 };
    },
    [debouncedSearch, activeStoreId, appliedCategory, appliedStatus, currentPage]
  );

  const { data, total, loading } = useListCache({
    cacheKey,
    socketModule: "rawMaterialStock",
    fetcher,
  });

  const totalPages = Math.ceil((total || 0) / ITEMS_PER_PAGE) || 1;

  // Re-fetch category filter options whenever a category is created/updated/deleted
  useSocketSync("category", undefined, fetchCategoriesData);

  const hasActiveFilters = !!(appliedCategory || appliedStatus);
  const handleClearFilters = useCallback(() => {
    setCategoryFilter("");
    setAppliedCategory("");
    setStatusFilter("");
    setAppliedStatus("");
    setCurrentPage(1);
  }, []);

  const handleOpenView = useCallback((item: any) => {
    setSelectedItem(item);
    setShowView(true);
  }, []);

  const formatExportQty = (qty: any, uom: string) => {
    const num = Number(qty) || 0;
    let primaryUom = uom ? uom.split(",")[0] : "";
    if (primaryUom.toLowerCase() === "ea") primaryUom = "PCS";
    const displayNum = Number(num.toFixed(3)).toString();
    return `${displayNum} ${primaryUom}`;
  };

  const formatDisplayQty = (qty: any, uom: string, prefix = "") => {
    const num = Number(qty) || 0;
    let primaryUom = uom ? uom.split(",")[0] : "";
    if (primaryUom.toLowerCase() === "ea") primaryUom = "PCS";
    const displayNum = num.toLocaleString("en-IN", { maximumFractionDigits: 3 });
    return (
      <>
        {prefix}
        {displayNum} {primaryUom}
      </>
    );
  };

  const exportColumns = [
    {
      header: "NAME",
      accessor: (item: any) => (item as any).materialName || item.rawMaterial?.materialName || "-",
    },
    { header: "ID", accessor: (item: any) => item.rawMaterialId || "-" },
    {
      header: "CATEGORY",
      accessor: (item: any) =>
        (item as any).category?.name || item.rawMaterial?.category?.name || "-",
    },
    { header: "STORE", accessor: (item: any) => item.store?.storeName || item.storeId || "-" },
    {
      header: "LOCATION",
      accessor: (item: any) => (item as any).storeLocation?.locationCode || item.locationId || "-",
    },
    {
      header: "PHYSICAL STOCK",
      accessor: (item: any) =>
        formatExportQty(
          item.onHandQty ?? 0,
          (item as any).baseUom || item.rawMaterial?.baseUom || ""
        ),
    },
    {
      header: "MIN STOCK",
      accessor: (item: any) =>
        formatExportQty(Number((item as any).minimumStock || 0), (item as any).baseUom || ""),
    },
    {
      header: "RESERVED",
      accessor: (item: any) => formatExportQty(item.reservedQty ?? 0, (item as any).baseUom || ""),
    },
    {
      header: "AVAILABLE",
      accessor: (item: any) =>
        formatExportQty(
          Number(item.onHandQty ?? 0) - Number(item.reservedQty ?? 0),
          (item as any).baseUom || ""
        ),
    },
    { header: "STATUS", accessor: (item: any) => item.status || "Active" },
  ];

  const levelOf = (item: any): "low" | "reorder" | "ok" => {
    const available = Number(item.onHandQty ?? 0) - Number(item.reservedQty ?? 0);
    if (available <= Number(item.minimumStock || item.rawMaterial?.minimumStock || 0)) return "low";
    if (available <= Number(item.reorderLevel || item.rawMaterial?.reorderLevel || 0))
      return "reorder";
    return "ok";
  };
  const lowOnPage = (data || []).filter((item: any) => levelOf(item) !== "ok").length;

  return (
    <div>
      <div className="w-full min-w-0">
        <PageHeader
          title="Stock Ledger Management"
          subtitle={`${total || 0} stock lines · raw material on hand, reserved and available by store`}
          icon={<Layers size={22} />}
          actions={
            can("raw_material_stocks.export") ? (
              <ExportCSVButton
                data={data || []}
                columns={exportColumns}
                filename="stock_ledger_balances.csv"
              />
            ) : null
          }
        />

        <Toolbar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search stock..."
          searchLabel="Search stock"
          filters={[
            { key: "", label: "All categories" },
            ...categoryOptions.map((c) => ({ key: c.value, label: c.label })),
          ]}
          filterValue={appliedCategory}
          onFilterChange={(key) => {
            setCategoryFilter(key);
            setAppliedCategory(key);
            setCurrentPage(1);
          }}
          filtersLabel="Category"
          right={
            <div className="flex flex-wrap items-center gap-2">
              {lowOnPage > 0 && (
                <Chip tone="warning" dot>
                  {lowOnPage} need attention
                </Chip>
              )}
              <div role="group" aria-label="Status" className="flex items-center gap-2">
                {[
                  { key: "", label: "Any status" },
                  { key: "Active", label: "Active" },
                  { key: "Inactive", label: "Inactive" },
                ].map((f) => (
                  <Chip
                    key={f.key || "all"}
                    selected={appliedStatus === f.key}
                    onClick={() => {
                      setStatusFilter(f.key);
                      setAppliedStatus(f.key);
                      setCurrentPage(1);
                    }}
                  >
                    {f.label}
                  </Chip>
                ))}
              </div>
            </div>
          }
        />

        <DataTable
          data={data || []}
          rowKey={(item) => item.rawMaterialId || item.id}
          loading={loading}
          density="compact"
          ariaLabel="Stock ledger"
          emptyMessage={
            hasActiveFilters || debouncedSearch
              ? "No stock matches these filters."
              : "No stock records found."
          }
          emptyAction={
            hasActiveFilters || debouncedSearch ? (
              <ActionPill
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  handleClearFilters();
                }}
              >
                Clear filters
              </ActionPill>
            ) : undefined
          }
          pagination={
            totalPages > 1 ? { currentPage, totalPages, onPageChange: setCurrentPage } : undefined
          }
          columns={[
            {
              header: "#",
              width: "56px",
              align: "center",
              render: (_, index) => (
                <span className="text-ink-subtle">
                  {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
                </span>
              ),
            },
            {
              header: "Material",
              render: (item) => {
                const matName = (item as any).materialName || item.rawMaterial?.materialName || "-";
                const isWastage =
                  (item as any).itemType === "WASTAGE" || item.rawMaterial?.itemType === "WASTAGE";
                return (
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleOpenView(item)}
                        className="w-fit text-left font-semibold text-accent hover:underline underline-offset-4"
                      >
                        {matName}
                      </button>
                      {isWastage && (
                        <Chip size="sm" tone="warning">
                          Wastage
                        </Chip>
                      )}
                    </div>
                    <span className="font-mono text-xs text-ink-subtle">{item.rawMaterialId}</span>
                  </div>
                );
              },
            },
            {
              header: "Category",
              render: (item) => {
                const catName =
                  (item as any).category?.name || item.rawMaterial?.category?.name || "—";
                return <span className="text-ink-muted">{catName}</span>;
              },
            },
            {
              header: "Store",
              render: (item) => (
                <Chip size="sm">{item.store?.storeName || item.storeId || "—"}</Chip>
              ),
            },
            {
              header: "Physical stock",
              align: "right",
              render: (item) => {
                const baseUom = (item as any).baseUom || item.rawMaterial?.baseUom || "";
                const minStock = Number(
                  (item as any).minimumStock || item.rawMaterial?.minimumStock || 0
                );
                return (
                  <div className="flex flex-col items-end tabular-nums">
                    <span className="text-ink">{formatDisplayQty(item.onHandQty, baseUom)}</span>
                    <span className="text-xs text-ink-subtle">
                      {formatDisplayQty(minStock, baseUom, "Min ")}
                    </span>
                  </div>
                );
              },
            },
            {
              header: "Reserved",
              align: "right",
              render: (item) => {
                const baseUom = (item as any).baseUom || item.rawMaterial?.baseUom || "";
                return (
                  <span className="tabular-nums text-ink-muted">
                    {formatDisplayQty(item.reservedQty, baseUom)}
                  </span>
                );
              },
            },
            {
              header: "Available",
              align: "right",
              render: (item) => {
                const baseUom = (item as any).baseUom || item.rawMaterial?.baseUom || "";
                const available = Number(item.onHandQty ?? 0) - Number(item.reservedQty ?? 0);
                const level = levelOf(item);
                return (
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums text-ink">
                      {formatDisplayQty(available, baseUom)}
                    </span>
                    {level !== "ok" && (
                      <Chip size="sm" tone={level === "low" ? "danger" : "warning"}>
                        {level === "low" ? "Below min" : "Reorder"}
                      </Chip>
                    )}
                  </div>
                );
              },
            },
            {
              header: "Status",
              align: "center",
              render: (item) => <StatusBadge status={item.status || "Active"} />,
            },
            {
              header: "Actions",
              align: "right",
              render: (item) => (
                <div className="table-action-group w-full justify-end">
                  <ViewButton onClick={() => handleOpenView(item)} />
                </div>
              ),
            },
          ]}
        />
      </div>

      <CommonViewModal
        show={showView}
        onHide={() => setShowView(false)}
        modalTitle="Stock Details"
        avatarText={
          selectedItem
            ? ((selectedItem as any).materialName || selectedItem.rawMaterial?.materialName || "S")
                .charAt(0)
                .toUpperCase()
            : ""
        }
        headerTitle={
          selectedItem
            ? (selectedItem as any).materialName ||
              selectedItem.rawMaterial?.materialName ||
              selectedItem.rawMaterialId
            : ""
        }
        headerSubtitle={selectedItem ? `ID: ${selectedItem.rawMaterialId}` : ""}
        sections={
          selectedItem
            ? [
                {
                  fields: [
                    { label: "Material ID", value: selectedItem.rawMaterialId },
                    {
                      label: "Material Name",
                      value:
                        (selectedItem as any).materialName ||
                        selectedItem.rawMaterial?.materialName ||
                        "N/A",
                    },
                    {
                      label: "Category",
                      value:
                        (selectedItem as any).category?.name ||
                        selectedItem.rawMaterial?.category?.name ||
                        "N/A",
                    },
                    {
                      label: "Primary UOM",
                      value: parseBaseUom(
                        (selectedItem as any).baseUom || selectedItem.rawMaterial?.baseUom
                      ).primary,
                    },
                    {
                      label: "Secondary UOM(s)",
                      value: parseBaseUom(
                        (selectedItem as any).baseUom || selectedItem.rawMaterial?.baseUom
                      ).secondary,
                    },
                    {
                      label: "Reorder Level",
                      value:
                        (selectedItem as any).reorderLevel != null
                          ? formatExportQty(
                              (selectedItem as any).reorderLevel,
                              (selectedItem as any).baseUom || ""
                            )
                          : "N/A",
                    },
                    {
                      label: "Minimum Stock",
                      value:
                        (selectedItem as any).minimumStock != null
                          ? formatExportQty(
                              (selectedItem as any).minimumStock,
                              (selectedItem as any).baseUom || ""
                            )
                          : "N/A",
                    },
                    {
                      label: "Store",
                      value: selectedItem.store?.storeName || selectedItem.storeId || "N/A",
                    },
                    {
                      label: "Store Location",
                      value:
                        formatLocationAddress(
                          (selectedItem as any).storeLocation?.locationCode ||
                            selectedItem.locationId
                        ) || "N/A",
                    },
                    {
                      label: "Physical Stock",
                      value: formatExportQty(
                        selectedItem.onHandQty ?? 0,
                        (selectedItem as any).baseUom || ""
                      ),
                    },
                    {
                      label: "Reserved Stock",
                      value: formatExportQty(
                        selectedItem.reservedQty ?? 0,
                        (selectedItem as any).baseUom || ""
                      ),
                    },
                    {
                      label: "Available Stock",
                      value: formatExportQty(
                        Number(selectedItem.onHandQty ?? 0) - Number(selectedItem.reservedQty ?? 0),
                        (selectedItem as any).baseUom || ""
                      ),
                    },
                    { label: "Status", value: selectedItem.status || "Active" },
                  ],
                },
              ]
            : []
        }
      />
    </div>
  );
};

export default StockList;
