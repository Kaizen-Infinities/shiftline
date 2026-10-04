import React, { useState, useMemo, useCallback, useEffect } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import { ChevronDown, ChevronUp, Clock, Lock, Plus, Timer } from "lucide-react";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SearchField,
  SectionLabel,
  StatTile,
  Toolbar,
  cx,
  type ChipTone,
} from "../../../components/ui/v2";
import { Figure, InfoItem, PageBody, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchHourlyProductions,
  deleteHourlyProduction,
  hourlyProductionCreated,
  hourlyProductionUpdated,
  hourlyProductionDeleted,
} from "../../../features/hourly-productions/hourlyProductionSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";

import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { hourlyProductionService } from "../../../services/hourlyProductionService";

import { usePermission } from "../../../hooks/usePermission";

const ITEMS_PER_PAGE = 15;

const HourlyWorkReportList: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const { data, loading, error } = useAppSelector((state) => state.hourlyProductions);
  const { user } = useAppSelector((state) => state.auth);

  const [searchTerm, setSearchTerm] = useState("");
  const getTodayDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [filterDate, setFilterDate] = useState(getTodayDateStr());
  const [currentPage, setCurrentPage] = useState(1);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedViewGroup, setSelectedViewGroup] = useState<any>(null);

  usePageShortcuts({
    onRefresh: () => dispatch(fetchHourlyProductions(undefined)),
    onDelete: () => setShowDeleteModal(true),
  });

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const params: any = {};
      if (filterDate) params.productionDate = filterDate;
      if (searchTerm) params.search = searchTerm;
      dispatch(fetchHourlyProductions(Object.keys(params).length ? params : undefined));
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [dispatch, filterDate, searchTerm]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  useSocketSync("hourlyProduction", {
    created: hourlyProductionCreated,
    updated: hourlyProductionUpdated,
    deleted: hourlyProductionDeleted,
  });

  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({});

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const fetchHourlyForExport = useCallback(async () => {
    try {
      const res = await hourlyProductionService.getAll();
      const list = Array.isArray(res) ? res : res?.data || [];
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // fallback
    }
    return Array.isArray(data) ? data : [];
  }, [data]);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      {
        header: "Date",
        accessor: (item: any) => (item.productionDate ? item.productionDate.split("T")[0] : ""),
      },
      { header: "Hour", accessor: (item: any) => item.hourSlot || item.hourIndex || "" },
      { header: "PO Reference", accessor: (item: any) => item.productionOrderId || "" },
      {
        header: "Product",
        accessor: (item: any) => item.product?.productName || item.productName || "",
      },
      {
        header: "Machine",
        accessor: (item: any) => item.machine?.machineName || item.machineId || "",
      },
      { header: "Shift", accessor: (item: any) => item.shift?.shiftName || item.shiftId || "" },
      { header: "Produced Qty", accessor: (item: any) => item.qtyProduced || 0 },
      { header: "Reject Qty", accessor: (item: any) => item.rejectQty || 0 },
      { header: "Scrap Qty", accessor: (item: any) => item.scrapQty || 0 },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Hourly_Production_Logs_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const groupedData = useMemo(() => {
    const safeData = Array.isArray(data) ? data : [];

    const filtered = safeData;

    // Group by Date + Machine + Shift
    const groups: { [key: string]: any } = {};

    filtered.forEach((item: any) => {
      const dateStr = item.productionDate ? item.productionDate.split("T")[0] : "";
      const key = `${dateStr}_${item.machineId}_${item.shiftId}`;

      if (!groups[key]) {
        let shiftTotalHours = 8;
        if (item.shift?.startTime && item.shift?.endTime) {
          const [startH, startM] = item.shift.startTime.split(":").map(Number);
          const [endH, endM] = item.shift.endTime.split(":").map(Number);
          const startMin = startH * 60 + startM;
          let endMin = endH * 60 + endM;
          if (endMin <= startMin) endMin += 24 * 60;
          shiftTotalHours = Math.floor((endMin - startMin) / 60);
        }

        groups[key] = {
          key,
          productionDate: dateStr,
          machineId: item.machineId,
          machineName: item.machine?.machineName || item.machineId,
          shiftId: item.shiftId,
          shiftName: item.shift?.shiftName || item.shiftId,
          productionOrderId: item.productionOrderId,
          productName: item.productionOrder?.productItem?.productName || "Unknown Product",
          productCode: item.productionOrder?.productItem?.productCode || "",
          uom:
            (item.productionOrder?.productItem?.uom?.uomCode?.toUpperCase() === "EA"
              ? "PCS"
              : item.productionOrder?.productItem?.uom?.uomCode?.toUpperCase()) || "PCS",
          plannedQty: Number(item.shiftPlannedQty || item.productionOrder?.targetQty || 0),
          dailyPlanId: item.dailyPlanId,
          poTargetQty: Number(item.productionOrder?.targetQty || 0),
          weeklyProgramStatus: item.weeklyProgramStatus || null,
          weeklyProgramId: item.weeklyProgramId || null,
          totalQtyProduced: 0,
          totalRejectQty: 0,
          totalScrapQty: 0,
          totalDowntime: 0,
          hours: [],
          shiftTotalHours: shiftTotalHours,
        };
      }

      if (Number(item.hourIndex) > 0) {
        groups[key].totalQtyProduced += Number(item.qtyProduced || 0);
        groups[key].totalRejectQty += Number(item.rejectQty || 0);
        groups[key].totalScrapQty += Number(item.scrapQty || 0);
        groups[key].totalDowntime += Number(item.downtime || 0);
        groups[key].hours.push(item);
      }
    });

    // Convert back to array and sort by Date desc, Machine asc, Shift asc
    const result = Object.values(groups).sort((a: any, b: any) => {
      const dateCompare = b.productionDate.localeCompare(a.productionDate);
      if (dateCompare !== 0) return dateCompare;
      const machineCompare = a.machineName.localeCompare(b.machineName);
      if (machineCompare !== 0) return machineCompare;
      return a.shiftName.localeCompare(b.shiftName);
    });

    // Sort the nested hours in each group by hourIndex asc
    result.forEach((group: any) => {
      group.hours.sort((x: any, y: any) => Number(x.hourIndex) - Number(y.hourIndex));
    });

    // Show a group if:
    // 1. It has real hourly entries (positive hourIndex)
    // 2. OR it's actively IN_PROGRESS (started but no entries yet) so user can log the first hour
    // We intentionally exclude PLANNED/COMPLETED groups with 0 entries to avoid ghost rows
    return result.filter((group: any) => {
      if (group.hours.length > 0) return true;
      // Show active sessions so user can add their first hourly entry
      return group.weeklyProgramStatus === "IN_PROGRESS";
    });
  }, [data]);

  const totalPages = Math.ceil(groupedData.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedData = groupedData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const isGroupEditDisabled = useCallback((group: any) => {
    const isStoppedOrCompleted = ["COMPLETED", "STOPPED", "CANCELLED"].includes(
      group.weeklyProgramStatus
    );
    const hasLastHourLogged = group.hours.some(
      (hr: any) => Number(hr.hourIndex) >= group.shiftTotalHours
    );
    return isStoppedOrCompleted || hasLastHourLogged;
  }, []);

  const handleOpenEdit = useCallback(
    (group: any, item: any) => {
      const disabled = isGroupEditDisabled(group);
      navigate(`/hourly-work-reports/edit/${item.hourlyProductionId}`, {
        state: { ...item, isEditDisabled: disabled },
      });
    },
    [navigate, isGroupEditDisabled]
  );

  const handleAddHourly = (group: any) => {
    const nextHourIndex = group.hours.length + 1;

    navigate("/hourly-work-reports/create", {
      state: {
        machineId: group.machineId,
        productionDate: group.productionDate,
        shiftId: group.shiftId,
        shiftName: group.shiftName,
        productionOrderId: group.productionOrderId,
        productName: group.productName,
        productCode: group.productCode,
        plannedQty: group.plannedQty,
        uom: group.uom,
        dailyPlanId: group.dailyPlanId,
        hourIndex: nextHourIndex,
      },
    });
  };

  const triggerDelete = useCallback((id: string) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (itemToDelete !== null) {
      try {
        await dispatch(deleteHourlyProduction(itemToDelete)).unwrap();
        toast.success("Hourly entry deleted successfully!");
      } catch (err: any) {
        toast.error(err || "Failed to delete hourly entry");
      } finally {
        setShowDeleteModal(false);
        setItemToDelete(null);
      }
    }
  };

  const handleView = (group: any) => {
    setSelectedViewGroup(group);
    setShowViewModal(true);
  };

  const groupStatus = (group: any): { label: string; tone: ChipTone } => {
    if (group.weeklyProgramStatus === "IN_PROGRESS" && group.hours.length === 0)
      return { label: "Running", tone: "success" };
    const closed =
      group.hours.length >= group.shiftTotalHours ||
      ["COMPLETED", "STOPPED", "CANCELLED"].includes(group.weeklyProgramStatus);
    if (!closed) return { label: "Open", tone: "default" };
    if (
      group.totalQtyProduced >= group.plannedQty ||
      group.hours.length >= group.shiftTotalHours ||
      group.weeklyProgramStatus === "COMPLETED"
    )
      return { label: "Completed", tone: "success" };
    if (group.weeklyProgramStatus === "STOPPED") return { label: "Stopped", tone: "danger" };
    if (group.weeklyProgramStatus === "CANCELLED") return { label: "Cancelled", tone: "danger" };
    return { label: "On Hold", tone: "warning" };
  };

  const dayTotals = useMemo(
    () =>
      groupedData.reduce(
        (acc: any, g: any) => ({
          produced: acc.produced + g.totalQtyProduced,
          reject: acc.reject + g.totalRejectQty,
          scrap: acc.scrap + g.totalScrapQty,
          downtime: acc.downtime + g.totalDowntime,
        }),
        { produced: 0, reject: 0, scrap: 0, downtime: 0 }
      ),
    [groupedData]
  );

  const columns: DataTableColumn<any>[] = useMemo(
    () => [
      {
        header: "",
        width: "44px",
        align: "center",
        render: (group) => {
          const isExpanded = !!expandedGroups[group.key];
          return (
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-card-2 text-ink-muted"
              aria-hidden="true"
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          );
        },
      },
      {
        header: "Machine · shift",
        render: (group) => (
          <div className="py-1">
            <div className="font-semibold text-ink">{group.machineName}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Chip size="sm">{group.shiftName}</Chip>
              <span className="sl-muted text-[12px] tabular-nums">
                {formatDate(group.productionDate)}
              </span>
            </div>
          </div>
        ),
      },
      {
        header: "Order · product",
        render: (group) => (
          <div className="min-w-0 py-1">
            <div className="font-mono text-[13px] font-semibold text-accent">
              {group.productionOrderId}
            </div>
            <div className="max-w-[240px] truncate text-ink-muted" title={group.productName}>
              {group.productName}
            </div>
          </div>
        ),
      },
      {
        header: "Hours",
        render: (group) => {
          const isActiveNoEntry =
            group.weeklyProgramStatus === "IN_PROGRESS" && group.hours.length === 0;
          if (isActiveNoEntry) {
            return (
              <Chip size="sm" tone="success" dot>
                Running
              </Chip>
            );
          }
          return (
            <span className="font-semibold text-ink tabular-nums">
              {group.hours.length}
              <span className="text-ink-subtle">/{group.shiftTotalHours}</span>
            </span>
          );
        },
      },
      {
        header: "Produced / target",
        align: "right",
        render: (group) => {
          const isActiveNoEntry =
            group.weeklyProgramStatus === "IN_PROGRESS" && group.hours.length === 0;
          const pct =
            group.plannedQty > 0
              ? Math.min(100, (group.totalQtyProduced / group.plannedQty) * 100)
              : 0;
          return (
            <div className="min-w-[130px] py-1 text-right">
              <div className="tabular-nums">
                <span className="text-[16px] font-bold text-ink">
                  {isActiveNoEntry ? "—" : formatQty(group.totalQtyProduced)}
                </span>
                <span className="text-ink-subtle">
                  {" "}
                  / {formatQty(group.plannedQty)} {group.uom}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card-2">
                <div className="h-full rounded-full bg-cta" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        },
      },
      {
        header: "Reject · scrap",
        align: "right",
        render: (group) => (
          <span className="tabular-nums">
            <span
              className={
                group.totalRejectQty > 0
                  ? "font-semibold text-[color:var(--color-danger)]"
                  : "text-ink-subtle"
              }
            >
              R {formatQty(group.totalRejectQty)}
            </span>
            <span className="mx-1.5 text-ink-subtle">·</span>
            <span
              className={
                group.totalScrapQty > 0
                  ? "font-semibold text-[color:var(--color-warning)]"
                  : "text-ink-subtle"
              }
            >
              S {formatQty(group.totalScrapQty)}
            </span>
          </span>
        ),
      },
      {
        header: "Downtime",
        align: "right",
        render: (group) => (
          <span className="text-ink-muted tabular-nums">
            {group.totalDowntime > 0 ? `${group.totalDowntime} min` : "—"}
          </span>
        ),
      },
      {
        header: "Actions",
        align: "right",
        render: (group) => {
          const status = groupStatus(group);
          const closed =
            group.hours.length >= group.shiftTotalHours ||
            group.weeklyProgramStatus === "COMPLETED" ||
            group.weeklyProgramStatus === "STOPPED" ||
            group.weeklyProgramStatus === "CANCELLED";
          return (
            <div className="text-right" onClick={(e) => e.stopPropagation()}>
              {closed ? (
                <div className="flex flex-col items-end justify-center gap-1 py-1">
                  <div className="flex items-center justify-end gap-2">
                    <Chip size="sm" tone={status.tone} dot>
                      {status.label}
                    </Chip>
                    {can("hourly_productions.view") && (
                      <ViewButton onClick={() => handleView(group)} />
                    )}
                  </div>
                  {group.totalQtyProduced < group.plannedQty ? (
                    <span className="text-[12px] font-semibold text-[color:var(--color-danger)] tabular-nums">
                      Pending: {formatQty(group.plannedQty - group.totalQtyProduced)} {group.uom}
                    </span>
                  ) : group.totalQtyProduced > group.plannedQty ? (
                    <span className="text-[12px] font-semibold text-[color:var(--color-success)] tabular-nums">
                      Extra: +{formatQty(group.totalQtyProduced - group.plannedQty)} {group.uom}
                    </span>
                  ) : null}
                </div>
              ) : (
                can("hourly_productions.create") && (
                  <ActionPill
                    size="sm"
                    icon={<Plus size={15} />}
                    onClick={() => handleAddHourly(group)}
                  >
                    Add Hourly
                  </ActionPill>
                )
              )}
            </div>
          );
        },
      },
    ],
    [expandedGroups]
  );

  const renderSubRow = useCallback(
    (group: any) => {
      const isExpanded = !!expandedGroups[group.key];
      if (!isExpanded) return null;

      return (
        <div className="border-b border-line-soft bg-card-2 p-3 sm:p-4">
          <div className="rounded-[16px] bg-card p-4 sm:p-5">
            <SectionLabel>Shift summary</SectionLabel>
            <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Figure
                label="Efficiency (OEE)"
                tone="accent"
                value={`${
                  group.plannedQty > 0
                    ? ((group.totalQtyProduced / group.plannedQty) * 100).toFixed(1)
                    : 0
                }%`}
              />
              <Figure
                label="Total Produced"
                tone="success"
                value={formatQty(group.totalQtyProduced)}
                hint={group.uom}
              />
              <Figure
                label="Scrap Rate"
                tone="warning"
                value={`${
                  group.totalQtyProduced > 0
                    ? ((group.totalScrapQty / group.totalQtyProduced) * 100).toFixed(1)
                    : 0
                }%`}
              />
              <Figure
                label="Total Downtime"
                tone={group.totalDowntime > 0 ? "danger" : "default"}
                value={group.totalDowntime > 0 ? `${group.totalDowntime} min` : "0 min"}
              />
            </div>

            <SectionLabel>Hourly Timeline</SectionLabel>
            {group.hours.length === 0 ? (
              <EmptyState
                compact
                icon={<Clock size={22} />}
                title="No hours logged yet for this shift."
                description='Use "Add Hourly" to log the first hour.'
              />
            ) : (
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {group.hours.map((h: any) => {
                  const hasIssues = h.scrapQty > 0 || h.downtime > 0 || h.rejectQty > 0;
                  return (
                    <li
                      key={h.hourlyProductionId}
                      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[14px] bg-card-2 p-3 sm:flex-nowrap"
                    >
                      <div className="flex min-w-[64px] items-center gap-2">
                        <span
                          className={cx(
                            "h-9 w-1.5 rounded-full",
                            hasIssues
                              ? "bg-[color:var(--color-danger)]"
                              : "bg-[color:var(--color-success)]"
                          )}
                          aria-hidden="true"
                        />
                        <div>
                          <div className="text-[11px] font-medium text-ink-subtle">Hour</div>
                          <div className="text-[20px] font-bold leading-none text-ink tabular-nums">
                            {h.hourIndex}
                          </div>
                        </div>
                      </div>
                      <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-5">
                        <Figure
                          label="Produced"
                          tone="success"
                          value={formatQty(h.qtyProduced)}
                          hint={group.uom}
                        />
                        <Figure
                          label="Reject"
                          tone={h.rejectQty > 0 ? "danger" : "default"}
                          value={formatQty(h.rejectQty || 0)}
                        />
                        <Figure
                          label="Scrap"
                          tone={h.scrapQty > 0 ? "warning" : "default"}
                          value={formatQty(h.scrapQty || 0)}
                        />
                        <Figure
                          label="Downtime"
                          tone={h.downtime > 0 ? "danger" : "default"}
                          value={h.downtime > 0 ? `${h.downtime} min` : "—"}
                          hint={h.downtimeReason || undefined}
                        />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-ink-subtle">Operator</div>
                          <div
                            className="truncate text-[14px] font-medium text-ink"
                            title={h.operatorName || h.operatorId}
                          >
                            {h.operatorName || h.operatorId || "—"}
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        {!isGroupEditDisabled(group) ? (
                          <>
                            {can("hourly_productions.edit") && (
                              <EditButton onClick={() => handleOpenEdit(group, h)} />
                            )}
                            {(can("hourly_productions.delete") ||
                              user?.roleId === "ROLE_ADMIN") && (
                              <DeleteButton
                                onClick={() => triggerDelete(h.hourlyProductionId?.toString())}
                              />
                            )}
                          </>
                        ) : (
                          <Chip size="sm" tone="muted" icon={<Lock size={12} />}>
                            Locked
                          </Chip>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      );
    },
    [expandedGroups, handleAddHourly, handleOpenEdit, triggerDelete, user?.roleId]
  );

  const isToday = filterDate === getTodayDateStr();

  return (
    <PageBody>
      <PageHeader
        title="Hourly work reports"
        icon={<Timer size={22} />}
        subtitle={`${filterDate ? formatDate(filterDate) : "All dates"}${isToday ? " (today)" : ""} · ${groupedData.length} machine shift${groupedData.length === 1 ? "" : "s"}. Tap a row for its hour-by-hour timeline.`}
        actions={
          can("hourly_productions.export") ? (
            <ExportCSVButton
              fetchData={fetchHourlyForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : undefined
        }
        primaryAction={
          can("hourly_productions.create") ? (
            <ActionPill
              icon={<Plus size={18} />}
              onClick={() => navigate("/hourly-work-reports/create")}
            >
              Log Hour
            </ActionPill>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Produced" value={formatQty(dayTotals.produced)} loading={loading} />
        <StatTile label="Rejected" value={formatQty(dayTotals.reject)} loading={loading} />
        <StatTile label="Scrap" value={formatQty(dayTotals.scrap)} loading={loading} />
        <StatTile label="Downtime" value={`${dayTotals.downtime} min`} loading={loading} />
      </div>

      <div>
        <Toolbar>
          <SearchField
            data-search-input
            value={searchTerm}
            onValueChange={(v) => {
              setSearchTerm(v);
              setCurrentPage(1);
            }}
            placeholder="Search by PO, Product, Machine..."
            label="Search hourly logs"
          />
          <div className="w-full sm:w-[190px]">
            <DatePickerCalendar
              name="dateFilter"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          {!isToday && (
            <Chip size="lg" onClick={() => setFilterDate(getTodayDateStr())}>
              Today
            </Chip>
          )}
        </Toolbar>

        <DataTable
          ariaLabel="Hourly production by machine shift"
          columns={columns}
          data={paginatedData}
          rowKey={(group) => group.key}
          loading={loading}
          emptyMessage={
            searchTerm
              ? "No hourly logs match this search."
              : "No hourly reports found for this date."
          }
          onRowClick={(group) => toggleGroup(group.key)}
          renderSubRow={renderSubRow}
          getRowStyle={(group) => {
            const isActiveNoEntry =
              group.weeklyProgramStatus === "IN_PROGRESS" && group.hours.length === 0;
            if (isActiveNoEntry) {
              return {
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--color-success) 10%, var(--color-card)) 0%, var(--color-card) 100%)",
                boxShadow: "inset 4px 0 0 var(--color-success)",
              };
            }
            return {};
          }}
          pagination={{
            currentPage,
            totalPages,
            onPageChange: setCurrentPage,
          }}
        />
      </div>

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Hourly Entry"
        message="Are you sure you want to delete this hourly production log? This action cannot be undone."
        confirmText="Delete"
        confirmVariant="danger"
      />

      {/* View Modal for Completed Shifts */}
      {selectedViewGroup && (
        <CommonModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          title={`Hourly Entries — ${selectedViewGroup.shiftName}`}
          maxWidth="5xl"
        >
          <dl className="m-0 mb-5 grid grid-cols-2 gap-4 rounded-[16px] bg-card-2 p-4 md:grid-cols-5">
            <InfoItem label="Date" value={formatDate(selectedViewGroup.productionDate)} />
            <InfoItem label="Machine" value={selectedViewGroup.machineName} />
            <InfoItem label="Product" value={selectedViewGroup.productName} />
            <InfoItem label="PO ID" value={selectedViewGroup.productionOrderId} mono />
            <InfoItem
              label="Operator(s)"
              value={
                selectedViewGroup.hours && selectedViewGroup.hours.length > 0
                  ? [
                      ...new Set(
                        selectedViewGroup.hours
                          .map((h: any) => h.operatorName || h.operatorId)
                          .filter(Boolean)
                      ),
                    ].join(", ")
                  : "N/A"
              }
            />
          </dl>

          <div className="overflow-x-auto rounded-[16px] border border-line-soft">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft bg-card-2">
                  {["Hour", "Produced", "Reject", "Scrap", "Downtime", "Operator", "Remarks"].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={cx(
                          "sl-th px-4 py-3",
                          i >= 1 && i <= 4 ? "text-right" : "text-left"
                        )}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {selectedViewGroup.hours.map((hour: any, idx: number) => (
                  <tr key={hour.hourlyProductionId || idx} className="border-b border-line-soft">
                    <td className="px-4 py-3 font-semibold text-ink">Hour {hour.hourIndex}</td>
                    <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">
                      {formatQty(hour.qtyProduced)}{" "}
                      <span className="text-xs font-normal text-ink-subtle">
                        {selectedViewGroup.uom}
                      </span>
                    </td>
                    <td
                      className={cx(
                        "px-4 py-3 text-right tabular-nums",
                        hour.rejectQty > 0
                          ? "font-semibold text-[color:var(--color-danger)]"
                          : "text-ink-subtle"
                      )}
                    >
                      {formatQty(hour.rejectQty || 0)}
                    </td>
                    <td
                      className={cx(
                        "px-4 py-3 text-right tabular-nums",
                        hour.scrapQty > 0
                          ? "font-semibold text-[color:var(--color-warning)]"
                          : "text-ink-subtle"
                      )}
                    >
                      {formatQty(hour.scrapQty || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-muted tabular-nums">
                      {hour.downtime > 0 ? `${hour.downtime} min` : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">
                      {hour.operatorName || hour.operatorId || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-subtle">{hour.remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-card-2">
                  <td className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
                    Total
                  </td>
                  <td
                    className={cx(
                      "px-4 py-3 text-right text-lg font-bold tabular-nums",
                      selectedViewGroup.totalQtyProduced >= selectedViewGroup.plannedQty
                        ? "text-[color:var(--color-success)]"
                        : "text-[color:var(--color-danger)]"
                    )}
                  >
                    {formatQty(selectedViewGroup.totalQtyProduced)}
                    <span className="ml-1 text-xs font-normal text-ink-subtle">
                      {selectedViewGroup.uom}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">
                    {formatQty(selectedViewGroup.totalRejectQty)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-ink tabular-nums">
                    {formatQty(selectedViewGroup.totalScrapQty)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-ink-muted tabular-nums">
                    {selectedViewGroup.totalDowntime > 0
                      ? `${selectedViewGroup.totalDowntime} min`
                      : "—"}
                  </td>
                  <td colSpan={2} className="px-4 py-3 text-xs text-ink-subtle">
                    <span className="font-semibold text-ink-muted">Planned:</span>{" "}
                    {formatQty(selectedViewGroup.plannedQty)} {selectedViewGroup.uom}
                    {selectedViewGroup.totalQtyProduced < selectedViewGroup.plannedQty && (
                      <Chip size="sm" tone="danger" className="ml-3">
                        ↓{" "}
                        {formatQty(
                          selectedViewGroup.plannedQty - selectedViewGroup.totalQtyProduced
                        )}{" "}
                        {selectedViewGroup.uom} short
                      </Chip>
                    )}
                    {selectedViewGroup.totalQtyProduced > selectedViewGroup.plannedQty && (
                      <Chip size="sm" tone="success" className="ml-3">
                        ↑ +
                        {formatQty(
                          selectedViewGroup.totalQtyProduced - selectedViewGroup.plannedQty
                        )}{" "}
                        {selectedViewGroup.uom} extra
                      </Chip>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CommonModal>
      )}
    </PageBody>
  );
};

export default HourlyWorkReportList;
