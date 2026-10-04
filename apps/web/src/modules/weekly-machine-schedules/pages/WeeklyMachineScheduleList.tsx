import React, { useState, useMemo, useCallback, useEffect } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  ActionPill,
  Chip,
  PageHeader,
  SearchField,
  SectionLabel,
  Toolbar,
} from "../../../components/ui/v2";
import { PageBody, formatQty } from "../../production/ui";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchWeeklyPrograms,
  deleteWeeklyProgram,
  weeklyProgramDeleted,
} from "../../../features/weekly-programs/weeklyProgramSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { weeklyProgramService } from "../../../services/weeklyProgramService";

import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";

import { fetchMachines } from "../../../features/machines/machineSlice";
import DataTable from "../../../components/ui/table/DataTable";
import type { DataTableColumn } from "../../../components/ui/table/DataTable";

import { usePermission } from "../../../hooks/usePermission";

const ITEMS_PER_PAGE = 20;

const WeeklyMachineScheduleList: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const getFormattedWeekLabel = (startDateStr: string, endDateStr: string) => {
    try {
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
      return `${start.toLocaleDateString("en-US", opt)} - ${end.toLocaleDateString("en-US", opt)}`;
    } catch {
      return `${startDateStr} - ${endDateStr}`;
    }
  };

  const canDeleteSchedule = (schedule: any, orderStatus: string) => {
    if (!can("weekly_programs.delete")) return false;
    const lockedStatuses = [
      "DAILY_PLANNED",
      "IN_PROGRESS",
      "IN_PRODUCTION",
      "POST_PRODUCTION",
      "READY_FOR_DISPATCH",
      "DISPATCHED",
      "COMPLETED",
      "ON_HOLD",
      "FG_RECEIVED",
    ];
    const schedStatus = (schedule.status || "").toUpperCase();
    const poStatus = (orderStatus || "").toUpperCase();

    if (lockedStatuses.includes(schedStatus) || lockedStatuses.includes(poStatus)) {
      return false;
    }
    return true;
  };

  const { data, loading, error } = useAppSelector((state) => state.weeklyPrograms);

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<any | null>(null);
  const [isGroupDelete, setIsGroupDelete] = useState<boolean>(false);

  usePageShortcuts({
    onRefresh: () => dispatch(fetchWeeklyPrograms(undefined)),
    onDelete: () => setShowDeleteModal(true),
  });

  const getMondayDateStr = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const year = monday.getFullYear();
    const month = String(monday.getMonth() + 1).padStart(2, "0");
    const date = String(monday.getDate()).padStart(2, "0");
    return `${year}-${month}-${date}`;
  };

  const [filterWeekStartDate, setFilterWeekStartDate] = useState<string>(getMondayDateStr());

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");

  // Keep track of which weeks are expanded
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (weekKey: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [weekKey]: !prev[weekKey],
    }));
  };

  const fetchSchedulesForExport = useCallback(async () => {
    const res = await weeklyProgramService.getAll({ page: 1, limit: 100000 });
    const list = Array.isArray(res) ? res : res?.data || [];
    return Array.isArray(list) ? list : [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      {
        header: "Schedule No",
        accessor: (item: any) => item.programCode || item.weeklyProgramId || item.id || "",
      },
      { header: "PO Reference", accessor: (item: any) => item.productionOrderId || "" },
      {
        header: "Product",
        accessor: (item: any) =>
          item.product?.productName || item.productName || item.salesProductName || "",
      },
      {
        header: "Machine",
        accessor: (item: any) =>
          item.machine?.machineName || item.machineName || item.machineId || "",
      },
      {
        header: "Week Range",
        accessor: (item: any) =>
          item.startDate && item.endDate
            ? `${item.startDate.split("T")[0]} to ${item.endDate.split("T")[0]}`
            : "",
      },
      { header: "Target Qty", accessor: (item: any) => item.plannedQty || item.targetQty || 0 },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Weekly_Machine_Schedules_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  useEffect(() => {
    dispatch(fetchMachines());
  }, [dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    dispatch(
      fetchWeeklyPrograms({
        weekStartDate: filterWeekStartDate || undefined,
        search: debouncedSearchTerm || undefined,
      })
    );
  }, [dispatch, filterWeekStartDate, debouncedSearchTerm]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // Realtime events carry no record (F04): refetch the current view.
  useSocketSync("weeklyProgram", { deleted: weeklyProgramDeleted }, () => {
    dispatch(
      fetchWeeklyPrograms({
        weekStartDate: filterWeekStartDate || undefined,
        search: debouncedSearchTerm || undefined,
      })
    );
  });

  const handleDateChange = (e: React.ChangeEvent<any>) => {
    const val = e.target.value;
    if (val) {
      const date = new Date(val);
      if (!isNaN(date.getTime())) {
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const mondayDate = new Date(date.setDate(diff));

        const yyyy = mondayDate.getFullYear();
        const mm = String(mondayDate.getMonth() + 1).padStart(2, "0");
        const dd = String(mondayDate.getDate()).padStart(2, "0");

        setFilterWeekStartDate(`${yyyy}-${mm}-${dd}`);
      }
    } else {
      setFilterWeekStartDate("");
    }
    setCurrentPage(1);
  };

  // Group weekly programs by week period
  const groupedData = useMemo(() => {
    const safeData = Array.isArray(data) ? data : [];
    const groups: Record<string, any> = {};

    safeData.forEach((item: any) => {
      if (item.machineId === "MAC-001") return; // Exclude MAC-001

      const startStr = item.weekStartDate.split("T")[0];
      const endStr = item.weekEndDate.split("T")[0];
      const weekKey = `${startStr}_${endStr}`;

      if (!groups[weekKey]) {
        groups[weekKey] = {
          weekKey,
          weekStartDate: startStr,
          weekEndDate: endStr,
          orders: {},
        };
      }

      const poId = item.productionOrderId || "Unassigned";
      if (!groups[weekKey].orders[poId]) {
        groups[weekKey].orders[poId] = {
          productionOrderId: poId,
          productName: item.productionOrder?.productItem?.productName || "Unknown Product",
          priority: item.priority || "MEDIUM",
          machineName:
            item.machine?.machineName ||
            item.Machine?.machineName ||
            item.machineName ||
            (item.machineId ? `Machine ${item.machineId}` : "Machine Not Assigned"),
          plannedQty: 0,
          uom: item.productionOrder?.uom || item.uom || "",
          status: item.productionOrder?.status || item.status || "PLANNED",
          schedules: [],
        };
      }

      groups[weekKey].orders[poId].plannedQty += Number(item.plannedQty) || 0;
      groups[weekKey].orders[poId].schedules.push(item);
    });

    // Convert to array of week objects
    return Object.values(groups).map((group: any) => {
      const ordersList: any[] = Object.values(group.orders);
      return {
        ...group,
        ordersList,
        totalOrders: ordersList.length,
        totalPlannedQty: ordersList.reduce((sum: number, o: any) => sum + o.plannedQty, 0),
        uom: ordersList[0]?.uom || "",
      };
    });
  }, [data]);

  const totalPages = Math.ceil(groupedData.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedGroups = groupedData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleOpenAdd = () => {
    navigate("/weekly-machine-schedules/create");
  };

  const triggerGroupDelete = useCallback((group: any) => {
    setItemToDelete(group);
    setIsGroupDelete(true);
    setShowDeleteModal(true);
  }, []);

  const triggerSingleDelete = useCallback((schedule: any) => {
    setItemToDelete(schedule.weeklyProgramId);
    setIsGroupDelete(false);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete !== null) {
      try {
        if (isGroupDelete) {
          for (const schedule of itemToDelete.schedules) {
            await dispatch(deleteWeeklyProgram(schedule.weeklyProgramId)).unwrap();
          }
          toast.success("Schedule group deleted successfully!");
        } else {
          await dispatch(deleteWeeklyProgram(itemToDelete)).unwrap();
          toast.success("Schedule deleted successfully!");
        }
        navigate("/production-orders");
      } catch (err: any) {
        toast.error(err || "Failed to delete schedule");
      } finally {
        setShowDeleteModal(false);
        setItemToDelete(null);
      }
    }
  };

  const uomLabel = (uom?: string) =>
    uom?.toLowerCase() === "ea" || uom?.toLowerCase() === "each" ? "pcs" : uom || "";

  const shiftWeek = (deltaDays: number) => {
    const base = filterWeekStartDate ? new Date(filterWeekStartDate) : new Date(getMondayDateStr());
    base.setDate(base.getDate() + deltaDays);
    const yyyy = base.getFullYear();
    const mm = String(base.getMonth() + 1).padStart(2, "0");
    const dd = String(base.getDate()).padStart(2, "0");
    setFilterWeekStartDate(`${yyyy}-${mm}-${dd}`);
    setCurrentPage(1);
  };
  const isThisWeek = filterWeekStartDate === getMondayDateStr();

  const columns: DataTableColumn<any>[] = [
    {
      header: "",
      width: "44px",
      align: "center",
      render: (row) => (
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-card-2 text-ink-muted"
          aria-hidden="true"
        >
          {expandedGroups[row.weekKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      ),
    },
    {
      header: "Week",
      accessor: "weekKey",
      render: (row) => (
        <span className="font-semibold text-ink tabular-nums">
          {getFormattedWeekLabel(row.weekStartDate, row.weekEndDate)}
        </span>
      ),
    },
    {
      header: "Production orders",
      accessor: "totalOrders",
      render: (row) => (
        <Chip size="sm">
          {row.totalOrders} Production Order{row.totalOrders === 1 ? "" : "s"}
        </Chip>
      ),
    },
    {
      header: "Weekly quantity",
      accessor: "totalPlannedQty",
      align: "right",
      render: (row) => (
        <span className="text-[16px] font-bold text-ink tabular-nums">
          {formatQty(row.totalPlannedQty)}{" "}
          <span className="text-[13px] font-normal text-ink-subtle">{uomLabel(row.uom)}</span>
        </span>
      ),
    },
  ];

  const renderSubRow = (row: any) => {
    if (!expandedGroups[row.weekKey]) return null;
    return (
      <div className="border-b border-line-soft bg-card-2 px-3 py-4 sm:px-5">
        <SectionLabel>Production orders scheduled for this week</SectionLabel>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {row.ordersList.map((order: any) => (
            <div key={order.productionOrderId} className="rounded-[16px] bg-card p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 font-mono text-[13px] font-semibold text-accent">
                    {order.productionOrderNumber || order.productionOrderId}
                  </p>
                  <p className="m-0 truncate text-[15px] font-semibold text-ink">
                    {order.productName}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-ink-subtle">Planned qty</span>
                <span className="text-[16px] font-bold text-ink tabular-nums">
                  {formatQty(order.plannedQty)}{" "}
                  <span className="text-[12px] font-normal text-ink-subtle">
                    {uomLabel(order.uom)}
                  </span>
                </span>
              </div>

              <div className="mt-3 border-t border-line-soft pt-3">
                <div className="sl-section-label mb-2">Scheduled machines</div>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {order.schedules
                    .filter((schedule: any) => Number(schedule.plannedQty) > 0)
                    .map((schedule: any) => {
                      const linkedDailyPlan =
                        schedule.productionOrder?.dailyProductionPlans?.find(
                          (dp: any) => dp.weeklyProgramId === schedule.weeklyProgramId
                        ) || schedule.productionOrder?.dailyProductionPlans?.[0];
                      const assignedMachine =
                        schedule.machine || schedule.Machine || linkedDailyPlan?.machine;
                      const assignedShift =
                        schedule.shift || schedule.Shift || linkedDailyPlan?.shift;
                      const assignedMachineId = schedule.machineId || linkedDailyPlan?.machineId;
                      const assignedShiftId = schedule.shiftId || linkedDailyPlan?.shiftId;

                      return (
                        <li
                          key={schedule.weeklyProgramId}
                          className="flex items-center justify-between gap-2 rounded-[12px] bg-card-2 px-3 py-2"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-[13px] font-semibold text-ink">
                              {assignedMachine?.machineName ||
                                schedule.machineName ||
                                (assignedMachineId
                                  ? `Machine ${assignedMachineId}`
                                  : "Machine Not Assigned")}
                            </span>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              {assignedMachineId && (
                                <span className="font-mono text-[11px] text-ink-subtle">
                                  {assignedMachineId}
                                </span>
                              )}
                              {(assignedShift?.shiftName || assignedShiftId) && (
                                <Chip size="sm">{assignedShift?.shiftName || assignedShiftId}</Chip>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-ink tabular-nums">
                              {formatQty(schedule.plannedQty)} {schedule.uom}
                            </span>
                            {canDeleteSchedule(schedule, order.status) && (
                              <DeleteButton
                                onClick={(e: any) => {
                                  e.stopPropagation();
                                  triggerSingleDelete(schedule);
                                }}
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const planButton = can("weekly_programs.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={handleOpenAdd}>
      Plan Week
    </ActionPill>
  ) : null;

  return (
    <PageBody>
      <PageHeader
        title="Weekly Machine Schedules"
        icon={<CalendarRange size={22} />}
        subtitle="Which orders run on which machine each week. Tap a week to see its orders."
        actions={
          can("weekly_programs.export") ? (
            <ExportCSVButton
              fetchData={fetchSchedulesForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : undefined
        }
        primaryAction={planButton}
      />

      <div>
        <Toolbar>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftWeek(-7)}
              aria-label="Previous week"
              className="sl-icon-btn sl-icon-btn-md"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <div className="w-[170px]">
              <DatePickerCalendar
                name="filterWeek"
                value={filterWeekStartDate}
                onChange={(e) => handleDateChange(e as any)}
              />
            </div>
            <button
              type="button"
              onClick={() => shiftWeek(7)}
              aria-label="Next week"
              className="sl-icon-btn sl-icon-btn-md"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
          <Chip
            size="lg"
            selected={isThisWeek}
            onClick={() => {
              setFilterWeekStartDate(getMondayDateStr());
              setCurrentPage(1);
            }}
          >
            This week
          </Chip>
          <Chip
            size="lg"
            selected={!filterWeekStartDate}
            onClick={() => {
              setFilterWeekStartDate("");
              setCurrentPage(1);
            }}
          >
            All weeks
          </Chip>
          <SearchField
            data-search-input
            value={searchTerm}
            onValueChange={(v) => {
              setSearchTerm(v);
              setCurrentPage(1);
            }}
            placeholder="Search..."
            label="Search schedules"
          />
        </Toolbar>

        <DataTable
          ariaLabel="Weekly machine schedules"
          columns={columns}
          data={paginatedGroups}
          rowKey={(row) => row.weekKey}
          loading={loading}
          onRowClick={(row) => toggleGroup(row.weekKey)}
          renderSubRow={renderSubRow}
          emptyMessage={
            searchTerm
              ? "No weekly schedules match this search."
              : "No weekly schedules for this week yet."
          }
          emptyAction={searchTerm ? undefined : planButton}
          pagination={
            totalPages > 1 ? { currentPage, totalPages, onPageChange: setCurrentPage } : undefined
          }
        />
      </div>

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Weekly Schedule Allocation"
        message={
          <>
            Are you sure you want to delete this weekly schedule allocation?
            <br />
            This will clear all shift run slots allocated to this order for the week.
          </>
        }
        confirmText="Delete"
        confirmVariant="danger"
      />
    </PageBody>
  );
};

export default WeeklyMachineScheduleList;
