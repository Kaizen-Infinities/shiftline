import React, { useState, useMemo, useCallback, useEffect } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import type { RawMaterial } from "../../../features/raw-materials/types";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";
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
import { Boxes, Plus } from "lucide-react";
import { ActionPill, Chip, PageHeader, StatTile, Toolbar } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 15;

const RawMaterialList: React.FC = () => {
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

  // Fetch RAW_MATERIAL stores for filter dropdown
  useEffect(() => {
    storeService
      .fetchAll({ storeCategory: "RAW_MATERIAL" })
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.stores || res?.data || [];
        setStores(list);
      })
      .catch(() => {});
  }, []);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await rawMaterialService.fetchAll({ itemType: "RAW_MATERIAL", limit: 10000 });
    const list = Array.isArray(res) ? res : res?.rawMaterials || res?.data || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: allRawMaterials,
    loading,
    refresh,
  } = useListCache<any>({
    cacheKey: "rawMaterials:list",
    socketModule: "rawMaterial",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const filteredData = useMemo(() => {
    return allRawMaterials.filter((item: any) => {
      const matchesSearch =
        !searchTerm ||
        item.rawMaterialId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.materialName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStore = !storeFilter || item.storeId === storeFilter;
      const matchesActive =
        activeFilter === "" || (activeFilter === "true" ? item.isActive : !item.isActive);
      return matchesSearch && matchesStore && matchesActive;
    });
  }, [allRawMaterials, searchTerm, storeFilter, activeFilter]);

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
    navigate("/raw-materials/create");
  }, [navigate]);

  const handleOpenEdit = useCallback(
    (item: RawMaterial) => {
      navigate(`/raw-materials/edit/${item.rawMaterialId}`, { state: item });
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
        toast.success("Raw material deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(err || "Failed to delete raw material");
      } finally {
        setIsDeleting(false);
        setShowDeleteModal(false);
        setItemToDelete(null);
      }
    }
  };

  const fetchRawMaterialsForExport = useCallback(async () => {
    const res = await rawMaterialService.fetchAll({ limit: 100000 });
    return Array.isArray(res) ? res : res?.rawMaterials || res?.data || [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Material ID", accessor: (item: any) => item.rawMaterialId },
      { header: "Material Name", accessor: (item: any) => item.materialName },
      { header: "Category", accessor: (item: any) => item.category?.name || "—" },
      { header: "Store", accessor: (item: any) => item.store?.storeName || item.storeId || "—" },
      {
        header: "Physical Stock",
        accessor: (item: any) =>
          item.onHandQty != null ? `${item.onHandQty} ${item.baseUom || ""}`.trim() : "0",
      },
      {
        header: "Reserved",
        accessor: (item: any) =>
          item.reservedQty != null ? `${item.reservedQty} ${item.baseUom || ""}`.trim() : "0",
      },
      {
        header: "Available",
        accessor: (item: any) => {
          const available = Number(item.onHandQty ?? 0) - Number(item.reservedQty ?? 0);
          return `${available} ${item.baseUom || ""}`.trim();
        },
      },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Raw_Materials_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const availableOf = (item: any) => Number(item.onHandQty ?? 0) - Number(item.reservedQty ?? 0);
  const stockLevel = (item: any): "low" | "reorder" | "ok" => {
    const available = availableOf(item);
    if (available <= Number(item.minimumStock ?? 0)) return "low";
    if (available <= Number(item.reorderLevel ?? 0)) return "reorder";
    return "ok";
  };

  const stats = useMemo(() => {
    let low = 0;
    let reorder = 0;
    allRawMaterials.forEach((item: any) => {
      const level = stockLevel(item);
      if (level === "low") low += 1;
      else if (level === "reorder") reorder += 1;
    });
    return {
      total: allRawMaterials.length,
      active: allRawMaterials.filter((i: any) => i.isActive).length,
      low,
      reorder,
    };
  }, [allRawMaterials]);

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
      header: "Material",
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
        <div className="flex flex-col items-end tabular-nums">
          <span className="text-ink">{formatStockQty(item.onHandQty, item.baseUom)}</span>
          <span className="text-xs text-ink-subtle">
            Min {formatStockQty(item.minimumStock, item.baseUom)}
          </span>
        </div>
      ),
    },
    {
      header: "Reserved",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink-muted">
          {formatStockQty(item.reservedQty, item.baseUom)}
        </span>
      ),
    },
    {
      header: "Available",
      align: "right",
      render: (item) => {
        const level = stockLevel(item);
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="font-semibold tabular-nums text-ink">
              {formatStockQty(availableOf(item), item.baseUom)}
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
      render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      header: "Actions",
      align: "right",
      render: (item) => (
        <div className="table-action-group w-full justify-end">
          <ViewButton onClick={() => handleOpenView(item)} />
          {can("raw_materials.edit") && <EditButton onClick={() => handleOpenEdit(item)} />}
          {can("raw_materials.delete") && (
            <DeleteButton onClick={() => triggerDelete(item.rawMaterialId)} />
          )}
        </div>
      ),
    },
  ];

  const createCta = can("raw_materials.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={handleOpenAdd}>
      New Material
    </ActionPill>
  ) : null;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Raw Materials Management"
        subtitle={`${stats.total} materials · on hand, reserved for orders and free to issue`}
        icon={<Boxes size={22} />}
        actions={
          can("raw_materials.export") ? (
            <ExportCSVButton
              fetchData={fetchRawMaterialsForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : null
        }
        primaryAction={createCta}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Materials" value={stats.total.toLocaleString("en-IN")} loading={loading} />
        <StatTile label="Active" value={stats.active.toLocaleString("en-IN")} loading={loading} />
        <StatTile
          label="At reorder level"
          value={stats.reorder.toLocaleString("en-IN")}
          loading={loading}
          delta={stats.reorder > 0 ? "Plan purchase" : undefined}
          deltaTone="warning"
        />
        <StatTile
          label="Below minimum"
          value={stats.low.toLocaleString("en-IN")}
          loading={loading}
          delta={stats.low > 0 ? "Urgent" : undefined}
          deltaTone="danger"
        />
      </div>

      <Toolbar
        searchValue={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search materials..."
        searchLabel="Search raw materials"
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
        ariaLabel="Raw materials"
        emptyMessage={
          hasFilters ? "No raw materials match these filters." : "No raw materials found."
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
        modalTitle="Raw Material Details"
        avatarText={selectedItem ? selectedItem.materialName.charAt(0).toUpperCase() : ""}
        headerTitle={selectedItem ? selectedItem.materialName : ""}
        headerSubtitle={selectedItem ? `ID: ${selectedItem.rawMaterialId}` : ""}
        sections={
          selectedItem
            ? [
                {
                  fields: [
                    { label: "Material ID", value: selectedItem.rawMaterialId },
                    { label: "Material Name", value: selectedItem.materialName },
                    { label: "Category", value: selectedItem.category?.name || "N/A" },
                    { label: "Primary UOM", value: parseBaseUom(selectedItem.baseUom).primary },
                    {
                      label: "Secondary UOM(s)",
                      value: parseBaseUom(selectedItem.baseUom).secondary,
                    },
                    {
                      label: "Reorder Level",
                      value:
                        selectedItem.reorderLevel != null
                          ? formatStockQty(selectedItem.reorderLevel, selectedItem.baseUom)
                          : "N/A",
                    },
                    {
                      label: "Minimum Stock",
                      value:
                        selectedItem.minimumStock != null
                          ? formatStockQty(selectedItem.minimumStock, selectedItem.baseUom)
                          : "N/A",
                    },
                    {
                      label: "Rate (₹)",
                      value:
                        selectedItem.rate != null
                          ? String(selectedItem.rate)
                          : selectedItem.unitPrice != null
                            ? String(selectedItem.unitPrice)
                            : "N/A",
                    },
                    {
                      label: "Store",
                      value: selectedItem.store?.storeName || selectedItem.storeId || "N/A",
                    },
                    {
                      label: "Physical Stock",
                      value: formatStockQty(selectedItem.onHandQty, selectedItem.baseUom),
                    },
                    {
                      label: "Reserved Stock",
                      value: formatStockQty(selectedItem.reservedQty, selectedItem.baseUom),
                    },
                    {
                      label: "Available Stock",
                      value: formatStockQty(
                        Number(selectedItem.onHandQty ?? 0) - Number(selectedItem.reservedQty ?? 0),
                        selectedItem.baseUom
                      ),
                    },
                    {
                      label: "Narration",
                      value: selectedItem.narration || selectedItem.remarks || "N/A",
                    },
                    { label: "Status", value: selectedItem.isActive ? "Active" : "Inactive" },
                    {
                      label: "Created Date",
                      value: selectedItem.createdAt
                        ? new Date(selectedItem.createdAt).toLocaleString()
                        : "-",
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
        message="Are you sure you want to delete this raw material? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default RawMaterialList;
