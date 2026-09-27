import React, { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { usePermission } from "../../../hooks/usePermission";
import { useListCache } from "../../../hooks/useListCache";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";

import DataTable from "../../../components/ui/table/DataTable";
import EditButton from "../../../components/ui/EditButton/EditButton";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { Plus, ToggleLeft, ToggleRight, UserCog } from "lucide-react";
import { ActionPill, Chip, PageHeader, SearchField, Toolbar } from "../../../components/ui/v2";
import { PageBody, RowActions } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";

import {
  machineOperationAssignmentService,
  type MachineOperationAssignment,
} from "../../../services/machineOperationAssignmentService";
import { machineService } from "../../../services/machineService";
import MachineAssignmentViewModal from "../components/MachineAssignmentViewModal";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";

const ITEMS_PER_PAGE = 15;

const MachineAssignmentList: React.FC = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const { can } = usePermission();
  const canCreateAssignment = can("machine-assignments.create");
  const canEditAssignment = can("machine-assignments.edit");
  const canDeleteAssignment = can("machine-assignments.delete");
  const canExportAssignment = can("machine-assignments.export");

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "closed">("all");

  // View modal state
  const [viewModalData, setViewModalData] = useState<any>(null);

  const fetchAssignmentsForExport = useCallback(async () => {
    const res = await machineOperationAssignmentService.getAssignments({ limit: 100000 });
    return res.data || res.assignments || [];
  }, []);

  // Filters
  const [filterMachineId, setFilterMachineId] = useState("");
  const [filterWeekDate, setFilterWeekDate] = useState("");

  // Filter Popover Draft States
  const [draftMachineId, setDraftMachineId] = useState("");
  const [draftWeekDate, setDraftWeekDate] = useState("");

  // Reference lists for filters
  const [machines, setMachines] = useState<any[]>([]);

  const navigate = useNavigate();

  // Fetch reference lists for filter dropdowns
  const loadFiltersData = useCallback(async () => {
    try {
      const mRes = await machineService.getAll();
      setMachines(Array.isArray(mRes) ? mRes : mRes.machines || mRes.data || []);
    } catch (_err) {
      console.error("Failed to load filter references:", _err);
    }
  }, []);

  useSocketSync("machine", undefined, loadFiltersData);

  useEffect(() => {
    loadFiltersData();
  }, [loadFiltersData]);

  // Load assignments (cached)
  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await machineOperationAssignmentService.getAssignments({ limit: 10000 });
    const list = res.data || res.assignments || [];
    return { data: list, total: res.pagination?.total || list.length };
  }, []);

  const {
    data: allAssignments,
    loading,
    refresh,
  } = useListCache<MachineOperationAssignment>({
    cacheKey: "machineAssignments:list",
    socketModule: "machineOperationAssignment",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh() });

  const filteredAssignments = useMemo(() => {
    return allAssignments.filter((item: any) => {
      const matchesMachine = !filterMachineId || item.machineId === filterMachineId;
      const matchesWeek = !filterWeekDate || item.weekStartDate?.split("T")[0] === filterWeekDate;
      const matchesSearch =
        !searchTerm ||
        item.machineId?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.machine?.machineName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || (statusFilter === "active" ? item.isActive : !item.isActive);
      return matchesMachine && matchesWeek && matchesSearch && matchesStatus;
    });
  }, [allAssignments, filterMachineId, filterWeekDate, searchTerm, statusFilter]);

  // Apply filters from popover
  const handleApplyFilters = () => {
    setFilterMachineId(draftMachineId);
    setFilterWeekDate(draftWeekDate);
    setCurrentPage(1);
  };

  // Clear filters
  const handleClearFilters = () => {
    setDraftMachineId("");
    setDraftWeekDate("");
    setFilterMachineId("");
    setFilterWeekDate("");
    setCurrentPage(1);
  };

  // Active filter count
  const activeFilterCount = (filterMachineId ? 1 : 0) + (filterWeekDate ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  // Pagination (client-side)
  const totalPages = Math.ceil(filteredAssignments.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedData = filteredAssignments.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleOpenCreate = () => {
    navigate("/machines/assignments/create");
  };

  const handleOpenEdit = (item: any) => {
    navigate(`/machines/assignments/edit/${item.id}`);
  };

  const handleToggleStatus = async (item: any) => {
    const newStatus = !item.isActive;
    try {
      await machineOperationAssignmentService.toggleStatus(item.id, newStatus);
      toast.success(`Assignment ${newStatus ? "activated" : "closed"} successfully!`);
      refresh();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to change assignment status");
    }
  };

  // CSV Export Configuration
  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      {
        header: "Week Period",
        accessor: (item: any) =>
          `${item.weekStartDate ? item.weekStartDate.split("T")[0] : "—"} to ${item.weekEndDate ? item.weekEndDate.split("T")[0] : "—"}`,
      },
      { header: "Machine ID", accessor: (item: any) => item.machineId },
      {
        header: "Machine Name",
        accessor: (item: any) => item.machine?.machineName || item.machineId || "—",
      },
      {
        header: "Shift",
        accessor: (item: any) => item.shift?.shiftName || item.shiftId || "—",
      },
      {
        header: "Operators",
        accessor: (item: any) => {
          if (item.operators && item.operators.length > 0) {
            return item.operators
              .map((op: any) => op.employee?.fullName)
              .filter(Boolean)
              .join("; ");
          }
          return item.operatorEmployee?.fullName || "—";
        },
      },
      {
        header: "Status",
        accessor: (item: any) => (item.isActive ? "Active" : "Closed"),
      },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Machine_Assignments_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const activeCount = allAssignments.filter((a: any) => a.isActive).length;
  const statusFilters = [
    { key: "all" as const, label: "All", count: allAssignments.length },
    { key: "active" as const, label: "Active week", count: activeCount },
    { key: "closed" as const, label: "Closed", count: allAssignments.length - activeCount },
  ];
  const isFiltered = Boolean(searchTerm) || hasActiveFilters || statusFilter !== "all";

  const assignButton = canCreateAssignment ? (
    <ActionPill icon={<Plus size={18} />} onClick={handleOpenCreate}>
      Assign Operator
    </ActionPill>
  ) : null;

  return (
    <PageBody>
      <PageHeader
        title="Machine Assignments"
        icon={<UserCog size={22} />}
        subtitle="Who runs which machine, per shift and week."
        breadcrumbs={[{ label: "Machines", to: "/machines" }, { label: "Assignments" }]}
        actions={
          canExportAssignment ? (
            <ExportCSVButton
              fetchData={fetchAssignmentsForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : undefined
        }
        primaryAction={assignButton}
      />

      <div>
        <Toolbar
          filters={statusFilters}
          filterValue={statusFilter}
          onFilterChange={(key) => {
            setStatusFilter(key);
            setCurrentPage(1);
          }}
          filtersLabel="Assignment status"
          right={
            <FilterPopover
              activeFilterCount={activeFilterCount}
              hasActiveFilters={hasActiveFilters}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
            >
              <div className="space-y-3">
                <div>
                  <label className="sl-label">Machine</label>
                  <SelectInput
                    name="draftMachineId"
                    value={draftMachineId}
                    onChange={(e) => setDraftMachineId(e.target.value)}
                    options={machines.map((m) => ({
                      label: `${m.machineName} (${m.machineId})`,
                      value: m.machineId,
                    }))}
                    defaultOptionLabel="All Machines"
                    noMargin
                  />
                </div>
                <div>
                  <label className="sl-label">Week Date</label>
                  <DatePickerCalendar
                    name="draftWeekDate"
                    value={draftWeekDate}
                    onChange={(e: any) => setDraftWeekDate(e.target.value)}
                    placeholder="Select Week"
                  />
                </div>
              </div>
            </FilterPopover>
          }
        >
          <SearchField
            data-search-input
            value={searchTerm}
            onValueChange={(v) => {
              setSearchTerm(v);
              setCurrentPage(1);
            }}
            placeholder="Search machine..."
            label="Search assignments"
          />
        </Toolbar>

        <DataTable
          ariaLabel="Machine assignments"
          data={paginatedData}
          rowKey={(item: any) => item.id}
          loading={loading}
          emptyMessage={
            isFiltered
              ? "No assignments match these filters."
              : "No operators assigned yet. Assign operators to machines for the week."
          }
          emptyAction={
            isFiltered ? (
              <ActionPill
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                  handleClearFilters();
                }}
              >
                Clear filters
              </ActionPill>
            ) : (
              assignButton
            )
          }
          pagination={{
            currentPage,
            totalPages,
            onPageChange: (page) => setCurrentPage(page),
          }}
          columns={[
            {
              header: "Machine",
              render: (item) => (
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => setViewModalData(item)}
                    className="block text-left font-semibold text-accent underline-offset-4 hover:underline"
                  >
                    {(item as any).machine?.machineName || item.machineId}
                  </button>
                  <span className="sl-muted font-mono text-[12px]">{item.machineId}</span>
                </div>
              ),
            },
            {
              header: "Week",
              render: (item) => (
                <span className="font-medium text-ink tabular-nums">
                  {formatDate(item.weekStartDate)} – {formatDate(item.weekEndDate)}
                </span>
              ),
            },
            {
              header: "Shift",
              render: (item) =>
                (item as any).shift ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip size="sm">{(item as any).shift.shiftName}</Chip>
                    <span className="sl-muted text-[12px] tabular-nums">
                      {(item as any).shift.startTime}–{(item as any).shift.endTime}
                    </span>
                  </div>
                ) : (item as any).shiftId ? (
                  <Chip size="sm">{(item as any).shiftId}</Chip>
                ) : (
                  <span className="text-ink-subtle">—</span>
                ),
            },
            {
              header: "Operators",
              render: (item) =>
                (item as any).operators && (item as any).operators.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {(item as any).operators.map((op: any, i: number) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 rounded-full bg-card-2 py-0.5 pl-0.5 pr-2.5 text-[13px] font-medium text-ink"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-chip text-[11px] font-bold text-chip-fg">
                          {op.employee?.fullName?.charAt(0)?.toUpperCase() || "O"}
                        </span>
                        {op.employee?.fullName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-ink-subtle">Not assigned</span>
                ),
            },
            {
              header: "Status",
              render: (item) => (
                <Chip size="sm" dot tone={item.isActive ? "success" : "muted"}>
                  {item.isActive ? "Active Week" : "Closed / Expired"}
                </Chip>
              ),
            },
            {
              header: "Actions",
              align: "right",
              render: (item) => (
                <RowActions>
                  <ViewButton onClick={() => setViewModalData(item)} />
                  {canEditAssignment && <EditButton onClick={() => handleOpenEdit(item)} />}
                  {canDeleteAssignment && (
                    <button
                      type="button"
                      title={item.isActive ? "Close Assignment" : "Activate Assignment"}
                      aria-label={item.isActive ? "Close Assignment" : "Activate Assignment"}
                      onClick={() => handleToggleStatus(item)}
                      className={`sl-icon-btn ${item.isActive ? "sl-icon-btn-tone-success" : ""}`}
                    >
                      {item.isActive ? (
                        <ToggleRight size={18} aria-hidden="true" />
                      ) : (
                        <ToggleLeft size={18} aria-hidden="true" />
                      )}
                    </button>
                  )}
                </RowActions>
              ),
            },
          ]}
        />
      </div>

      <MachineAssignmentViewModal
        show={!!viewModalData}
        onHide={() => setViewModalData(null)}
        assignment={viewModalData}
      />
    </PageBody>
  );
};

export default MachineAssignmentList;
