import React, { useState, useCallback, useEffect, useMemo } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useListCache } from "../../../hooks/useListCache";
import { machineService } from "../../../services/machineService";

import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable from "../../../components/ui/table/DataTable";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import MachineViewModal from "../components/MachineViewModal";
import { Cog, Plus, Users } from "lucide-react";
import {
  ActionPill,
  Chip,
  PageHeader,
  SearchField,
  Toolbar,
  actionPillClass,
} from "../../../components/ui/v2";
import { PageBody, RowActions, humanize } from "../../production/ui";
import { useEmployees } from "../../../hooks/useEmployees";
import { usePermission } from "../../../hooks/usePermission";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";

const ITEMS_PER_PAGE = 15;

const MachineList: React.FC = () => {
  const navigate = useNavigate();
  const { employees, loadEmployees } = useEmployees();
  const { can } = usePermission();
  const canCreateMachine = can("machines.create");
  const canEditMachine = can("machines.edit");
  const canDeleteMachine = can("machines.delete");
  const canExportMachine = can("machines.export");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [currentPage, setCurrentPage] = useState(1);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<any | null>(null);

  const fetchMachinesForExport = useCallback(async () => {
    const res = await machineService.getAll({ limit: 100000 });
    return Array.isArray(res) ? res : res?.machines || res?.data || [];
  }, []);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const res = await machineService.getAll({ limit: 10000 });
    const list = Array.isArray(res) ? res : res.machines || res.data || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: machines,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "machines:list",
    socketModule: "machine",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const filteredData = useMemo(() => {
    const byStatus =
      statusFilter === "all"
        ? machines
        : machines.filter((m: any) => (statusFilter === "active" ? m.isActive : !m.isActive));
    if (!searchTerm) return byStatus;
    const term = searchTerm.toLowerCase();
    return byStatus.filter(
      (m: any) =>
        m.machineId?.toLowerCase().includes(term) ||
        m.machineName?.toLowerCase().includes(term) ||
        m.technologyType?.toLowerCase().includes(term) ||
        m.machineType?.toLowerCase().includes(term)
    );
  }, [machines, searchTerm, statusFilter]);

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedData = filteredData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  useEffect(() => {
    if (can("employees.view")) {
      loadEmployees({ limit: 500 });
    }
  }, [loadEmployees, can]);

  const handleOpenEdit = useCallback(
    (item: any) => {
      navigate(`/machines/edit/${item.machineId}`, { state: item });
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
        await machineService.delete(itemToDelete);
        toast.success("Machine deleted successfully!");
        refresh();
      } catch (err: any) {
        toast.error(
          err?.response?.data?.message || err.message || err || "Failed to delete machine"
        );
      } finally {
        setShowDeleteModal(false);
        setItemToDelete(null);
        setIsDeleting(false);
      }
    }
  };

  // CSV Export Configuration
  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Machine ID", accessor: (item: any) => item.machineId },
      { header: "Machine Name", accessor: (item: any) => item.machineName },
      { header: "Tech Type", accessor: (item: any) => item.technologyType || "—" },
      { header: "Machine Type", accessor: (item: any) => item.machineType || "—" },
      {
        header: "Machine Incharge",
        accessor: (item: any) => {
          if (!item.operatorId) return "—";
          const emp = employees.find((e: any) => e.id === item.operatorId);
          return emp ? emp.fullName : item.operatorId;
        },
      },
      { header: "Status", accessor: (item: any) => (item.isActive ? "ACTIVE" : "INACTIVE") },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Machine_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, [employees]);

  const activeCount = machines.filter((m: any) => m.isActive).length;
  const statusFilters = [
    { key: "all" as const, label: "All", count: machines.length },
    { key: "active" as const, label: "Active", count: activeCount },
    { key: "inactive" as const, label: "Inactive", count: machines.length - activeCount },
  ];

  const addMachineButton = canCreateMachine ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/machines/create")}>
      Add Machine
    </ActionPill>
  ) : null;

  return (
    <PageBody>
      <PageHeader
        title="Machines"
        icon={<Cog size={22} />}
        subtitle={
          loading && machines.length === 0
            ? "Machine Management · loading…"
            : `Machine Management · ${machines.length} machine${machines.length === 1 ? "" : "s"}, ${activeCount} active`
        }
        actions={
          <>
            {can("machine-assignments.view") && (
              <Link
                to="/machines/assignments"
                className={actionPillClass({ variant: "secondary" })}
              >
                <Users size={17} aria-hidden="true" />
                Operator assignments
              </Link>
            )}
            {canExportMachine && (
              <ExportCSVButton
                fetchData={fetchMachinesForExport}
                columns={csvColumns}
                filename={csvFilename}
                text="Export"
              />
            )}
          </>
        }
        primaryAction={addMachineButton}
      />

      <div>
        <Toolbar
          filters={statusFilters}
          filterValue={statusFilter}
          onFilterChange={(key) => {
            setStatusFilter(key);
            setCurrentPage(1);
          }}
          filtersLabel="Machine status"
        >
          <SearchField
            data-search-input
            value={searchTerm}
            onValueChange={(v) => {
              setSearchTerm(v);
              setCurrentPage(1);
            }}
            placeholder="Search machines..."
            label="Search machines"
          />
        </Toolbar>

        <DataTable
          error={listError}
          onRetry={refresh}
          ariaLabel="Machines"
          data={paginatedData}
          rowKey={(item) => item.machineId}
          loading={loading}
          emptyMessage={
            searchTerm || statusFilter !== "all"
              ? "No machines match these filters."
              : "No machines yet. Add your first machine to start planning production."
          }
          emptyAction={
            searchTerm || statusFilter !== "all" ? (
              <ActionPill
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </ActionPill>
            ) : (
              addMachineButton
            )
          }
          pagination={
            totalPages > 1 ? { currentPage, totalPages, onPageChange: setCurrentPage } : undefined
          }
          columns={[
            {
              header: "Machine",
              render: (item) => (
                <div className="min-w-0 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedMachine(item);
                      setShowViewModal(true);
                    }}
                    className="block text-left font-semibold text-accent hover:underline underline-offset-4"
                  >
                    {item.machineName || item.machineId}
                  </button>
                  <span className="sl-muted font-mono text-[12px]">{item.machineId}</span>
                </div>
              ),
            },
            {
              header: "Technology",
              render: (item) => (
                <span className="block max-w-[220px] truncate" title={item.technologyType || ""}>
                  {humanize(item.technologyType)}
                </span>
              ),
            },
            {
              header: "Type",
              render: (item) =>
                item.machineType ? (
                  <Chip size="sm" tone="muted">
                    {humanize(item.machineType)}
                  </Chip>
                ) : (
                  <span className="text-ink-subtle">—</span>
                ),
            },
            {
              header: "Machine incharge",
              render: (item) => {
                if (!item.operatorId) return <span className="text-ink-subtle">—</span>;
                const emp = employees.find((e) => e.id === item.operatorId);
                const val = emp ? emp.fullName : item.operatorId;
                return (
                  <span className="block max-w-[220px] truncate" title={val}>
                    {val}
                  </span>
                );
              },
            },
            {
              header: "Status",
              width: "120px",
              render: (item) => <StatusBadge status={item.isActive ? "ACTIVE" : "INACTIVE"} />,
            },
            {
              header: "Actions",
              width: "140px",
              align: "right",
              render: (item) => (
                <RowActions>
                  <ViewButton
                    onClick={() => {
                      setSelectedMachine(item);
                      setShowViewModal(true);
                    }}
                  />
                  {canEditMachine && <EditButton onClick={() => handleOpenEdit(item)} />}
                  {canDeleteMachine && (
                    <DeleteButton onClick={() => triggerDelete(item.machineId)} />
                  )}
                </RowActions>
              ),
            },
          ]}
        />
      </div>

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Confirm Delete"
        message="Are you sure you want to delete this machine? This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete"}
        confirmVariant="danger"
        isDangerous={true}
      />

      <MachineViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        machine={selectedMachine}
      />
    </PageBody>
  );
};

export default MachineList;
