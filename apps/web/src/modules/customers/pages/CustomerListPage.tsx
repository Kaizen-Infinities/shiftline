import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { Plus, X } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar } from "../../../components/ui/v2";
import { PAGE_CLASS, formatINR } from "../../sales/shared/tradeUi";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { useListCache, markStaleByPrefix } from "../../../hooks/useListCache";
import { usePermission } from "../../../hooks/usePermission";
import { useCustomerTypes } from "../../../hooks/useCustomerTypes";
import { useCustomerGrades } from "../../../hooks/useCustomerGrades";
import CustomerViewModal from "../components/CustomerViewModal";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { customerService } from "../../../services/customerService";

const ITEMS_PER_PAGE = 15;

interface FilterState {
  status: string; // "" = all  |  "Active"  |  "Inactive"
  customerTypeId: string; // "" = all  |  numeric string
  customerGradeId: string;
}

const DEFAULT_FILTERS: FilterState = {
  status: "",
  customerTypeId: "",
  customerGradeId: "",
};

const CACHE_PREFIX = "customers:";

const CustomerListPage: React.FC = () => {
  const navigate = useNavigate();
  const { customerTypes } = useCustomerTypes();
  const { customerGrades } = useCustomerGrades();

  const { can } = usePermission();
  const canCreate = can("customers.create");
  const canEditCustomer = can("customers.edit");
  const canDeleteCustomer = can("customers.delete");
  const canExport = can("customers.export");

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const location = useLocation();
  const initialSearch = new URLSearchParams(location.search).get("search") || "";
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);

  // Applied = sent to server; Draft = shown inside filter panel before Apply
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // Delete state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeFilterCount = [
    appliedFilters.status !== "",
    appliedFilters.customerTypeId !== "",
    appliedFilters.customerGradeId !== "",
  ].filter(Boolean).length;

  const hasActiveFilters = activeFilterCount > 0;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const cacheKey = `${CACHE_PREFIX}${currentPage}:${ITEMS_PER_PAGE}:${debouncedSearch}:${appliedFilters.status}:${appliedFilters.customerTypeId}:${appliedFilters.customerGradeId}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const res = await customerService.fetchAll({
        search: debouncedSearch || undefined,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
        status: appliedFilters.status || undefined,
        customerTypeId: appliedFilters.customerTypeId
          ? Number(appliedFilters.customerTypeId)
          : undefined,
        customerGradeId: appliedFilters.customerGradeId
          ? Number(appliedFilters.customerGradeId)
          : undefined,
      });
      return { data: res.customers || [], total: res.total || 0 };
    },
    [debouncedSearch, currentPage, appliedFilters]
  );

  const {
    data: customers,
    total,
    loading,
    refresh,
    error: listError,
  } = useListCache({
    cacheKey,
    socketModule: "customer",
    fetcher,
    enabled: can("customers.view"),
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const totalPages = Math.ceil((total || 0) / ITEMS_PER_PAGE);

  // ── Handlers ──────────────────────────────────────────────────────────────
  // Sync draft with applied when panel opens
  const handleFilterOpen = useCallback(() => {
    setDraftFilters(appliedFilters);
  }, [appliedFilters]);

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(draftFilters);
    setCurrentPage(1);
  }, [draftFilters]);

  const handleClearFilters = useCallback(() => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setShowViewModal(false);
    setSelectedCustomer(null);
  }, []);

  const fetchCustomersForExport = useCallback(async () => {
    // The API caps page size at 200, so walk the pages.
    const all: any[] = [];
    for (let page = 1; ; page++) {
      const res = await customerService.fetchAll({ page, limit: 200 });
      all.push(...(res?.customers || []));
      if (page >= (res?.totalPages || 1)) break;
    }
    return all;
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Customer Code", accessor: (item: any) => item.customerCode || "" },
      {
        header: "Customer Name",
        accessor: (item: any) => item.customerName || item.companyName || "",
      },
      { header: "Contact Person", accessor: (item: any) => item.contactPerson || "" },
      { header: "Mobile", accessor: (item: any) => item.mobile || "" },
      { header: "Email", accessor: (item: any) => item.email || "" },
      { header: "Customer Type", accessor: (item: any) => item.customerType?.name || "" },
      { header: "Grade", accessor: (item: any) => item.customerGrade?.name || "" },
      { header: "GSTIN", accessor: (item: any) => item.gstNumber || item.gstin || "" },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Customer_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const handleView = useCallback((customer: any) => {
    setSelectedCustomer(customer);
    setShowViewModal(true);
  }, []);

  const handleEdit = useCallback(
    (customer: any) => {
      navigate(`/customers/edit/${customer.id}`, { state: customer });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: string) => {
    setCustomerToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!customerToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await customerService.delete(customerToDelete);
      toast.success("Customer deleted successfully!");
      markStaleByPrefix(CACHE_PREFIX);
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || "Failed to delete customer");
    } finally {
      setShowDeleteModal(false);
      setCustomerToDelete(null);
      setIsDeleting(false);
    }
  }, [customerToDelete, isDeleting, refresh]);

  // ── Derived values ────────────────────────────────────────────────────────
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;

  const gradeOptions = customerGrades.map((g) => ({ label: g.name, value: g.id }));
  const typeOptions = customerTypes.map((t) => ({ label: t.name, value: t.id }));

  const activeTypeName = customerTypes.find(
    (t) => String(t.id) === appliedFilters.customerTypeId
  )?.name;
  const activeGradeName = customerGrades.find(
    (g) => String(g.id) === appliedFilters.customerGradeId
  )?.name;

  const createButton = canCreate ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/customers/create")}>
      Add Customer
    </ActionPill>
  ) : null;

  const setStatusChip = (status: string) => {
    setAppliedFilters((p) => ({ ...p, status }));
    setDraftFilters((p) => ({ ...p, status }));
    setCurrentPage(1);
  };

  const filtered = Boolean(debouncedSearch) || hasActiveFilters;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Customers"
        subtitle={
          listError && (customers ?? []).length === 0
            ? "Parties you sell to, with their GSTIN, grade and credit terms"
            : `${(total || 0).toLocaleString("en-IN")} customer${total === 1 ? "" : "s"} · parties you sell to, with their GSTIN, grade and credit terms`
        }
        primaryAction={createButton}
        actions={
          canExport ? (
            <ExportCSVButton
              fetchData={fetchCustomersForExport}
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
        searchPlaceholder="Search name, mobile, GSTIN"
        searchLabel="Search customers"
        filters={[
          { key: "", label: "All" },
          { key: "Active", label: "Active" },
          { key: "Inactive", label: "Inactive" },
        ]}
        filterValue={appliedFilters.status}
        onFilterChange={setStatusChip}
        filtersLabel="Customer status"
        right={
          <FilterPopover
            activeFilterCount={activeFilterCount}
            hasActiveFilters={hasActiveFilters}
            onOpen={handleFilterOpen}
            onApply={handleApplyFilters}
            onClear={handleClearFilters}
          >
            <div className="space-y-3">
              <SelectInput
                label="Customer Grade"
                name="filterGrade"
                value={draftFilters.customerGradeId}
                options={gradeOptions}
                defaultOptionLabel="All Grades"
                searchable={false}
                noMargin
                onChange={(e) =>
                  setDraftFilters((p) => ({ ...p, customerGradeId: e.target.value }))
                }
              />
              <SelectInput
                label="Customer Type"
                name="filterType"
                value={draftFilters.customerTypeId}
                options={typeOptions}
                defaultOptionLabel="All Types"
                searchable={false}
                noMargin
                onChange={(e) => setDraftFilters((p) => ({ ...p, customerTypeId: e.target.value }))}
              />
              <SelectInput
                label="Status"
                name="filterStatus"
                value={draftFilters.status}
                options={[
                  { value: "Active", label: "Active" },
                  { value: "Inactive", label: "Inactive" },
                ]}
                defaultOptionLabel="All Statuses"
                searchable={false}
                noMargin
                onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
              />
            </div>
          </FilterPopover>
        }
      >
        {(appliedFilters.customerTypeId || appliedFilters.customerGradeId) && (
          <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
            {appliedFilters.customerTypeId && (
              <Chip size="lg">
                Type: {activeTypeName}
                <button
                  type="button"
                  aria-label="Remove type filter"
                  className="-mr-1 inline-flex rounded-full p-0.5 hover:text-ink"
                  onClick={() => {
                    setAppliedFilters((p) => ({ ...p, customerTypeId: "" }));
                    setCurrentPage(1);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </Chip>
            )}
            {appliedFilters.customerGradeId && (
              <Chip size="lg">
                Grade: {activeGradeName}
                <button
                  type="button"
                  aria-label="Remove grade filter"
                  className="-mr-1 inline-flex rounded-full p-0.5 hover:text-ink"
                  onClick={() => {
                    setAppliedFilters((p) => ({ ...p, customerGradeId: "" }));
                    setCurrentPage(1);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </Chip>
            )}
          </div>
        )}
      </Toolbar>

      <DataTable
        error={listError}
        sourceRowCount={customers.length}
        onRetry={refresh}
        data={customers ?? []}
        rowKey={(customer) => customer.id}
        loading={loading}
        ariaLabel="Customers"
        emptyMessage={filtered ? "No customers match these filters." : "No customers yet."}
        emptyAction={
          filtered ? (
            <button
              type="button"
              className="sl-btn sl-pill-md"
              onClick={() => {
                setSearchTerm("");
                handleClearFilters();
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
            ? { currentPage, totalPages, onPageChange: (page) => setCurrentPage(page) }
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
            render: (c) => (
              <button
                type="button"
                onClick={() => handleView(c)}
                className="min-w-0 text-left leading-tight"
              >
                <span className="block font-semibold text-accent hover:underline underline-offset-4">
                  {c.firmName}
                </span>
                {(c.gstin || c.gstNumber) && (
                  <span className="mt-0.5 block text-[12px] tabular-nums text-ink-subtle">
                    {c.gstin || c.gstNumber}
                  </span>
                )}
              </button>
            ),
          },
          {
            header: "Type",
            render: (c) =>
              c.customerType?.name ? (
                <Chip size="sm" tone="muted">
                  {c.customerType.name}
                </Chip>
              ) : (
                <span className="text-ink-subtle">—</span>
              ),
          },
          {
            header: "Grade",
            render: (c) =>
              c.customerGrade?.name ? (
                <Chip size="sm">{c.customerGrade.name}</Chip>
              ) : (
                <span className="text-ink-subtle">—</span>
              ),
          },
          {
            header: "Mobile",
            render: (c) => (
              <span className="tabular-nums text-ink-muted">
                {Array.isArray(c.mobile) && c.mobile.length > 0
                  ? c.mobile[0].number
                  : typeof c.mobile === "string"
                    ? c.mobile
                    : "—"}
              </span>
            ),
          },
          {
            header: "Email",
            render: (c) => <span className="text-ink-muted">{c.email || "—"}</span>,
          },
          {
            header: "Balance",
            render: (c: any) => {
              const netBal = Number(
                c.netBalance ??
                  (c.openingBalanceType === "CREDIT"
                    ? -Math.abs(c.openingBalance || 0)
                    : Math.abs(c.openingBalance || 0))
              );
              const amt = formatINR(Math.abs(netBal));
              if (netBal > 0) {
                return <span className="font-semibold tabular-nums text-ink">{amt} Dr</span>;
              } else if (netBal < 0) {
                return <span className="font-semibold tabular-nums text-ink">{amt} Cr</span>;
              }
              return <span className="tabular-nums text-ink-subtle">₹0.00</span>;
            },
            align: "right",
          },
          {
            header: "Status",
            render: (c) => <StatusBadge status={c.status === "Active" ? "ACTIVE" : "INACTIVE"} />,
          },
          {
            header: "Actions",
            render: (customer) => (
              <div className="flex items-center justify-end gap-1.5">
                <ViewButton onClick={() => handleView(customer)} />
                {canEditCustomer && <EditButton onClick={() => handleEdit(customer)} />}
                {canDeleteCustomer && <DeleteButton onClick={() => triggerDelete(customer.id)} />}
              </div>
            ),
            align: "right",
          },
        ]}
      />

      <CustomerViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        customer={selectedCustomer}
      />

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this customer? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default CustomerListPage;
