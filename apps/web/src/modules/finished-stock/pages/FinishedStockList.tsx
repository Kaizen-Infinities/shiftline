import React, { useState, useEffect, useCallback } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useListCache } from "../../../hooks/useListCache";
import { finishedGoodsStockService } from "../../../services/finishedGoodsStockService";
import { useSocketSync } from "../../../hooks/useSocketSync";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import { categoryService } from "../../../services/categoryService";
import { usePermission } from "../../../hooks/usePermission";
import { PackageCheck } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar } from "../../../components/ui/v2";
import { qty } from "../../stock/lib/format";

const formatUom = (uomCode: string | undefined) => {
  if (!uomCode) return "PCS";
  const code = uomCode.trim().toUpperCase();
  if (code === "EA" || code === "EACH") return "PCS";
  return code;
};

const ITEMS_PER_PAGE = 15;

interface FinishedStockListProps {
  storeId?: string;
}

const FinishedStockList: React.FC<FinishedStockListProps> = ({ storeId: propStoreId }) => {
  const { can } = usePermission();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const activeStoreId = propStoreId || "";
  const [currentPage, setCurrentPage] = useState(1);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);

  const [, setCategoryFilter] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);

  const fetchCategoriesData = useCallback(async () => {
    try {
      const res = await categoryService.fetchAll({ type: "PRODUCT", isActive: true });
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

  // Reset page to 1 when storeId changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeStoreId]);

  const cacheKey = `finishedGoodsStock:${currentPage}:${ITEMS_PER_PAGE}:${debouncedSearch}:${activeStoreId}:${appliedCategory}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const res = await finishedGoodsStockService.fetchAll({
        storeId: activeStoreId,
        search: debouncedSearch,
        categoryId: appliedCategory || undefined,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      });
      const list = Array.isArray(res) ? res : res.data || [];
      const tot = Array.isArray(res) ? res.length : res.total || list.length;
      return { data: list, total: tot };
    },
    [activeStoreId, debouncedSearch, appliedCategory, currentPage]
  );

  const {
    data,
    total,
    loading,
    refresh,
    error: listError,
  } = useListCache({
    cacheKey,
    socketModule: "finishedGoodsStock",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh() });

  // Re-fetch category options on category changes
  useSocketSync("category", undefined, fetchCategoriesData);

  const handleOpenView = useCallback((item: any) => {
    setSelectedItem(item);
    setShowViewModal(true);
  }, []);

  const hasActiveFilters = !!appliedCategory;

  const handleClearFilters = useCallback(() => {
    setCategoryFilter("");
    setAppliedCategory("");
    setCurrentPage(1);
  }, []);

  // Pagination logic
  const totalPages = Math.ceil((total || 0) / ITEMS_PER_PAGE) || 1;
  const paginatedData = data || [];

  const exportColumns = [
    { header: "Store / Location", accessor: (item: any) => item.store?.storeName },
    { header: "Product Code", accessor: (item: any) => item.product?.productCode },
    { header: "Product Name", accessor: (item: any) => item.product?.productName },
    {
      header: "Category",
      accessor: (item: any) =>
        item.product?.category?.name || item.product?.category?.categoryName || "N/A",
    },
    {
      header: "Color",
      accessor: (item: any) =>
        item.product?.colors?.map((c: any) => c.color?.colorName).join(", ") || "N/A",
    },
    { header: "Size", accessor: (item: any) => item.product?.size?.sizeName || "N/A" },
    {
      header: "Physical Stock",
      accessor: (item: any) => `${item.onHandQty} ${formatUom(item.product?.uom?.uomCode)}`,
    },
  ];

  const lowOnPage = (data || []).filter((item: any) => {
    const onHand = Number(item.onHandQty) || 0;
    return onHand <= (Number(item.product?.minimumQty) || 0) || onHand <= 0;
  }).length;

  return (
    <div>
      <div className="w-full min-w-0">
        <PageHeader
          title="Finished goods stock"
          subtitle={`${total || 0} stock lines · finished products on hand, by store`}
          icon={<PackageCheck size={22} />}
          actions={
            can("finished_goods_stocks.export") ? (
              <ExportCSVButton
                data={data || []}
                columns={exportColumns}
                filename="finished_goods_stock.csv"
              />
            ) : null
          }
        />

        <Toolbar
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          searchPlaceholder="Search stock..."
          searchLabel="Search finished goods stock"
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
            lowOnPage > 0 ? (
              <Chip tone="danger" dot>
                {lowOnPage} at or below minimum
              </Chip>
            ) : null
          }
        />

        <DataTable
          error={listError}
          sourceRowCount={data.length}
          onRetry={refresh}
          data={paginatedData || []}
          rowKey={(item) => `${item.storeId}-${item.productItemId}`}
          loading={loading}
          ariaLabel="Finished goods stock"
          emptyMessage={
            hasActiveFilters || debouncedSearch
              ? "No stock matches these filters."
              : "No finished goods stock found."
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
            totalPages > 1
              ? { currentPage, totalPages, onPageChange: (page) => setCurrentPage(page) }
              : undefined
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
              header: "Product",
              render: (item) => (
                <div className="flex min-w-0 flex-col">
                  <button
                    type="button"
                    onClick={() => handleOpenView(item)}
                    className="w-fit text-left font-semibold text-accent hover:underline underline-offset-4"
                  >
                    {item.product?.productName || "N/A"}
                  </button>
                  <span className="font-mono text-xs text-ink-subtle">
                    {item.product?.productCode || "N/A"}
                  </span>
                </div>
              ),
            },
            {
              header: "Category",
              render: (item) => (
                <span className="text-ink-muted">
                  {(item.product?.category as any)?.name ||
                    item.product?.category?.categoryName ||
                    "N/A"}
                </span>
              ),
            },
            {
              header: "Store / Location",
              render: (item) => <Chip size="sm">{item.store?.storeName || "N/A"}</Chip>,
            },
            {
              header: "Physical stock",
              align: "right",
              render: (item) => {
                const onHand = Number(item.onHandQty) || 0;
                const minQty = Number((item.product as any)?.minimumQty) || 0;
                const low = onHand <= minQty || onHand <= 0;
                return (
                  <div className="flex flex-col items-end tabular-nums">
                    <span
                      className={`font-semibold ${low ? "text-[color:var(--color-danger)]" : "text-ink"}`}
                    >
                      {qty(item.onHandQty)} {formatUom(item.product?.uom?.uomCode)}
                    </span>
                    <span className="text-xs text-ink-subtle">
                      Min {qty(minQty)} · Max {qty((item.product as any)?.maximumQty || 0)}
                    </span>
                  </div>
                );
              },
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

        {/* View Modal */}
        <CommonViewModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          modalTitle="Finished Goods Stock Details"
          avatarText={
            selectedItem?.product?.productName
              ? selectedItem.product.productName.charAt(0).toUpperCase()
              : ""
          }
          headerTitle={selectedItem?.product?.productName || "N/A"}
          headerSubtitle={
            selectedItem?.product?.productCode ? `Code: ${selectedItem.product.productCode}` : ""
          }
          sections={
            selectedItem
              ? [
                  {
                    fields: [
                      { label: "Product Code", value: selectedItem.product?.productCode || "N/A" },
                      { label: "Product Name", value: selectedItem.product?.productName || "N/A" },
                      {
                        label: "Category",
                        value:
                          selectedItem.product?.category?.name ||
                          selectedItem.product?.category?.categoryName ||
                          "N/A",
                      },
                      { label: "Store / Location", value: selectedItem.store?.storeName || "N/A" },
                    ],
                  },
                  {
                    title: "Stock Information",
                    fields: [
                      {
                        label: "Physical Stock (On Hand)",
                        value: `${selectedItem.onHandQty} ${formatUom(selectedItem.product?.uom?.uomCode)}`,
                      },
                      {
                        label: "Minimum Quantity limit",
                        value: `${(selectedItem.product as any)?.minimumQty || "0"} ${formatUom(selectedItem.product?.uom?.uomCode)}`,
                      },
                      {
                        label: "Weight Per Piece",
                        value:
                          selectedItem.product?.weightPerPiece != null
                            ? `${selectedItem.product.weightPerPiece} ${(selectedItem.product as any)?.weightUom || "g"}`
                            : "N/A",
                      },
                    ],
                  },
                ]
              : []
          }
        />
      </div>
    </div>
  );
};

export default FinishedStockList;
