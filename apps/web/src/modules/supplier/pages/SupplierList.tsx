import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { Plus } from "lucide-react";
import { ActionPill, PageHeader, SearchField, Toolbar } from "../../../components/ui/v2";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import { PAGE_CLASS, formatINR } from "../../sales/shared/tradeUi";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import PricingButton from "../../../components/ui/PricingButton/PricingButton";
import SupplierViewModal from "../components/SupplierViewModal";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { supplierService } from "../../../services/supplierService";
import { usePermission } from "../../../hooks/usePermission";
import DataTable from "../../../components/ui/table/DataTable";
import { useListCache } from "../../../hooks/useListCache";

const ITEMS_PER_PAGE = 15;
const SupplierList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const canEditSupplier = can("suppliers.edit");
  const canDeleteSupplier = can("suppliers.delete");
  const canViewPricing = can("supplierpricelist.view");
  const canCreateSupplier = can("suppliers.create");
  const canExportSupplier = can("suppliers.export");

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const initialSearch = searchParams.get("search") || "";

  const [searchTerm, setSearchTerm] = useState(initialSearch);

  // Custom confirm delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // The API caps one page at 100 rows, so the full list is walked page by page.
  const fetchSuppliersForExport = useCallback(async () => {
    return supplierService.fetchAllSuppliers();
  }, []);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const list = await supplierService.fetchAllSuppliers();
    return { data: list, total: list.length };
  }, []);

  const {
    data: allSuppliers,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "suppliers:list",
    socketModule: "supplier",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const [statusFilter, setStatusFilter] = useState<string>("");
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (allSuppliers || []).forEach((s: any) => {
      const k = String(s.status || "");
      counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
  }, [allSuppliers]);

  const suppliers = useMemo(() => {
    const byStatus = statusFilter
      ? allSuppliers.filter((s: any) => String(s.status || "") === statusFilter)
      : allSuppliers;
    if (!searchTerm) return byStatus;
    const term = searchTerm.toLowerCase();
    return byStatus.filter(
      (s: any) =>
        s.supplierCode?.toLowerCase().includes(term) ||
        s.legalName?.toLowerCase().includes(term) ||
        s.displayName?.toLowerCase().includes(term)
    );
  }, [allSuppliers, searchTerm, statusFilter]);

  const totalPages = Math.ceil(suppliers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedSuppliers = suppliers.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleOpenView = useCallback((sup: any) => {
    setSelectedSupplier(sup);
    setShowViewModal(true);
  }, []);

  const handleEdit = useCallback(
    (sup: any) => {
      navigate(`/suppliers/edit/${sup.id}`, {
        state: sup,
      });
    },
    [navigate]
  );

  const handleViewPricing = useCallback(
    (sup: any) => {
      navigate(`/suppliers/${sup.id}/material-prices`);
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: string) => {
    setSupplierToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (supplierToDelete !== null && !isDeleting) {
      setIsDeleting(true);
      try {
        await supplierService.delete(supplierToDelete);
        toast.success("Supplier deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(
          err?.response?.data?.message || err.message || err || "Failed to delete supplier"
        );
      } finally {
        setShowDeleteModal(false);
        setSupplierToDelete(null);
        setIsDeleting(false);
      }
    }
  };

  // CSV Export Configuration
  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Supplier Code", accessor: (item: any) => item.supplierCode || "" },
      { header: "Name", accessor: (item: any) => item.legalName || item.displayName || "" },
      {
        header: "Mobile",
        accessor: (item: any) =>
          Array.isArray(item.mobile) && item.mobile.length > 0
            ? item.mobile[0].number
            : typeof item.mobile === "string"
              ? item.mobile
              : "",
      },
      { header: "Email", accessor: (item: any) => item.email || "" },
      { header: "GSTIN", accessor: (item: any) => item.gstin || "" },
      {
        header: "Opening Balance",
        accessor: (item: any) => Number(item.openingBalance || 0).toFixed(2),
      },
      { header: "Balance Type", accessor: (item: any) => item.openingBalanceType || "CREDIT" },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Supplier_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const createButton = canCreateSupplier ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/suppliers/create")}>
      Add Supplier
    </ActionPill>
  ) : null;
  const filtered = Boolean(searchTerm) || Boolean(statusFilter);

  return (
    <div className={PAGE_CLASS}>
      <div>
        <PageHeader
          title="Suppliers"
          subtitle={`${(allSuppliers?.length || 0).toLocaleString("en-IN")} supplier${allSuppliers?.length === 1 ? "" : "s"} · vendors you buy raw material and services from`}
          primaryAction={createButton}
          actions={
            canExportSupplier ? (
              <ExportCSVButton
                fetchData={fetchSuppliersForExport}
                columns={csvColumns}
                filename={csvFilename}
                text="Export"
              />
            ) : null
          }
        />

        <Toolbar
          filters={[
            { key: "", label: "All", count: allSuppliers?.length || 0 },
            ...Object.keys(statusCounts)
              .filter(Boolean)
              .sort()
              .map((k) => ({ key: k, label: k, count: statusCounts[k] })),
          ]}
          filterValue={statusFilter}
          onFilterChange={(k) => {
            setStatusFilter(k);
            setCurrentPage(1);
          }}
          filtersLabel="Supplier status"
        >
          <SearchField
            data-search-input
            value={searchTerm}
            onValueChange={(v) => {
              setSearchTerm(v);
              setCurrentPage(1);
            }}
            placeholder="Search code or name"
            label="Search suppliers"
            className="sm:order-first"
          />
        </Toolbar>

        <DataTable
          error={listError}
          sourceRowCount={allSuppliers.length}
          onRetry={refresh}
          data={paginatedSuppliers}
          rowKey={(supplier) => supplier.id}
          loading={loading}
          ariaLabel="Suppliers"
          emptyMessage={filtered ? "No suppliers match these filters." : "No suppliers yet."}
          emptyAction={
            filtered ? (
              <button
                type="button"
                className="sl-btn sl-pill-md"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("");
                }}
              >
                Clear filters
              </button>
            ) : (
              createButton
            )
          }
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
              render: (_item, index) => (
                <span className="tabular-nums text-ink-subtle">{startIndex + index + 1}</span>
              ),
            },
            {
              header: "Name",
              render: (supplier) => (
                <button
                  type="button"
                  onClick={() => handleOpenView(supplier)}
                  className="min-w-0 text-left leading-tight"
                >
                  <span className="block font-semibold text-accent hover:underline underline-offset-4">
                    {supplier.legalName}
                  </span>
                  {supplier.supplierCode && (
                    <span className="mt-0.5 block text-[12px] text-ink-subtle">
                      {supplier.supplierCode}
                    </span>
                  )}
                </button>
              ),
            },
            {
              header: "Mobile",
              render: (supplier) => (
                <span className="tabular-nums text-ink-muted">
                  {Array.isArray(supplier.mobile) && supplier.mobile.length > 0
                    ? supplier.mobile[0].number
                    : typeof supplier.mobile === "string"
                      ? supplier.mobile
                      : "—"}
                </span>
              ),
            },
            {
              header: "Email",
              render: (supplier) => <span className="text-ink-muted">{supplier.email || "—"}</span>,
            },
            {
              header: "GSTIN",
              render: (supplier) => (
                <span className="tabular-nums text-ink-muted">{supplier.gstin || "—"}</span>
              ),
            },
            {
              header: "Opening balance",
              align: "right",
              render: (supplier) => {
                const bal = Number(supplier.openingBalance || 0);
                const type = supplier.openingBalanceType || "CREDIT";
                const suffix = type === "CREDIT" ? "Cr" : "Dr";
                return (
                  <span
                    className={`tabular-nums ${bal > 0 ? "font-semibold text-ink" : "text-ink-subtle"}`}
                  >
                    {formatINR(bal)} {bal > 0 ? suffix : ""}
                  </span>
                );
              },
            },
            {
              header: "Status",
              render: (supplier) => (
                <StatusBadge
                  status={String(supplier.status || "").toUpperCase()}
                  customText={supplier.status}
                />
              ),
            },
            {
              header: "Actions",
              render: (supplier) => (
                <div className="flex items-center justify-end gap-1.5">
                  <ViewButton onClick={() => handleOpenView(supplier)} />
                  {/* BUG-SUP-009 fix: only show Edit / Delete actions to authorized users */}
                  {canEditSupplier && <EditButton onClick={() => handleEdit(supplier)} />}
                  {canDeleteSupplier && (
                    <DeleteButton onClick={() => triggerDelete(String(supplier.id))} />
                  )}
                </div>
              ),
              align: "right",
            },
          ]}
        />

        <SupplierViewModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          supplier={selectedSupplier}
        />

        {/* Custom Delete Confirm Modal */}
        <CommonConfirmModal
          show={showDeleteModal}
          onHide={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteConfirm}
          title="Confirm Delete"
          message="Are you sure you want to delete this supplier?"
          confirmText={isDeleting ? "Deleting..." : "Delete"}
          confirmVariant="danger"
        />
      </div>
    </div>
  );
};

export default SupplierList;
