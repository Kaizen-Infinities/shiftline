import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import type { RawMaterial } from "../../../features/raw-materials/types";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { storeService } from "../../../services/storeService";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { formatStockQty, parseBaseUom } from "../../../utils/uomConversion";
import { Plus, Recycle } from "lucide-react";
import { ActionPill, PageHeader, Toolbar } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 15;

const WastageStoreList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  const [searchTerm, setSearchTerm] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<RawMaterial | null>(null);

  const [stores, setStores] = useState<any[]>([]);

  // Fetch WASTAGE stores for filter dropdown
  useEffect(() => {
    storeService
      .fetchAll({ storeCategory: "WASTAGE" })
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.stores || res?.data || [];
        setStores(list);
      })
      .catch(() => {});
  }, []);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await rawMaterialService.fetchAll({ itemType: "WASTAGE", limit: 10000 });
    const list = Array.isArray(res) ? res : res?.rawMaterials || res?.data || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: allWastageItems,
    loading,
    refresh,
  } = useListCache<any>({
    cacheKey: "wastageStore:list",
    socketModule: "rawMaterial",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const filteredData = useMemo(() => {
    return allWastageItems.filter((item: any) => {
      const matchesSearch =
        !searchTerm ||
        item.rawMaterialId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.materialName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStore = !storeFilter || item.storeId === storeFilter;
      const matchesActive =
        activeFilter === "" || (activeFilter === "true" ? item.isActive : !item.isActive);
      return matchesSearch && matchesStore && matchesActive;
    });
  }, [allWastageItems, searchTerm, storeFilter, activeFilter]);

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const total = filteredData.length;
  const paginatedData = filteredData.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const storeOptions = useMemo(
    () => [
      { label: "All Stores", value: "" },
      ...(stores || []).map((s: any) => ({ label: s.storeName, value: s.storeId })),
    ],
    [stores]
  );

  const handleOpenView = useCallback((item: RawMaterial) => {
    setSelectedItem(item);
    setShowViewModal(true);
  }, []);

  const handleOpenAdd = useCallback(() => {
    navigate("/wastage-store/create");
  }, [navigate]);

  const handleOpenEdit = useCallback(
    (item: RawMaterial) => {
      navigate(`/wastage-store/edit/${item.rawMaterialId}`, { state: item });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: string) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete !== null && !isDeleting) {
      setIsDeleting(true);
      try {
        await rawMaterialService.delete(itemToDelete);
        toast.success("Wastage product deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(err || "Failed to delete item");
      } finally {
        setIsDeleting(false);
        setShowDeleteModal(false);
        setItemToDelete(null);
      }
    }
  };

  const fetchWastageForExport = useCallback(async () => {
    const res = await rawMaterialService.fetchAll({ itemType: "WASTAGE", limit: 100000 });
    return Array.isArray(res) ? res : res?.rawMaterials || res?.data || [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Product ID", accessor: (item: any) => item.rawMaterialId },
      { header: "Product Name", accessor: (item: any) => item.materialName },
      { header: "Category", accessor: (item: any) => item.category?.name || "—" },
      { header: "Store", accessor: (item: any) => item.store?.storeName || item.storeId || "—" },
      {
        header: "Physical Stock",
        accessor: (item: any) =>
          item.onHandQty != null ? `${item.onHandQty} ${item.baseUom || ""}`.trim() : "0",
      },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Wastage_Store_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const hasFilters = Boolean(searchTerm || storeFilter || activeFilter);
  const clearFilters = () => {
    setSearchTerm("");
    setStoreFilter("");
    setActiveFilter("");
    setCurrentPage(1);
  };

  const columns: DataTableColumn<RawMaterial>[] = [
    {
      header: "#",
      width: "56px",
      align: "center",
      render: (_, index) => (currentPage - 1) * ITEMS_PER_PAGE + index + 1,
    },
    {
      header: "Wastage product",
      render: (item) => (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            onClick={() => handleOpenView(item)}
            className="w-fit text-left font-semibold text-accent hover:underline underline-offset-4"
          >
            {item.materialName}
          </button>
          <span className="font-mono text-xs text-ink-subtle">{item.rawMaterialId}</span>
        </div>
      ),
    },
    { header: "Category", render: (item) => item.category?.name || "—" },
    { header: "Store", render: (item) => item.store?.storeName || item.storeId || "—" },
    {
      header: "Physical stock",
      align: "right",
      render: (item) => (
        <span className="font-semibold tabular-nums text-ink">
          {formatStockQty(item.onHandQty, item.baseUom)}
        </span>
      ),
    },
    {
      header: "Status",
      align: "center",
      render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      header: "Actions",
      align: "right",
      render: (item) => (
        <div className="table-action-group w-full justify-end">
          <ViewButton onClick={() => handleOpenView(item)} />
          {can("wastage-store.edit") && <EditButton onClick={() => handleOpenEdit(item)} />}
          {can("wastage-store.delete") && (
            <DeleteButton onClick={() => triggerDelete(item.rawMaterialId)} />
          )}
        </div>
      ),
    },
  ];

  const createCta = can("wastage-store.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={handleOpenAdd}>
      New Wastage Product
    </ActionPill>
  ) : null;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Wastage Products"
        subtitle={`${allWastageItems.length} items · scrap, regrind and rejects kept in wastage stores`}
        icon={<Recycle size={22} />}
        actions={
          can("wastage-store.export") ? (
            <ExportCSVButton
              fetchData={fetchWastageForExport}
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
        onSearchChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search products..."
        searchLabel="Search wastage products"
        filters={[
          { key: "", label: "All" },
          { key: "true", label: "Active" },
          { key: "false", label: "Inactive" },
        ]}
        filterValue={activeFilter}
        onFilterChange={(key) => {
          setActiveFilter(key);
          setCurrentPage(1);
        }}
        filtersLabel="Status"
        right={
          <div className="w-full sm:w-52">
            <SelectInput
              label="Store Filter"
              hideLabel
              name="storeFilter"
              value={storeFilter}
              options={storeOptions}
              onChange={(e) => {
                setStoreFilter(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={paginatedData}
        rowKey={(row) => row.rawMaterialId}
        loading={loading}
        ariaLabel="Wastage products"
        emptyMessage={
          hasFilters ? "No wastage products match these filters." : "No wastage products found."
        }
        emptyAction={
          hasFilters ? (
            <ActionPill variant="secondary" onClick={clearFilters}>
              Clear filters
            </ActionPill>
          ) : (
            createCta
          )
        }
        pagination={
          totalPages > 1 ? { currentPage, totalPages, onPageChange: setCurrentPage } : undefined
        }
      />
      <p className="sl-muted m-0 mt-2 text-right text-xs">Total: {total} record(s)</p>

      {/* View Modal */}
      <CommonViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        modalTitle="Wastage Product Details"
        avatarText={selectedItem ? selectedItem.materialName.charAt(0).toUpperCase() : ""}
        headerTitle={selectedItem ? selectedItem.materialName : ""}
        headerSubtitle={selectedItem ? `ID: ${selectedItem.rawMaterialId}` : ""}
        sections={
          selectedItem
            ? [
                {
                  fields: [
                    { label: "Wastage ID", value: selectedItem.rawMaterialId },
                    { label: "Material Name", value: selectedItem.materialName },
                    { label: "Category", value: selectedItem.category?.name || "N/A" },
                    { label: "Primary UOM", value: parseBaseUom(selectedItem.baseUom).primary },
                    {
                      label: "Secondary UOM(s)",
                      value: parseBaseUom(selectedItem.baseUom).secondary,
                    },
                    {
                      label: "Store",
                      value: selectedItem.store?.storeName || selectedItem.storeId || "N/A",
                    },
                    {
                      label: "Physical Stock",
                      value: formatStockQty(selectedItem.onHandQty, selectedItem.baseUom),
                    },
                    { label: "Status", value: selectedItem.isActive ? "Active" : "Inactive" },
                    {
                      label: "Narration",
                      value: selectedItem.narration || selectedItem.remarks || "N/A",
                    },
                  ],
                },
              ]
            : []
        }
      />

      {/* Delete Confirm Modal */}
      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this wastage product? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default WastageStoreList;
