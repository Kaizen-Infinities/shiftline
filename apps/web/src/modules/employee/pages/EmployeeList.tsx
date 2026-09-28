import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { Plus, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import { ActionPill, Chip, EmptyState, PageHeader, SearchField } from "../../../components/ui/v2";
import { Avatar } from "../../payroll/components/peopleUi";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { departmentService } from "../../../services/departmentService";
import { roleService } from "../../../services/roleService";
import { employeeService } from "../../../services/employeeService";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";

const ITEMS_PER_PAGE = 15;

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "resigned", label: "Resigned" },
  { value: "terminated", label: "Terminated" },
];

const Employeelist: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const canView = can("employees.view");
  const canCreate = can("employees.create");
  const canEdit = can("employees.edit");
  const canDelete = can("employees.delete");
  const canExport = can("employees.export");

  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");

  // Draft filter state (inside popover)
  const [draftRoleId, setDraftRoleId] = useState("");
  const [draftDeptId, setDraftDeptId] = useState("");
  const [draftStatus, setDraftStatus] = useState("");

  // Applied filter state (sent to API)
  const [appliedRoleId, setAppliedRoleId] = useState("");
  const [appliedDeptId, setAppliedDeptId] = useState("");
  const [appliedStatus, setAppliedStatus] = useState("");

  // Reference data for filter dropdowns
  const [roles, setRoles] = useState<{ value: string; label: string }[]>([]);
  const [departments, setDepartments] = useState<{ value: string; label: string }[]>([]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const fetchEmployeesForExport = useCallback(async () => {
    const res = await employeeService.fetchAll({ limit: 100000 });
    return Array.isArray(res) ? res : res?.employees || res?.data || [];
  }, []);

  // Load roles and departments for filter dropdowns
  useEffect(() => {
    roleService
      .fetchAll({ limit: 200 })
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setRoles(
          list
            .filter(
              (r: any) =>
                !r.code?.toLowerCase().includes("super_admin") &&
                !r.code?.toLowerCase().includes("superadmin")
            )
            .map((r: any) => ({ value: String(r.id), label: r.name }))
        );
      })
      .catch(() => {});

    departmentService
      .fetchAll({ limit: 200 })
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setDepartments(list.map((d: any) => ({ value: String(d.id), label: d.name })));
      })
      .catch(() => {});
  }, []);

  // Fetch employees (cached)
  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await employeeService.fetchAll({ limit: 10000 });
    const list = Array.isArray(res) ? res : res.employees || res.data || [];
    return { data: list, total: res.total || list.length };
  }, []);

  const {
    data: employees,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "employees:list",
    socketModule: "employee",
    fetcher,
  });

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp: any) => {
      const matchesSearch =
        !searchTerm ||
        emp.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.empCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.mobile?.includes(searchTerm);
      const matchesRole =
        !appliedRoleId || String(emp.roleId || emp.role?.id || emp.user?.roleId) === appliedRoleId;
      const matchesDept = !appliedDeptId || String(emp.departmentId) === appliedDeptId;
      const matchesStatus = !appliedStatus || emp.status === appliedStatus;
      return matchesSearch && matchesRole && matchesDept && matchesStatus;
    });
  }, [employees, searchTerm, appliedRoleId, appliedDeptId, appliedStatus]);

  const totalPages = Math.ceil(filteredEmployees.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedEmployees = filteredEmployees.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const setStatusChip = (value: string) => {
    setAppliedStatus(value);
    setDraftStatus(value);
    setCurrentPage(1);
  };
  const statusCount = (value: string) =>
    value ? employees.filter((e: any) => e.status === value).length : employees.length;

  const activeFilterCount =
    (appliedRoleId ? 1 : 0) + (appliedDeptId ? 1 : 0) + (appliedStatus ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const handleApplyFilters = useCallback(() => {
    setAppliedRoleId(draftRoleId);
    setAppliedDeptId(draftDeptId);
    setAppliedStatus(draftStatus);
    setCurrentPage(1);
  }, [draftRoleId, draftDeptId, draftStatus]);

  const handleClearFilters = useCallback(() => {
    setDraftRoleId("");
    setDraftDeptId("");
    setDraftStatus("");
    setAppliedRoleId("");
    setAppliedDeptId("");
    setAppliedStatus("");
    setCurrentPage(1);
  }, []);

  const handleView = useCallback(
    (employee: any) => {
      navigate(`/employees/view/${employee.id}`);
    },
    [navigate]
  );

  const handleEdit = useCallback(
    (employee: any) => {
      navigate(`/employees/edit/${employee.id}`, { state: employee });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: string) => {
    setEmployeeToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (employeeToDelete && !isDeleting) {
      setIsDeleting(true);
      try {
        await employeeService.delete(employeeToDelete);
        toast.success("Employee deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(
          err?.response?.data?.message || err.message || err || "Failed to delete employee"
        );
      } finally {
        setShowDeleteModal(false);
        setEmployeeToDelete(null);
        setIsDeleting(false);
      }
    }
  };

  // CSV Export Configuration
  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Employee Code", accessor: (emp: any) => emp.empCode },
      { header: "Employee Name", accessor: (emp: any) => emp.fullName },
      { header: "Mobile", accessor: (emp: any) => emp.mobile || "—" },
      { header: "Role", accessor: (emp: any) => emp.role?.name || emp.user?.role?.name || "—" },
      { header: "Department", accessor: (emp: any) => emp.department?.name || "—" },
      {
        header: "Login Account",
        accessor: (emp: any) =>
          emp.user
            ? emp.user.status === "active"
              ? "Enabled"
              : emp.user.status?.toUpperCase() || "Disabled"
            : "No Login",
      },
      { header: "Status", accessor: (emp: any) => (emp.status ? emp.status.toUpperCase() : "—") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Employee_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const columns: DataTableColumn<any>[] = [
    {
      header: "#",
      width: "50px",
      align: "center",
      render: (_, index) => (
        <span className="text-ink-subtle tabular-nums text-xs">
          {String(startIndex + index + 1).padStart(2, "0")}
        </span>
      ),
    },
    {
      header: "Employee Code",
      width: "120px",
      render: (emp) => <span className="font-semibold text-accent">{emp.empCode}</span>,
    },
    {
      header: "Employee Name",
      render: (emp) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar name={emp.fullName} size={32} />
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{emp.fullName}</span>
            {(emp.designation || emp.department?.name) && (
              <span className="block truncate text-[12px] text-ink-subtle">
                {[emp.designation, emp.department?.name].filter(Boolean).join(" · ")}
              </span>
            )}
          </span>
        </span>
      ),
    },
    { header: "Mobile", width: "130px", render: (emp) => emp.mobile || "—" },
    {
      header: "Role",
      width: "130px",
      render: (emp) => emp.role?.name || emp.user?.role?.name || "—",
    },
    {
      header: "Login Account",
      width: "150px",
      align: "center",
      render: (emp) => {
        if (!emp.user) {
          return (
            <Chip size="sm" tone="muted" dot>
              No Login
            </Chip>
          );
        }
        const isActive = emp.user.status === "active";
        return (
          <div className="flex flex-col items-center gap-0.5">
            <Chip size="sm" tone={isActive ? "success" : "warning"} dot>
              {isActive ? "Enabled" : emp.user.status?.toUpperCase() || "Disabled"}
            </Chip>
            {emp.user.username && (
              <span className="text-[11px] tabular-nums text-ink-subtle">@{emp.user.username}</span>
            )}
          </div>
        );
      },
    },
    {
      header: "Status",
      width: "110px",
      align: "center",
      render: (emp) => {
        const statusMap: Record<string, string> = {
          active: "ACTIVE",
          inactive: "INACTIVE",
          resigned: "RESIGNED",
          terminated: "TERMINATED",
        };
        return (
          <StatusBadge status={statusMap[emp.status] ?? emp.status?.toUpperCase() ?? "INACTIVE"} />
        );
      },
    },
    {
      header: "Actions",
      width: "120px",
      align: "center",
      render: (emp) => (
        <div className="flex items-center gap-1.5">
          {canView && <ViewButton onClick={() => handleView(emp)} />}
          {canEdit && <EditButton onClick={() => handleEdit(emp)} />}
          {canDelete && <DeleteButton onClick={() => triggerDelete(emp.id)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-5 py-1 sm:py-2">
      <PageHeader
        title="Employee Management"
        icon={<Users size={20} />}
        subtitle={`${employees.length} people on the rolls`}
        actions={
          canExport ? (
            <ExportCSVButton
              fetchData={fetchEmployeesForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : undefined
        }
        primaryAction={
          canCreate ? (
            <ActionPill icon={<Plus size={17} />} onClick={() => navigate("/employees/create")}>
              Add Employee
            </ActionPill>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchField
            value={searchTerm}
            onValueChange={handleSearch}
            placeholder="Search name, code, mobile"
            data-search-input
          />
          <div
            role="group"
            aria-label="Status"
            className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
          >
            {[{ value: "", label: "All" }, ...STATUS_OPTIONS].map((o) => (
              <Chip
                key={o.value || "all"}
                size="lg"
                className="shrink-0"
                selected={appliedStatus === o.value}
                onClick={() => setStatusChip(o.value)}
                count={statusCount(o.value)}
              >
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
        <FilterPopover
          activeFilterCount={activeFilterCount}
          hasActiveFilters={hasActiveFilters}
          onApply={handleApplyFilters}
          onClear={handleClearFilters}
        >
          <div className="space-y-3">
            <div>
              <label className="sl-label">Role</label>
              <SelectInput
                name="draftRoleId"
                value={draftRoleId}
                onChange={(e) => setDraftRoleId(e.target.value)}
                options={roles}
                defaultOptionLabel="All Roles"
                noMargin
              />
            </div>
            <div>
              <label className="sl-label">Department</label>
              <SelectInput
                name="draftDeptId"
                value={draftDeptId}
                onChange={(e) => setDraftDeptId(e.target.value)}
                options={departments}
                defaultOptionLabel="All Departments"
                noMargin
              />
            </div>
            <div>
              <label className="sl-label">Status</label>
              <SelectInput
                name="draftStatus"
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                options={STATUS_OPTIONS}
                defaultOptionLabel="All Statuses"
                noMargin
              />
            </div>
          </div>
        </FilterPopover>
      </div>

      <DataTable
        error={listError}
        sourceRowCount={employees.length}
        onRetry={refresh}
        data={paginatedEmployees}
        rowKey={(emp) => emp.id}
        loading={loading}
        ariaLabel="Employees"
        emptyMessage={
          employees.length === 0 ? (
            <EmptyState
              compact
              icon={<Users size={22} strokeWidth={1.75} />}
              title="No employees found."
              description="Add your first employee to start attendance and payroll."
            />
          ) : (
            "No employees match these filters."
          )
        }
        emptyAction={
          employees.length > 0 && (searchTerm || hasActiveFilters) ? (
            <ActionPill
              variant="secondary"
              size="sm"
              onClick={() => {
                handleSearch("");
                handleClearFilters();
              }}
            >
              Clear filters
            </ActionPill>
          ) : canCreate && employees.length === 0 ? (
            <ActionPill icon={<Plus size={16} />} onClick={() => navigate("/employees/create")}>
              Add Employee
            </ActionPill>
          ) : undefined
        }
        pagination={
          totalPages > 1 ? { currentPage, totalPages, onPageChange: setCurrentPage } : undefined
        }
        columns={columns}
      />

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this employee?"
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
      />
    </div>
  );
};

export default Employeelist;
