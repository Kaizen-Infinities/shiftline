import React, { useState, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { Plus, Tags } from "lucide-react";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonViewModal from "../../../components/ui/CommonViewModal/CommonViewModal";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { categoryService } from "../../../services/categoryService";

import type { Category, CategoryType } from "../../../features/categories/types";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";
import { ActionPill, Chip, PageHeader, Toolbar, type ChipTone } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 15;

const TYPE_LABELS: Record<CategoryType, string> = {
  PRODUCT: "Product",
  RAW_MATERIAL: "Raw Material",
  WASTAGE: "Wastage",
};

const TYPE_TONES: Record<CategoryType, ChipTone> = {
  PRODUCT: "default",
  RAW_MATERIAL: "success",
  WASTAGE: "warning",
};

const TypeBadge: React.FC<{ type: CategoryType }> = ({ type }) => (
  <Chip size="sm" tone={TYPE_TONES[type] || "muted"}>
    {TYPE_LABELS[type] || type}
  </Chip>
);

const CategoryList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  const canCreate = can("categories.create");
  const canEdit = can("categories.edit");
  const canDelete = can("categories.delete");
  const canExport = can("categories.export");

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [activeFilter, setActiveFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Category | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await categoryService.fetchAll({ limit: 10000 });
    const list = Array.isArray(res) ? res : res?.categories || res?.data || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: allCategories,
    loading,
    refresh,
    error: listError,
  } = useListCache<Category>({
    cacheKey: "categories:list",
    socketModule: "category",
    fetcher,
  });

  const categories = useMemo(() => {
    return allCategories.filter((item) => {
      const matchesSearch =
        !searchTerm ||
        item.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.name?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = typeFilter === "ALL" || item.type === typeFilter;
      const matchesActive =
        activeFilter === "ALL" || (activeFilter === "true" ? item.isActive : !item.isActive);
      return matchesSearch && matchesType && matchesActive;
    });
  }, [allCategories, searchTerm, typeFilter, activeFilter]);

  const totalPages = Math.ceil(categories.length / ITEMS_PER_PAGE);
  const paginatedCategories = categories.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleOpenView = useCallback((item: Category) => {
    setSelectedItem(item);
    setShowViewModal(true);
  }, []);

  const handleOpenEdit = useCallback(
    (item: Category) => {
      navigate(`/categories/edit/${item.id}`, { state: item });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: number) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete !== null && !isDeleting) {
      setIsDeleting(true);
      try {
        await categoryService.delete(itemToDelete);
        toast.success("Category deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(err || "Failed to delete category");
      } finally {
        setShowDeleteModal(false);
        setItemToDelete(null);
        setIsDeleting(false);
      }
    }
  };

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;

  const fetchCategoriesForExport = useCallback(async () => {
    const res = await categoryService.fetchAll({ limit: 100000 });
    return Array.isArray(res) ? res : res?.categories || res?.data || [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Category Code", accessor: (item: any) => item.code },
      { header: "Category Name", accessor: (item: any) => item.name },
      {
        header: "Type",
        accessor: (item: any) => TYPE_LABELS[item.type as CategoryType] || item.type,
      },
      { header: "Description", accessor: (item: any) => item.description || "—" },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Category_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const counts = useMemo(() => {
    const byType: Record<string, number> = { ALL: allCategories.length };
    allCategories.forEach((c) => {
      byType[c.type] = (byType[c.type] || 0) + 1;
    });
    return byType;
  }, [allCategories]);

  const hasFilters = Boolean(searchTerm) || typeFilter !== "ALL" || activeFilter !== "ALL";
  const clearFilters = () => {
    setSearchTerm("");
    setTypeFilter("ALL");
    setActiveFilter("ALL");
    setCurrentPage(1);
  };

  const createCta = canCreate ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/categories/create")}>
      New Category
    </ActionPill>
  ) : null;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Categories"
        subtitle={`${allCategories.length} categories · group products, raw materials and wastage`}
        icon={<Tags size={22} />}
        actions={
          canExport ? (
            <ExportCSVButton
              fetchData={fetchCategoriesForExport}
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
        searchPlaceholder="Search by code or name..."
        searchLabel="Search categories"
        filters={[
          { key: "ALL", label: "All", count: counts.ALL ?? 0 },
          { key: "PRODUCT", label: "Product", count: counts.PRODUCT ?? 0 },
          { key: "RAW_MATERIAL", label: "Raw Material", count: counts.RAW_MATERIAL ?? 0 },
          { key: "WASTAGE", label: "Wastage", count: counts.WASTAGE ?? 0 },
        ]}
        filterValue={typeFilter}
        onFilterChange={(key) => {
          setTypeFilter(key);
          setCurrentPage(1);
        }}
        filtersLabel="Category type"
        right={
          <div role="group" aria-label="Status" className="flex items-center gap-2">
            {[
              { key: "ALL", label: "Any status" },
              { key: "true", label: "Active" },
              { key: "false", label: "Inactive" },
            ].map((f) => (
              <Chip
                key={f.key}
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
        sourceRowCount={allCategories.length}
        onRetry={refresh}
        data={paginatedCategories}
        rowKey={(item) => item.id}
        loading={loading}
        ariaLabel="Categories"
        emptyMessage={hasFilters ? "No categories match these filters." : "No categories found."}
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
          totalPages > 1
            ? {
                currentPage,
                totalPages,
                onPageChange: (page) => setCurrentPage(page),
              }
            : undefined
        }
        columns={[
          {
            header: "#",
            width: "56px",
            align: "center",
            render: (_item, index) => (
              <span className="text-ink-subtle tabular-nums">{startIndex + index + 1}</span>
            ),
          },
          {
            header: "Category",
            render: (item) => (
              <div className="flex min-w-0 flex-col">
                <button
                  type="button"
                  onClick={() => handleOpenView(item)}
                  className="w-fit text-left font-semibold text-accent hover:underline underline-offset-4"
                >
                  {item.name}
                </button>
                <span className="font-mono text-xs text-ink-subtle">{item.code}</span>
              </div>
            ),
          },
          {
            header: "Type",
            render: (item) => <TypeBadge type={item.type} />,
          },
          {
            header: "Description",
            render: (item) => {
              const val = item.description || "—";
              return (
                <span className="block max-w-[320px] truncate text-sm text-ink-subtle" title={val}>
                  {val}
                </span>
              );
            },
          },
          {
            header: "Used in",
            render: (item) => {
              if (!item._count) return <span className="text-ink-subtle text-xs">—</span>;
              const count =
                item.type === "PRODUCT"
                  ? `${item._count.products} product(s)`
                  : item.type === "RAW_MATERIAL"
                    ? `${item._count.rawMaterials} RM(s)`
                    : `${item._count.rawMaterials + item._count.products} item(s)`;
              return <span className="text-sm text-ink-muted tabular-nums">{count}</span>;
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
                {canEdit && <EditButton onClick={() => handleOpenEdit(item)} />}
                {canDelete && <DeleteButton onClick={() => triggerDelete(item.id)} />}
              </div>
            ),
          },
        ]}
      />

      {/* View Modal */}
      <CommonViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        modalTitle="Category Details"
        avatarText={selectedItem ? selectedItem.name.charAt(0).toUpperCase() : ""}
        headerTitle={selectedItem ? selectedItem.name : ""}
        headerSubtitle={selectedItem ? `Code: ${selectedItem.code}` : ""}
        sections={
          selectedItem
            ? [
                {
                  fields: [
                    { label: "Category Code", value: selectedItem.code },
                    { label: "Category Name", value: selectedItem.name },
                    { label: "Type", value: TYPE_LABELS[selectedItem.type] || selectedItem.type },
                    { label: "Description", value: selectedItem.description || "—" },
                  ],
                },
                {
                  title: "Usage & Status",
                  fields: [
                    { label: "Status", value: selectedItem.isActive ? "Active" : "Inactive" },
                    { label: "Products Linked", value: selectedItem._count?.products ?? "—" },
                    {
                      label: "Raw Materials Linked",
                      value: selectedItem._count?.rawMaterials ?? "—",
                    },
                    {
                      label: "Created At",
                      value: selectedItem.createdAt
                        ? new Date(selectedItem.createdAt).toLocaleDateString()
                        : "—",
                    },
                  ],
                },
              ]
            : []
        }
      />

      {/* Delete Modal */}
      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this category? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default CategoryList;
