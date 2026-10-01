import React, { useState, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import type { Store } from "../../../features/stores/types";
import { STORE_CATEGORY_LABELS, STORE_CATEGORY_OPTIONS } from "../../../features/stores/types";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DataTable from "../../../components/ui/table/DataTable";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { storeService } from "../../../services/storeService";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";
import { Plus, Warehouse } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar, type ChipTone } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 15;

const StorageStoreList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  const [storeCategoryFilter, setStoreCategoryFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Store | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await storeService.fetchAll({ limit: 10000 });
    const list = Array.isArray(res) ? res : res?.stores || res?.data || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: allStores,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "stores:list",
    socketModule: "store",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const filteredStores = useMemo(() => {
    return allStores.filter((item: any) => {
      const matchesSearch =
        !searchTerm ||
        item.storeId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.storeName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = !storeCategoryFilter || item.storeCategory === storeCategoryFilter;
      const matchesActive =
        activeFilter === "" || (activeFilter === "true" ? item.isActive : !item.isActive);
      return matchesSearch && matchesCategory && matchesActive;
    });
  }, [allStores, searchTerm, storeCategoryFilter, activeFilter]);

  const totalPages = Math.ceil(filteredStores.length / ITEMS_PER_PAGE);
  const paginatedStores = filteredStores.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleOpenView = useCallback((item: Store) => {
    setSelectedItem(item);
    setShowViewModal(true);
  }, []);

  const handleOpenEdit = useCallback(
    (item: Store) => {
      navigate(`/storage-stores/edit/${item.storeId}`);
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
        await storeService.delete(itemToDelete);
        toast.success("Store deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(err || "Failed to delete store");
      } finally {
        setIsDeleting(false);
        setShowDeleteModal(false);
        setItemToDelete(null);
      }
    }
  };

  const fetchStoresForExport = useCallback(async () => {
    const res = await storeService.fetchAll({ limit: 100000 });
    return Array.isArray(res) ? res : res?.stores || res?.data || [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Store ID", accessor: (item: any) => item.storeId },
      { header: "Store Name", accessor: (item: any) => item.storeName },
      {
        header: "Category",
        accessor: (item: any) =>
          item.storeCategory
            ? ((STORE_CATEGORY_LABELS as any)[item.storeCategory] ?? item.storeCategory)
            : "N/A",
      },
      { header: "Incharge", accessor: (item: any) => item.incharge?.fullName || "N/A" },
      { header: "Location", accessor: (item: any) => item.location || "N/A" },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Storage_Store_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allStores.forEach((st: any) => {
      counts[st.storeCategory] = (counts[st.storeCategory] || 0) + 1;
    });
    return counts;
  }, [allStores]);

  const hasFilters = Boolean(searchTerm || storeCategoryFilter || activeFilter);
  const clearFilters = () => {
    setSearchTerm("");
    setStoreCategoryFilter("");
    setActiveFilter("");
    setCurrentPage(1);
  };

  const createCta = can("stores.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/storage-stores/create")}>
      New Store
    </ActionPill>
  ) : null;

  const categoryTone = (cat?: string): ChipTone =>
    cat === "RAW_MATERIAL" ? "success" : cat === "WASTAGE" ? "warning" : "default";

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Storage stores"
        subtitle={`${allStores.length} stores · where raw materials, finished goods and wastage are kept`}
        icon={<Warehouse size={22} />}
        actions={
          can("stores.export") ? (
            <ExportCSVButton
              fetchData={fetchStoresForExport}
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
        searchPlaceholder="Search stores..."
        searchLabel="Search stores"
        filters={[
          { key: "", label: "All", count: allStores.length },
          ...STORE_CATEGORY_OPTIONS.map((o) => ({
            key: o.value,
            label: o.label.replace(" Store", ""),
            count: categoryCounts[o.value] ?? 0,
          })),
        ]}
        filterValue={storeCategoryFilter}
        onFilterChange={(key) => {
          setStoreCategoryFilter(key);
          setCurrentPage(1);
        }}
        filtersLabel="Store category"
        right={
          <div role="group" aria-label="Status" className="flex items-center gap-2">
            {[
              { key: "", label: "Any status" },
              { key: "true", label: "Active" },
              { key: "false", label: "Inactive" },
            ].map((f) => (
              <Chip
                key={f.key || "all"}
                selected={activeFilter === f.key}
                onClick={() => {
                  setActiveFilter(f.key);
                  setCurrentPage(1);
                }}
              >
                {f.label}
              </Chip>
            ))}
          </div>
        }
      />

      <DataTable
        error={listError}
        sourceRowCount={allStores.length}
        onRetry={refresh}
        data={paginatedStores}
        rowKey={(item) => item.storeId}
        ariaLabel="Stores"
        emptyMessage={hasFilters ? "No stores match these filters." : "No stores found."}
        emptyAction={
          hasFilters ? (
            <ActionPill variant="secondary" onClick={clearFilters}>
              Clear filters
            </ActionPill>
          ) : (
            createCta
          )
        }
        loading={loading}
        pagination={
          totalPages > 1
            ? {
                currentPage,
                totalPages,
                onPageChange: setCurrentPage,
              }
            : undefined
        }
        columns={[
          {
            header: "#",
            width: "56px",
            render: (_item, index) => (currentPage - 1) * ITEMS_PER_PAGE + index + 1,
            align: "center",
          },
          {
            header: "Store",
            render: (item) => (
              <div className="flex min-w-0 flex-col">
                <button
                  type="button"
                  onClick={() => handleOpenView(item)}
                  className="w-fit text-left font-semibold text-accent hover:underline underline-offset-4"
                >
                  {item.storeName}
                </button>
                <span className="font-mono text-xs text-ink-subtle">{item.storeId}</span>
              </div>
            ),
          },
          {
            header: "Category",
            render: (item) =>
              item.storeCategory ? (
                <Chip size="sm" tone={categoryTone(item.storeCategory)}>
                  {(STORE_CATEGORY_LABELS as any)[item.storeCategory] ?? item.storeCategory}
                </Chip>
              ) : (
                "—"
              ),
          },
          {
            header: "Incharge",
            render: (item) => item.incharge?.fullName || "—",
          },
          {
            header: "Status",
            render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
            align: "center",
          },
          {
            header: "Actions",
            render: (item) => (
              <div className="table-action-group w-full justify-end">
                <ViewButton onClick={() => handleOpenView(item)} />
                {can("stores.edit") && <EditButton onClick={() => handleOpenEdit(item)} />}
                {can("stores.delete") && (
                  <DeleteButton onClick={() => triggerDelete(item.storeId)} />
                )}
              </div>
            ),
            align: "right",
          },
        ]}
      />

      {/* View Modal */}
      <CommonViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        modalTitle="Storage Store Details"
        avatarText={selectedItem ? selectedItem.storeName?.charAt(0).toUpperCase() : ""}
        headerTitle={selectedItem ? selectedItem.storeName : ""}
        headerSubtitle={selectedItem ? `ID: ${selectedItem.storeId}` : ""}
        sections={
          selectedItem
            ? [
                {
                  fields: [
                    { label: "Store ID", value: selectedItem.storeId },
                    { label: "Store Name", value: selectedItem.storeName },
                    {
                      label: "Store Category",
                      value: selectedItem.storeCategory
                        ? (STORE_CATEGORY_LABELS[selectedItem.storeCategory] ??
                          selectedItem.storeCategory)
                        : "N/A",
                    },
                    {
                      label: "Incharge",
                      value: selectedItem.incharge?.fullName || "N/A",
                    },
                    {
                      label: "Location Address",
                      value: (() => {
                        if (!selectedItem.locationDesc) return "N/A";
                        try {
                          const p = JSON.parse(selectedItem.locationDesc);
                          if (typeof p === "object" && p !== null) {
                            return (
                              p.formatted ||
                              [p.addressLine, p.city, p.state, p.country, p.zipcode]
                                .filter(Boolean)
                                .join(", ")
                            );
                          }
                        } catch {
                          return selectedItem.locationDesc;
                        }
                        return selectedItem.locationDesc;
                      })(),
                    },
                    { label: "Cost Method", value: selectedItem.costMethod || "N/A" },
                  ],
                },
                {
                  title: "Status Information",
                  fields: [
                    {
                      label: "Status",
                      value: selectedItem.isActive ? "Active" : "Inactive",
                    },
                    { label: "GST Place", value: selectedItem.gstPlace || "N/A" },
                    {
                      label: "Created At",
                      value: selectedItem.createdAt
                        ? new Date(selectedItem.createdAt).toLocaleDateString()
                        : "N/A",
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
        message="Are you sure you want to delete this store? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default StorageStoreList;
