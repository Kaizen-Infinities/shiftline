import React, { useState, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { Plus } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar } from "../../../components/ui/v2";
import { PAGE_CLASS } from "../../sales/shared/tradeUi";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { salesProductService } from "../../../services/salesProductService";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";

import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";

const ITEMS_PER_PAGE = 15;

const SalesProductList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const data = await salesProductService.fetchAll();
    const list = Array.isArray(data) ? data : [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: allSalesProducts,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "salesProducts:list",
    socketModule: "salesProduct",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const salesProducts = useMemo(() => {
    if (!searchTerm) return allSalesProducts;
    const term = searchTerm.toLowerCase();
    return allSalesProducts.filter(
      (p: any) =>
        p.salesProductName?.toLowerCase().includes(term) ||
        p.salesProductCode?.toLowerCase().includes(term)
    );
  }, [allSalesProducts, searchTerm]);

  const totalPages = Math.ceil(salesProducts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedData = salesProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleOpenAdd = useCallback(() => navigate("/sales-products/create"), [navigate]);
  const handleOpenEdit = useCallback(
    (item: any) => {
      navigate(`/sales-products/edit/${item.id}`, { state: item });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: number) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete === null || isDeleting) return;
    setIsDeleting(true);
    try {
      await salesProductService.delete(itemToDelete);
      toast.success("Sales Product deleted successfully!");
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete Sales Product");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setItemToDelete(null);
    }
  };

  const fetchSalesProductsForExport = useCallback(async () => {
    const res = await salesProductService.fetchAll();
    return Array.isArray(res) ? res : [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Sales Product Code", accessor: (item: any) => item.salesProductCode },
      { header: "Sales Product Name", accessor: (item: any) => item.salesProductName },
      {
        header: "Components",
        accessor: (item: any) =>
          (item.components || [])
            .map((c: any) => {
              const name = c.componentProduct?.productName;
              if (!name) return null;
              return `${name} (${c.quantity ?? 1})`;
            })
            .filter(Boolean)
            .join("; ") || "—",
      },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Sales_Product_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const columns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "56px",
      render: (_, index) => (
        <span className="tabular-nums text-ink-subtle">{startIndex + index + 1}</span>
      ),
    },
    {
      header: "Sales product",
      render: (item) => (
        <div className="leading-tight">
          <div className="font-semibold text-ink">{item.salesProductName}</div>
          <span className="text-[12px] text-ink-subtle">{item.salesProductCode}</span>
        </div>
      ),
    },
    {
      header: "Components",
      render: (item) => {
        const comps = (item.components || []).filter((c: any) => c.componentProduct?.productName);
        if (!comps.length) return <span className="text-ink-subtle">—</span>;
        return (
          <div className="flex flex-wrap gap-1.5 py-1">
            {comps.map((c: any, i: number) => (
              <Chip key={c.id ?? i} size="sm" tone="muted">
                {c.componentProduct.productName}
                <span className="tabular-nums text-ink-subtle">× {c.quantity ?? 1}</span>
              </Chip>
            ))}
          </div>
        );
      },
    },
    // {
    //     header: "RATE (₹)",
    //     align: "right",
    //     render: (item) => item.rate != null ? Number(item.rate).toFixed(2) : "-",
    // },
    {
      header: "Status",
      render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      header: "Actions",
      align: "right",
      render: (item) => (
        <div className="flex items-center justify-end gap-1.5">
          {can("sales_products.edit") && <EditButton onClick={() => handleOpenEdit(item)} />}
          {can("sales_products.delete") && <DeleteButton onClick={() => triggerDelete(item.id)} />}
        </div>
      ),
    },
  ];

  const createButton = can("sales_products.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={handleOpenAdd}>
      Add Sales Product
    </ActionPill>
  ) : null;

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Sales Product"
        subtitle="Sellable kits built from production items, e.g. a bucket with its lid"
        primaryAction={createButton}
        actions={
          can("sales_products.export") ? (
            <ExportCSVButton
              fetchData={fetchSalesProductsForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : null
        }
      />

      <Toolbar
        searchValue={searchTerm}
        onSearchChange={(v) => {
          setSearchTerm(v);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search name or code"
        searchLabel="Search sales products"
      />

      <DataTable
        error={listError}
        onRetry={refresh}
        columns={columns}
        data={paginatedData}
        rowKey={(row) => row.id}
        loading={loading}
        ariaLabel="Sales products"
        emptyMessage={
          searchTerm ? `No sales products match "${searchTerm}".` : "No sales products yet."
        }
        emptyAction={searchTerm ? undefined : createButton}
        pagination={
          totalPages > 1
            ? {
                currentPage,
                totalPages,
                onPageChange: setCurrentPage,
              }
            : undefined
        }
      />

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this sales product?"
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default SalesProductList;
