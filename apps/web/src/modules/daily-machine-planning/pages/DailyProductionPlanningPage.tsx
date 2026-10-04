import React, { useState, useEffect, useMemo, useCallback } from "react";

import CommonModal from "../../../components/ui/Modal/CommonModal";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Cog,
  Info,
  Pencil,
  Play,
  Plus,
  Square,
} from "lucide-react";
import { ActionPill, Chip, PageHeader, StatTile, Toolbar } from "../../../components/ui/v2";
import { PageBody, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { fetchShifts } from "../../../features/shifts/shiftSlice";
import {
  fetchDailyPlans,
  updateDailyPlan,
  deleteDailyPlan,
  dailyPlanDeleted,
} from "../../../features/daily-plans/dailyPlanSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import IconButton from "../../../components/ui/IconButton/IconButton";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { dailyPlanService } from "../../../services/dailyPlanService";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import TextArea from "../../../components/form/TextArea/TextArea";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";
import { ProductionOrderViewModal } from "../../production-orders/components/ProductionOrderViewModal";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { MaterialIssueModal } from "../../production-orders/components/MaterialIssueModal";
import { usePermission } from "../../../hooks/usePermission";
import DailyPlanViewModal from "../components/DailyPlanViewModal";

// ---------- helpers ----------
const formatLocalDateString = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const STATUS_FLOW: Record<string, { label: string; next: string | null; color: string }> = {
  DRAFT: { label: "Draft", next: "PLANNED", color: "secondary" },
  PLANNED: { label: "Planned", next: "IN_PROGRESS", color: "info" },
  IN_PROGRESS: { label: "In Progress", next: "POST_PRODUCTION", color: "success" },
  POST_PRODUCTION: { label: "Post Production", next: "COMPLETED", color: "primary" },
  COMPLETED: { label: "Completed", next: null, color: "success" },
  CANCELLED: { label: "Cancelled", next: null, color: "danger" },
  STOPPED: { label: "Stopped", next: null, color: "danger" },
  SHORT_CLOSED: { label: "Completed with Shortage", next: null, color: "warning" },
};

const NEXT_ACTION_LABELS: Record<string, string> = {
  DRAFT: "Mark as Planned",
  PLANNED: "Start Production",
  IN_PROGRESS: "Move to Post Production",
  POST_PRODUCTION: "Mark Completed",
};

const NEXT_ACTION_ICONS: Record<string, any> = {
  DRAFT: CalendarDays,
  PLANNED: Play,
  IN_PROGRESS: ArrowRight,
  POST_PRODUCTION: CheckCircle2,
};

// ---------- Component ----------
const DailyProductionPlanningPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const { data: machines } = useAppSelector((state: any) => state.machines);
  const { data: dailyPlans, loading } = useAppSelector((state: any) => state.dailyPlans);
  const { data: shifts } = useAppSelector((state: any) => state.shifts);

  // filters
  const [filterDate, setFilterDate] = useState(formatLocalDateString(new Date()));
  const [filterStatus, setFilterStatus] = useState("");
  const [filterMachine, setFilterMachine] = useState("");
  const [filterShift, setFilterShift] = useState("");

  // Draft filters for popover
  const [draftFilterDate, setDraftFilterDate] = useState(formatLocalDateString(new Date()));
  const [draftFilterStatus, setDraftFilterStatus] = useState("");
  const [draftFilterMachine, setDraftFilterMachine] = useState("");
  const [draftFilterShift, setDraftFilterShift] = useState("");

  const hasActiveFilters = !!(filterDate || filterStatus || filterMachine || filterShift);
  const activeFilterCount = [filterDate, filterStatus, filterMachine, filterShift].filter(
    Boolean
  ).length;

  const handleApplyFilters = () => {
    setFilterDate(draftFilterDate);
    setFilterStatus(draftFilterStatus);
    setFilterMachine(draftFilterMachine);
    setFilterShift(draftFilterShift);
  };

  const handleClearFilters = () => {
    setDraftFilterDate("");
    setDraftFilterStatus("");
    setDraftFilterMachine("");
    setDraftFilterShift("");
    setFilterDate("");
    setFilterStatus("");
    setFilterMachine("");
    setFilterShift("");
  };

  const fetchDailyPlansForExport = useCallback(async () => {
    try {
      const res = await dailyPlanService.getAll();
      const list = Array.isArray(res) ? res : res?.data || [];
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {
      // fallback
    }
    return Array.isArray(dailyPlans) ? dailyPlans : [];
  }, [dailyPlans]);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Plan ID", accessor: (item: any) => item.dailyPlanId || item.id || "" },
      {
        header: "Date",
        accessor: (item: any) => (item.productionDate ? item.productionDate.split("T")[0] : ""),
      },
      { header: "PO Reference", accessor: (item: any) => item.productionOrderId || "" },
      {
        header: "Product",
        accessor: (item: any) =>
          item.productionOrder?.productItem?.productName || item.productName || "",
      },
      {
        header: "Machine",
        accessor: (item: any) => item.machine?.machineName || item.machineId || "",
      },
      { header: "Shift", accessor: (item: any) => item.shift?.shiftName || item.shiftId || "" },
      { header: "Planned Qty", accessor: (item: any) => item.plannedQty || 0 },
      {
        header: "Status",
        accessor: (item: any) => STATUS_FLOW[item.status]?.label || item.status || "",
      },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Daily_Production_Plans_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const handleOpenFilter = () => {
    setDraftFilterDate(filterDate);
    setDraftFilterStatus(filterStatus);
    setDraftFilterMachine(filterMachine);
    setDraftFilterShift(filterShift);
  };

  // Status / Stop modals
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);

  // Daily Plan View Modal
  const [showDailyPlanViewModal, setShowDailyPlanViewModal] = useState(false);
  const [selectedDailyPlanForView, setSelectedDailyPlanForView] = useState<any>(null);

  // Production Order View Modal
  const [showPOViewModal, setShowPOViewModal] = useState(false);
  const [selectedPOForView, setSelectedPOForView] = useState<any>(null);

  // Delete Modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePlanId, setDeletePlanId] = useState<string | null>(null);

  // Status Change Confirm Modal
  const [statusChangePlan, setStatusChangePlan] = useState<any>(null);
  const [statusChangingTo, setStatusChangingTo] = useState("");
  const [statusModalTitle, setStatusModalTitle] = useState("");
  const [statusModalMessage, setStatusModalMessage] = useState("");

  // Stop Production Modal State
  const [stopPlan, setStopPlan] = useState<any>(null);
  const [stopReason, setStopReason] = useState("");
  const [isStopping, setIsStopping] = useState(false);
  const [stopOption, setStopOption] = useState<"carry_forward" | "completed_stop">("carry_forward");

  // Material Issue Modal State
  const [showMaterialIssueModal, setShowMaterialIssueModal] = useState(false);
  const [materialIssuePlan, setMaterialIssuePlan] = useState<any>(null);
  const [rawMaterialsMap, setRawMaterialsMap] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    rawMaterialService
      .fetchAll()
      .then((res) => {
        const map = new Map();
        const dataList = Array.isArray(res) ? res : ((res as any)?.rawMaterials ?? []);
        dataList.forEach((rm: any) => {
          map.set(rm.rawMaterialId?.toString(), rm);
        });
        setRawMaterialsMap(map);
      })
      .catch((err) => console.error("Failed to load raw materials map", err));
  }, []);

  // ──────────────────────────────────────────────────────────────
  // Load data on mount
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch(fetchMachines());
    dispatch(fetchShifts());
  }, [dispatch]);

  const loadDailyPlans = useCallback(() => {
    const params: any = {};
    if (filterDate) params.productionDate = filterDate;
    if (filterStatus) params.status = filterStatus;
    if (filterMachine) params.machineId = filterMachine;
    if (filterShift) params.shiftId = filterShift;
    dispatch(fetchDailyPlans(Object.keys(params).length ? params : undefined));
  }, [dispatch, filterDate, filterStatus, filterMachine, filterShift]);

  useEffect(() => {
    loadDailyPlans();
  }, [loadDailyPlans, location.key]);

  useSocketSync("dailyPlan", { deleted: dailyPlanDeleted }, loadDailyPlans);

  useSocketSync("hourlyProduction", undefined, loadDailyPlans);
  useSocketSync("weeklyProgram", undefined, loadDailyPlans);
  useSocketSync("productionOrder", undefined, loadDailyPlans);

  // ──────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────
  // Filtered data
  // ──────────────────────────────────────────────────────────────
  const allPlans = useMemo(() => (Array.isArray(dailyPlans) ? dailyPlans : []), [dailyPlans]);

  // Active plans: show all plans sorted by insertion order (dailyPlanId ascending)
  const filteredPlans = useMemo(
    () =>
      [...allPlans].sort((a: any, b: any) =>
        String(a.dailyPlanId).localeCompare(String(b.dailyPlanId))
      ),
    [allPlans]
  );

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [filterDate, filterStatus, filterMachine, filterShift]);

  const paginatedPlans = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredPlans.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredPlans, currentPage]);

  // console.log({filteredPlans});
  const totalPages = Math.ceil(filteredPlans.length / itemsPerPage);

  // Stats (active plans only)
  const stats = useMemo(() => {
    const total = filteredPlans.length;
    const planned = filteredPlans.filter((p: any) => p.status === "PLANNED").length;
    const running = filteredPlans.filter((p: any) => p.status === "IN_PROGRESS").length;
    const completed = filteredPlans.filter((p: any) => p.status === "COMPLETED").length;
    const totalPlanned = filteredPlans.reduce(
      (s: number, p: any) => s + Number(p.plannedQty || 0),
      0
    );
    return { total, planned, running, completed, totalPlanned };
  }, [filteredPlans]);

  // ──────────────────────────────────────────────────────────────
  // Form Handlers
  // ──────────────────────────────────────────────────────────────
  const openCreateForm = () => navigate("/daily-production-plans/create");

  const openEditForm = (plan: any) => navigate(`/daily-production-plans/edit/${plan.dailyPlanId}`);

  // ──────────────────────────────────────────────────────────────
  // Delete Handler
  // ──────────────────────────────────────────────────────────────
  const handleDeleteConfirm = async () => {
    if (!deletePlanId) return;
    try {
      await dispatch(deleteDailyPlan(deletePlanId)).unwrap();
      toast.success("Daily Production Plan deleted.");
      setShowDeleteModal(false);
      setDeletePlanId(null);
      loadDailyPlans();
    } catch (err: any) {
      toast.error(err || "Failed to delete plan");
    }
  };

  // ──────────────────────────────────────────────────────────────
  // Status Change Handler
  // ──────────────────────────────────────────────────────────────
  const handleStatusAdvance = (
    plan: any,
    producedQty: number = 0,
    overrideNextStatus?: string,
    dynamicTitle?: string,
    dynamicMessage?: string
  ) => {
    const nextStatus = overrideNextStatus || STATUS_FLOW[plan.status]?.next;
    if (!nextStatus) return;

    if (nextStatus === "COMPLETED" && producedQty === 0) {
      // Allow closing permanently stopped plans that had no production at all
      const isPermanentStop = plan?.productionOrder?.status === "COMPLETED_WITH_SHORTFALL";
      if (!isPermanentStop) {
        toast.warning("Cannot mark as completed without logging any production!");
        return;
      }
    }

    if (nextStatus === "IN_PROGRESS" && (plan.status === "PLANNED" || plan.status === "DRAFT")) {
      // Always show material issue modal when starting a daily plan so users can issue/re-issue raw materials
      setMaterialIssuePlan(plan);
      setShowMaterialIssueModal(true);
      return;
    }

    setStatusChangePlan(plan);
    setStatusChangingTo(nextStatus);
    setStatusModalTitle(dynamicTitle || NEXT_ACTION_LABELS[plan.status] || "Confirm Status Change");
    setStatusModalMessage(
      dynamicMessage ||
        `Change status of plan ${plan.dailyPlanId} from "${STATUS_FLOW[plan.status]?.label}" to "${STATUS_FLOW[nextStatus]?.label || nextStatus}"?`
    );
    setShowStatusModal(true);
  };

  const handleMaterialIssueSuccess = async () => {
    if (!materialIssuePlan) return;
    try {
      await dispatch(
        updateDailyPlan({ id: materialIssuePlan.dailyPlanId, data: { status: "IN_PROGRESS" } })
      ).unwrap();
      toast.success("Materials issued and production started!");
      loadDailyPlans();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || err || "Failed to start production after material issue"
      );
    } finally {
      setMaterialIssuePlan(null);
      setShowMaterialIssueModal(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!statusChangePlan || !statusChangingTo) return;
    try {
      await dispatch(
        updateDailyPlan({ id: statusChangePlan.dailyPlanId, data: { status: statusChangingTo } })
      ).unwrap();
      toast.success(
        `Status updated to ${STATUS_FLOW[statusChangingTo]?.label || statusChangingTo}`
      );
      setShowStatusModal(false);
      setStatusChangePlan(null);
      loadDailyPlans();
    } catch (err: any) {
      toast.error(err || "Failed to update status");
    }
  };

  const handleViewDailyPlan = useCallback((plan: any) => {
    setSelectedDailyPlanForView(plan);
    setShowDailyPlanViewModal(true);
  }, []);

  const handleStopProductionClick = (plan: any) => {
    setStopPlan(plan);
    setStopReason("");
    // For already-stopped (short-closed) plans, only permanent stop makes sense
    setStopOption(
      plan.status === "STOPPED" ||
        plan.status === "SHORT_CLOSED" ||
        (plan.status === "COMPLETED" && plan.remarks?.includes("Short Closed:"))
        ? "completed_stop"
        : "carry_forward"
    );
    setShowStopModal(true);
  };

  const confirmStopProduction = async () => {
    if (!stopPlan || !stopReason.trim()) {
      toast.error("Please enter a reason for stopping production.");
      return;
    }
    setIsStopping(true);
    try {
      const loggedHoursCount = Array.isArray(stopPlan.hourlyProductions)
        ? stopPlan.hourlyProductions.filter((h: any) => Number(h.hourIndex) > 0).length
        : 0;
      const prefix = stopOption === "completed_stop" ? "Permanently Stopped" : "Short Closed";
      const updatedRemarks = stopPlan.remarks
        ? `${stopPlan.remarks} | ${prefix}: ${stopReason.trim()}`
        : `${prefix}: ${stopReason.trim()}`;

      const payload: any = {
        // Permanent stop → move to POST_PRODUCTION so produced qty can be dispatched
        // Stop Daily Plan Only → mark as STOPPED so remaining qty can be assigned later
        status: stopOption === "completed_stop" ? "POST_PRODUCTION" : "STOPPED",
        remarks: updatedRemarks,
        plannedHours: loggedHoursCount > 0 ? loggedHoursCount : stopPlan.plannedHours,
      };
      if (stopOption === "completed_stop") {
        payload.shortClosePO = true;
      }

      await dispatch(
        updateDailyPlan({
          id: stopPlan.dailyPlanId,
          data: payload,
        })
      ).unwrap();

      toast.success(
        stopOption === "completed_stop"
          ? "Production permanently stopped. Proceeding to post-production."
          : "Daily plan stopped. You can carry forward the remaining quantity."
      );

      setShowStopModal(false);
      setStopPlan(null);

      // Reload plans, the user can manually assign the remaining quantity from the weekly targets page later
      loadDailyPlans();
    } catch (err: any) {
      toast.error(err || "Failed to stop production");
    } finally {
      setIsStopping(false);
    }
  };

  // ──────────────────────────────────────────────────────────────
  // Navigate to Log Hourly Production for this plan
  // ──────────────────────────────────────────────────────────────
  const handleLogHourly = (plan: any) => {
    const nextHourIndex =
      plan.hourlyProductions && plan.hourlyProductions.length > 0
        ? Math.max(...plan.hourlyProductions.map((h: any) => Number(h.hourIndex))) + 1
        : 1;

    navigate("/hourly-work-reports/create", {
      state: {
        dailyPlanId: plan.dailyPlanId,
        machineId: plan.machineId,
        productionDate: plan.productionDate?.split("T")[0],
        shiftId: plan.shiftId,
        shiftName: plan.shift?.shiftName || plan.shiftId,
        productionOrderId: plan.productionOrderId,
        productName: plan.productionOrder?.productItem?.productName || "",
        productCode: plan.productionOrder?.productItem?.productCode || "",
        plannedQty: Number(plan.plannedQty),
        uom: plan.productionOrder?.productItem?.uom?.uomCode || "pcs",
        weeklyProgramId: plan.weeklyProgramId,
        productId: plan.productionOrder?.productItemId
          ? Number(plan.productionOrder.productItemId)
          : null,
        startTime: plan.shift?.startTime,
        endTime: plan.shift?.endTime,
        hourIndex: nextHourIndex,
      },
    });
  };

  // ──────────────────────────────────────────────────────────────
  // Table Columns
  // ──────────────────────────────────────────────────────────────
  const columns: DataTableColumn<any>[] = [
    {
      header: "Production Order",
      width: "minmax(180px, 1fr)",
      render: (plan: any) => (
        <div className="flex flex-col gap-0.5 py-1">
          <button
            type="button"
            className="w-fit cursor-pointer border-none bg-transparent p-0 text-left font-mono text-[13px] font-semibold leading-tight text-accent underline-offset-4 hover:underline"
            onClick={() => {
              setSelectedPOForView(plan.productionOrder);
              setShowPOViewModal(true);
            }}
            title="View Production Order details"
          >
            {plan.productionOrderId}
          </button>
          <span
            className="line-clamp-1 text-sm font-medium leading-tight text-ink"
            title={plan.productionOrder?.productItem?.productName}
          >
            {plan.productionOrder?.productItem?.productName || "—"}
          </span>
          {plan.carryForwardFromPlanId && (
            <Chip size="sm" tone="warning" className="mt-0.5 w-fit">
              ↩ From {plan.carryForwardFromPlanId}
            </Chip>
          )}
          {Array.isArray(plan.carryForwardTo) && plan.carryForwardTo.length > 0 && (
            <Chip size="sm" tone="info" className="mt-0.5 w-fit">
              ↪ To {plan.carryForwardTo[0].dailyPlanId}
            </Chip>
          )}
        </div>
      ),
    },
    {
      header: "Machine / Shift",
      width: "165px",
      render: (plan: any) => (
        <div className="flex flex-col gap-1 py-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Cog className="flex-shrink-0 text-accent" size={14} aria-hidden="true" />
            <span className="truncate leading-tight">
              {plan.machine?.machineName || plan.machineId || "—"}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip size="sm">{plan.shift?.shiftName || plan.shiftId || "—"}</Chip>
            {plan.shift?.startTime && plan.shift?.endTime && (
              <span className="text-ink-subtle text-[11px] font-semibold whitespace-nowrap">
                {plan.shift.startTime.slice(0, 5)} – {plan.shift.endTime.slice(0, 5)}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      header: "Planned Qty",
      width: "105px",
      align: "center",
      render: (plan: any) => {
        const plannedQty = Number(plan.plannedQty || 0);
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[15px] font-bold text-ink tabular-nums">
              {formatQty(plannedQty)}
            </span>
            <span className="text-[11px] font-medium text-ink-subtle">pcs</span>
            {plan.plannedHours && (
              <span className="text-[11px] text-ink font-semibold">{plan.plannedHours} hrs</span>
            )}
          </div>
        );
      },
    },
    {
      header: "Progress",
      width: "140px",
      align: "center",
      render: (plan: any) => {
        const plannedQty = Number(plan.plannedQty || 0);
        const producedQty = Array.isArray(plan.hourlyProductions)
          ? plan.hourlyProductions.reduce(
              (sum: number, h: any) =>
                sum +
                Math.max(
                  0,
                  Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                ),
              0
            )
          : 0;
        const progressPercent =
          plannedQty > 0 ? Math.min(100, Math.round((producedQty / plannedQty) * 100)) : 0;
        const barColor =
          progressPercent >= 100
            ? "bg-[color:var(--color-success)]"
            : progressPercent >= 50
              ? "bg-accent"
              : "bg-[color:var(--color-warning)]";

        return (
          <div className="flex flex-col items-center gap-1 w-full min-w-[80px]">
            <div className="flex items-baseline gap-1">
              <span className="text-[15px] font-bold text-ink tabular-nums">
                {progressPercent}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-card-2">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-ink-subtle tabular-nums">
              {formatQty(producedQty)} / {formatQty(plannedQty)} pcs
            </span>
          </div>
        );
      },
    },
    {
      header: "Pending / Extra",
      width: "130px",
      align: "center",
      render: (plan: any) => {
        const plannedQty = Number(plan.plannedQty || 0);
        const producedQty = Array.isArray(plan.hourlyProductions)
          ? plan.hourlyProductions.reduce(
              (sum: number, h: any) =>
                sum +
                Math.max(
                  0,
                  Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                ),
              0
            )
          : 0;
        const pendingQty = plannedQty > producedQty ? plannedQty - producedQty : 0;

        return (
          <div className="flex justify-center">
            {producedQty > plannedQty ? (
              <StatusBadge
                status="COMPLETED"
                tone="success"
                customText={`+${producedQty - plannedQty} Extra`}
              />
            ) : pendingQty > 0 && plan.status !== "CANCELLED" ? (
              <StatusBadge status="PENDING" tone="danger" customText={`${pendingQty} Pending`} />
            ) : (
              <span className="text-ink-subtle text-xs font-semibold">—</span>
            )}
          </div>
        );
      },
    },
    {
      header: "Status",
      width: "175px",
      align: "center",
      render: (plan: any) => {
        const plannedQty = Number(plan.plannedQty || 0);
        // Only count real hourly production (hourIndex > 0) for status evaluation
        const producedQty = Array.isArray(plan.hourlyProductions)
          ? plan.hourlyProductions
              .filter((h: any) => Number(h.hourIndex) > 0)
              .reduce(
                (sum: number, h: any) =>
                  sum +
                  Math.max(
                    0,
                    Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                  ),
                0
              )
          : 0;
        const customSteps = plan.productionOrder?.productItem?.productionSteps || [];
        let activeStepName = null;

        if (plan.status === "POST_PRODUCTION" && customSteps.length > 0) {
          const currentStepKey = plan.currentProductionStep || customSteps[0]?.stepKey;
          if (currentStepKey) {
            const stepIndex = customSteps.findIndex((s: any) => s.stepKey === currentStepKey) + 1;
            const displayIndex = stepIndex > 0 ? stepIndex : 1;
            activeStepName = `Step: ${currentStepKey} (${displayIndex}/${customSteps.length})`;
          }
        }

        // Only count real hourly production (hourIndex > 0), not setup/config entries
        const thisPlanProducedQty = Array.isArray(plan.hourlyProductions)
          ? plan.hourlyProductions
              .filter((h: any) => Number(h.hourIndex) > 0)
              .reduce(
                (sum: number, h: any) =>
                  sum +
                  Math.max(
                    0,
                    Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                  ),
                0
              )
          : 0;
        const totalDispatchedOnPO = Array.isArray(plan.productionOrder?.goodsDispatchItems)
          ? plan.productionOrder.goodsDispatchItems.reduce(
              (sum: number, d: any) => sum + Number(d.dispatchQty || 0),
              0
            )
          : 0;

        // Active plans (not yet done) must NEVER show dispatch-related status
        const ACTIVE_STATUSES = ["IN_PROGRESS", "PLANNED", "DRAFT"];
        if (ACTIVE_STATUSES.includes(plan.status)) {
          return (
            <div className="flex flex-col items-center gap-1">
              <StatusBadge status={plan.status} />
            </div>
          );
        }

        // Dispatch status per plan: if total dispatched on PO covers this plan's actual production → Dispatched
        const completedPlanStatus =
          plan.productionOrder?.status === "DISPATCHED"
            ? "DISPATCHED"
            : thisPlanProducedQty > 0 && totalDispatchedOnPO >= thisPlanProducedQty
              ? "DISPATCHED"
              : totalDispatchedOnPO > 0
                ? "PARTIALLY_DISPATCHED"
                : "READY_FOR_DISPATCH";
        const completedPlanLabel =
          completedPlanStatus === "DISPATCHED"
            ? "Dispatched"
            : completedPlanStatus === "PARTIALLY_DISPATCHED"
              ? "Partially Dispatched"
              : "Ready for Dispatch";

        return (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1.5">
              <StatusBadge
                status={
                  // COMPLETED plans that met target → Ready for Dispatch
                  producedQty >= plannedQty && plannedQty > 0 && plan.status === "COMPLETED"
                    ? completedPlanStatus
                    : // POST_PRODUCTION or STOPPED-cascade plans with product steps → still in post production
                      producedQty >= plannedQty &&
                        plannedQty > 0 &&
                        (plan.status === "POST_PRODUCTION" ||
                          (plan.status === "STOPPED" && customSteps.length > 0))
                      ? "POST_PRODUCTION"
                      : // STOPPED plans with no product steps that met target → Ready for Dispatch
                        producedQty >= plannedQty && plannedQty > 0 && plan.status === "STOPPED"
                        ? completedPlanStatus
                        : // Permanently Stopped
                          plan.remarks?.includes("Permanently Stopped:")
                          ? "COMPLETED_WITH_SHORTFALL"
                          : // Manually short-stopped (Short Stop action) → STOPPED/SHORT_CLOSED status with Short Closed remarks
                            (plan.status === "STOPPED" || plan.status === "SHORT_CLOSED") &&
                              producedQty < plannedQty
                            ? "SHORT_CLOSED"
                            : plan.remarks?.includes("Short Closed:") &&
                                ["POST_PRODUCTION", "COMPLETED"].includes(plan.status)
                              ? "SHORT_CLOSED"
                              : // COMPLETED with shortage (no explicit stop remarks) → Completed with Shortage
                                plan.status === "COMPLETED" && producedQty < plannedQty
                                ? "COMPLETED_WITH_SHORTFALL"
                                : // COMPLETED meeting target → dispatch status
                                  plan.status === "COMPLETED" && producedQty >= plannedQty
                                  ? completedPlanStatus
                                  : plan.status
                }
                customText={
                  // COMPLETED plans → show dispatch label
                  producedQty >= plannedQty && plannedQty > 0 && plan.status === "COMPLETED"
                    ? completedPlanLabel
                    : // POST_PRODUCTION or STOPPED-cascade with steps → Post Production
                      producedQty >= plannedQty &&
                        plannedQty > 0 &&
                        (plan.status === "POST_PRODUCTION" ||
                          (plan.status === "STOPPED" && customSteps.length > 0))
                      ? "Post Production"
                      : // STOPPED with no steps → dispatch label
                        producedQty >= plannedQty && plannedQty > 0 && plan.status === "STOPPED"
                        ? completedPlanLabel
                        : // Permanently Stopped
                          plan.remarks?.includes("Permanently Stopped:")
                          ? "Permanently Stopped"
                          : // Short Stop (manually stopped with carry forward)
                            (plan.status === "STOPPED" || plan.status === "SHORT_CLOSED") &&
                              producedQty < plannedQty
                            ? "Short Stop"
                            : plan.remarks?.includes("Short Closed:") &&
                                ["POST_PRODUCTION", "COMPLETED"].includes(plan.status)
                              ? "Short Stop"
                              : // COMPLETED with shortage naturally
                                plan.status === "COMPLETED" && producedQty < plannedQty
                                ? "Completed with Shortage"
                                : plan.status === "COMPLETED"
                                  ? completedPlanLabel
                                  : undefined
                }
              />
              {(((plan.status === "STOPPED" || plan.status === "SHORT_CLOSED") &&
                producedQty < plannedQty) ||
                plan.status === "CANCELLED" ||
                (plan.status === "COMPLETED" &&
                  (plan.remarks?.includes("Short Closed:") ||
                    plan.remarks?.includes("Permanently Stopped:")))) &&
                plan.remarks && (
                  <div
                    className="group relative flex cursor-pointer items-center"
                    tabIndex={0}
                    aria-label="Stop reason"
                  >
                    <Info
                      size={15}
                      className="text-[color:var(--color-danger)]"
                      aria-hidden="true"
                    />
                    <div className="sl-popover invisible absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 p-3 text-left text-xs text-ink opacity-0 transition-all group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100">
                      <span className="mb-1 block font-bold text-[color:var(--color-warning)]">
                        Reason:
                      </span>
                      <div>
                        {plan.remarks.includes("Permanently Stopped:") ||
                        plan.remarks.includes("Short Closed:") ||
                        plan.remarks.includes("Stopped:") ||
                        plan.remarks.includes("Cancelled:")
                          ? plan.remarks
                              .split("|")
                              .pop()
                              ?.replace("Permanently Stopped:", "")
                              ?.replace("Short Closed:", "")
                              ?.replace("Stopped:", "")
                              ?.replace("Cancelled:", "")
                              .trim()
                          : plan.remarks}
                      </div>
                    </div>
                  </div>
                )}
            </div>
            {activeStepName && plan.productionOrder?.status !== "COMPLETED_WITH_SHORTFALL" && (
              <Chip size="sm" tone="info">
                {activeStepName}
              </Chip>
            )}
          </div>
        );
      },
    },
    {
      header: "Actions",
      width: "175px",
      align: "right",
      render: (plan: any) => {
        const plannedQty = Number(plan.plannedQty || 0);
        const producedQty = Array.isArray(plan.hourlyProductions)
          ? plan.hourlyProductions.reduce(
              (sum: number, h: any) =>
                sum +
                Math.max(
                  0,
                  Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                ),
              0
            )
          : 0;
        // Count how many actual hourly slots have been logged (hourIndex > 0)
        const loggedHoursCount = Array.isArray(plan.hourlyProductions)
          ? plan.hourlyProductions.filter((h: any) => Number(h.hourIndex) > 0).length
          : 0;
        const plannedHoursCount = Number(plan.plannedHours || 0);
        const allHoursLogged = plannedHoursCount > 0 && loggedHoursCount >= plannedHoursCount;
        const nextStatus = STATUS_FLOW[plan.status]?.next;
        let canAdvance =
          !!nextStatus &&
          plan.status !== "COMPLETED" &&
          plan.status !== "CANCELLED" &&
          plan.status !== "DRAFT";
        if (plan.status === "IN_PROGRESS") canAdvance = canAdvance && producedQty >= plannedQty;
        const canLog = plan.status === "IN_PROGRESS";
        let targetNextStatus = STATUS_FLOW[plan.status]?.next;
        let dynamicActionTitle = NEXT_ACTION_LABELS[plan.status] || `Move to ${nextStatus}`;
        let dynamicActionIcon = NEXT_ACTION_ICONS[plan.status] || ArrowRight;
        let dynamicActionVariant: "info" | "primary" | "success" | "warning" | "danger" = "info";
        let dynamicModalTitle = "";
        let dynamicModalMessage = "";

        if (plan.status === "POST_PRODUCTION") {
          const customSteps = plan.productionOrder?.productItem?.productionSteps || [];
          if (customSteps.length > 0) {
            canAdvance = true;
            const totalStepsCount = customSteps.length;
            const currentIndex = plan.currentStepIndex || 1;
            const currentStepName =
              currentIndex > 0 && currentIndex <= totalStepsCount
                ? customSteps[currentIndex - 1]?.stepKey
                : "Post Production";
            const isLastStep = currentIndex >= totalStepsCount;

            if (!isLastStep) {
              const nextStepName = customSteps[currentIndex].stepKey;
              targetNextStatus = "NEXT_STEP";
              dynamicActionTitle = `Complete ${currentStepName} & Next (${nextStepName})`;
              dynamicActionIcon = ArrowRight;
              dynamicActionVariant = "info";
              dynamicModalTitle = `Advance Step (${nextStepName})`;
              dynamicModalMessage = `Complete step "${currentStepName}" and advance to "${nextStepName}"?`;
            } else {
              targetNextStatus = "COMPLETED";
              dynamicActionTitle = `Complete Final Step (${currentStepName}) & Finish Production`;
              dynamicActionIcon = CheckCircle2;
              dynamicActionVariant = "success";
              dynamicModalTitle = "Complete Production";
              dynamicModalMessage = `Complete final post-production step "${currentStepName}" and mark production order as ready for dispatch?`;
            }
          } else {
            targetNextStatus = "COMPLETED";
            dynamicActionTitle = "Complete Production";
            dynamicActionIcon = CheckCircle2;
            dynamicActionVariant = "success";
            dynamicModalTitle = "Complete Production";
            dynamicModalMessage = `Mark production order as ready for dispatch?`;
            canAdvance = true;
          }
        }

        if (plan.status === "IN_PROGRESS" && producedQty > 0) {
          targetNextStatus = "POST_PRODUCTION";
          dynamicActionTitle = allHoursLogged
            ? "Move to Post Production"
            : `Move to Post Production (${loggedHoursCount}/${plannedHoursCount} hrs logged)`;
          dynamicActionIcon = ArrowRight;
          dynamicActionVariant = "info";
          dynamicModalTitle = "Move to Post Production";
          dynamicModalMessage = `Complete manufacturing and move to Post Production phase?`;
          // Only allow advancing to post production when ALL planned hours have been logged
          canAdvance = allHoursLogged;
        }

        if ((plan.status === "STOPPED" || plan.status === "SHORT_CLOSED") && producedQty > 0) {
          targetNextStatus = "POST_PRODUCTION";
          dynamicActionTitle = "Move to Post Production";
          dynamicActionIcon = ArrowRight;
          dynamicActionVariant = "info";
          dynamicModalTitle = "Move to Post Production";
          dynamicModalMessage = `Move to Post Production phase for the produced ${producedQty} pcs?`;
          canAdvance = true;
        }

        // SHORT_CLOSED: force-stopped plan — can still do post production for the produced qty if not already completed
        // Only applies when the plan itself is already in POST_PRODUCTION (or beyond).
        // STOPPED/SHORT_CLOSED plans must first move to POST_PRODUCTION before advancing steps.
        // Permanently stopped plans that already completed post-production should NOT show advance button
        const isPermStoppedCompleted =
          plan.status === "COMPLETED" && plan.remarks?.includes("Permanently Stopped:");
        if (isPermStoppedCompleted) canAdvance = false;

        const isPermanentlyStopped =
          !isPermStoppedCompleted &&
          (plan.productionOrder?.status === "COMPLETED_WITH_SHORTFALL" ||
            plan.status === "COMPLETED" ||
            plan.status === "COMPLETED_WITH_SHORTFALL") &&
          !["STOPPED", "SHORT_CLOSED"].includes(plan.status);
        if (isPermanentlyStopped && plan.currentProductionStep !== "Completed") {
          // Zero production — plan was stopped before any work began, just close it out
          if (producedQty === 0) {
            canAdvance = true;
            targetNextStatus = "COMPLETED";
            dynamicActionTitle = "Close Plan (No Production)";
            dynamicActionIcon = CheckCircle2;
            dynamicActionVariant = "success";
            dynamicModalTitle = "Close Plan";
            dynamicModalMessage =
              "This plan was permanently stopped with no production logged. Close it out?";
          }
        }
        if (isPermanentlyStopped && plan.currentProductionStep !== "Completed" && producedQty > 0) {
          const customSteps = plan.productionOrder?.productItem?.productionSteps || [];
          if (customSteps.length > 0) {
            // Already in post-production steps technically, we should show the step buttons
            canAdvance = true;
            const totalStepsCount = customSteps.length;
            const currentIndex = plan.currentStepIndex || 1;
            const currentStepName =
              currentIndex > 0 && currentIndex <= totalStepsCount
                ? customSteps[currentIndex - 1]?.stepKey
                : "Post Production";
            const isLastStep = currentIndex >= totalStepsCount;

            if (!isLastStep) {
              const nextStepName = customSteps[currentIndex].stepKey;
              targetNextStatus = "NEXT_STEP";
              dynamicActionTitle = `Complete ${currentStepName} & Next (${nextStepName})`;
              dynamicActionIcon = ArrowRight;
              dynamicActionVariant = "info";
              dynamicModalTitle = `Advance Step (${nextStepName})`;
              dynamicModalMessage = `Complete step "${currentStepName}" and advance to "${nextStepName}"?`;
            } else {
              targetNextStatus = "COMPLETED";
              dynamicActionTitle = `Complete Final Step (${currentStepName}) & Finish Production`;
              dynamicActionIcon = CheckCircle2;
              dynamicActionVariant = "success";
              dynamicModalTitle = "Complete Production";
              dynamicModalMessage = `Complete final post-production step "${currentStepName}" and mark production order as ready for dispatch?`;
            }
          } else {
            targetNextStatus = "COMPLETED";
            dynamicActionTitle = "Complete Production";
            dynamicActionIcon = CheckCircle2;
            dynamicActionVariant = "success";
            dynamicModalTitle = "Complete Production";
            dynamicModalMessage = `This plan was force-stopped with ${producedQty} pcs produced. Complete production to make it ready for dispatch?`;
            canAdvance = true;
          }
        }

        return (
          <div
            className="flex items-center justify-end gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {can("daily-machine-planning.view") && (
              <ViewButton onClick={() => handleViewDailyPlan(plan)} />
            )}
            {canLog &&
              !allHoursLogged &&
              (can("hourly-work-reports.create") || can("daily-machine-planning.edit")) && (
                <IconButton
                  variant="primary"
                  title="Log Hourly Production"
                  icon={ClipboardList}
                  onClick={() => handleLogHourly(plan)}
                />
              )}
            {canAdvance && can("daily-machine-planning.edit") && (
              <IconButton
                variant={dynamicActionVariant}
                title={dynamicActionTitle}
                icon={dynamicActionIcon}
                onClick={() =>
                  handleStatusAdvance(
                    plan,
                    producedQty,
                    targetNextStatus as any,
                    dynamicModalTitle as any,
                    dynamicModalMessage as any
                  )
                }
              />
            )}
            {(() => {
              // Don't show stop button before the plan has started, or once it's fully completed
              if (
                ["DRAFT", "PLANNED", "CANCELLED", "POST_PRODUCTION", "COMPLETED"].includes(
                  plan.status
                )
              )
                return null;
              if (!can("daily-machine-planning.edit")) return null;
              // Show disabled when PO is permanently closed
              const isPOPermanentlyClosed =
                plan.productionOrder?.status === "COMPLETED_WITH_SHORTFALL" ||
                plan.productionOrder?.status === "CLOSED";
              return (
                <IconButton
                  variant="danger"
                  title={
                    isPOPermanentlyClosed ? "Production Permanently Stopped" : "Stop Production"
                  }
                  icon={Square}
                  disabled={isPOPermanentlyClosed}
                  onClick={() => handleStopProductionClick(plan)}
                />
              );
            })()}
            {plan.status === "DRAFT" && can("daily-machine-planning.edit") && (
              <IconButton
                variant="info"
                title="Edit Plan"
                icon={Pencil}
                onClick={() => openEditForm(plan)}
              />
            )}
            {(plan.status === "DRAFT" || plan.status === "CANCELLED") &&
              can("daily-machine-planning.delete") && (
                <DeleteButton
                  onClick={() => {
                    setDeletePlanId(plan.dailyPlanId);
                    setShowDeleteModal(true);
                  }}
                />
              )}
          </div>
        );
      },
    },
  ];

  const allowedMachines = useMemo(
    () => (machines || []).filter((m: any) => m.machineId !== "MAC-001"),
    [machines]
  );

  const selectClass = "sl-input h-11";
  const todayStr = formatLocalDateString(new Date());
  const setStatusQuick = (status: string) => {
    setFilterStatus(status);
    setDraftFilterStatus(status);
  };
  const newPlanButton = can("daily-machine-planning.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={openCreateForm}>
      New Daily Plan
    </ActionPill>
  ) : null;

  return (
    <PageBody>
      <PageHeader
        title="Daily Production Planning"
        icon={<CalendarDays size={22} />}
        subtitle={`${filterDate ? formatDate(filterDate) : "All dates"}${filterDate === todayStr ? " (today)" : ""} · ${formatQty(stats.totalPlanned)} pcs planned across ${stats.total} plan${stats.total === 1 ? "" : "s"}`}
        actions={
          <>
            {can("daily-machine-planning.view") && (
              <ActionPill
                variant="secondary"
                icon={<BarChart3 size={17} />}
                onClick={() => {
                  navigate("/daily-machine-planning/report", {
                    state: {
                      dailyPlans,
                      machines,
                      shifts,
                    },
                  });
                }}
              >
                Daily Report
              </ActionPill>
            )}
            {can("daily-machine-planning.export") && (
              <ExportCSVButton
                fetchData={fetchDailyPlansForExport}
                columns={csvColumns}
                filename={csvFilename}
                text="Export"
              />
            )}
          </>
        }
        primaryAction={newPlanButton}
      />

      {/* Stats: tap to filter by status */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Total Plans"
          value={stats.total}
          icon={<CalendarDays size={18} />}
          loading={loading && allPlans.length === 0}
          onClick={() => setStatusQuick("")}
          className={!filterStatus ? "ring-2 ring-accent/40" : undefined}
        />
        <StatTile
          label="Planned"
          value={stats.planned}
          icon={<CheckCircle2 size={18} />}
          loading={loading && allPlans.length === 0}
          onClick={() => setStatusQuick(filterStatus === "PLANNED" ? "" : "PLANNED")}
          className={filterStatus === "PLANNED" ? "ring-2 ring-accent/40" : undefined}
        />
        <StatTile
          label="In Progress"
          value={stats.running}
          icon={<Play size={18} />}
          loading={loading && allPlans.length === 0}
          onClick={() => setStatusQuick(filterStatus === "IN_PROGRESS" ? "" : "IN_PROGRESS")}
          className={filterStatus === "IN_PROGRESS" ? "ring-2 ring-accent/40" : undefined}
        />
        <StatTile
          label="Completed"
          value={stats.completed}
          icon={<Square size={18} />}
          loading={loading && allPlans.length === 0}
          onClick={() => setStatusQuick(filterStatus === "COMPLETED" ? "" : "COMPLETED")}
          className={filterStatus === "COMPLETED" ? "ring-2 ring-accent/40" : undefined}
        />
      </div>

      <div>
        <Toolbar
          right={
            <FilterPopover
              activeFilterCount={activeFilterCount}
              hasActiveFilters={hasActiveFilters}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
              onOpen={handleOpenFilter}
            >
              <div className="mb-3">
                <label className="sl-label">Date</label>
                <DatePickerCalendar
                  name="filterDate"
                  value={draftFilterDate}
                  onChange={(e) => setDraftFilterDate(e.target.value)}
                />
              </div>
              <div className="mb-3">
                <label className="sl-label" htmlFor="dpp-filter-machine">
                  Machine
                </label>
                <select
                  id="dpp-filter-machine"
                  className={selectClass}
                  value={draftFilterMachine}
                  onChange={(e) => setDraftFilterMachine(e.target.value)}
                >
                  <option value="">All Machines</option>
                  {allowedMachines.map((m: any) => (
                    <option key={m.machineId} value={m.machineId}>
                      {m.machineName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3">
                <label className="sl-label" htmlFor="dpp-filter-shift">
                  Shift
                </label>
                <select
                  id="dpp-filter-shift"
                  className={selectClass}
                  value={draftFilterShift}
                  onChange={(e) => setDraftFilterShift(e.target.value)}
                >
                  <option value="">All Shifts</option>
                  {shifts?.map((s: any) => (
                    <option key={s.shiftCode} value={s.shiftCode}>
                      {s.shiftName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="sl-label" htmlFor="dpp-filter-status">
                  Status
                </label>
                <select
                  id="dpp-filter-status"
                  className={selectClass}
                  value={draftFilterStatus}
                  onChange={(e) => setDraftFilterStatus(e.target.value)}
                >
                  <option value="">All Status</option>
                  {Object.keys(STATUS_FLOW).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_FLOW[s].label}
                    </option>
                  ))}
                </select>
              </div>
            </FilterPopover>
          }
        >
          <div className="w-full sm:w-[190px]">
            <DatePickerCalendar
              name="quickFilterDate"
              value={filterDate}
              onChange={(e) => {
                setFilterDate(e.target.value);
                setDraftFilterDate(e.target.value);
              }}
            />
          </div>
          <div
            role="group"
            aria-label="Shift"
            className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
          >
            <Chip
              size="lg"
              selected={filterDate === todayStr}
              onClick={() => {
                setFilterDate(todayStr);
                setDraftFilterDate(todayStr);
              }}
              className="shrink-0"
            >
              Today
            </Chip>
            <Chip
              size="lg"
              selected={!filterShift}
              onClick={() => {
                setFilterShift("");
                setDraftFilterShift("");
              }}
              className="shrink-0"
            >
              All shifts
            </Chip>
            {shifts?.map((sh: any) => (
              <Chip
                key={sh.shiftCode}
                size="lg"
                selected={filterShift === sh.shiftCode}
                onClick={() => {
                  setFilterShift(sh.shiftCode);
                  setDraftFilterShift(sh.shiftCode);
                }}
                className="shrink-0"
              >
                {sh.shiftName}
              </Chip>
            ))}
          </div>
        </Toolbar>

        <DataTable
          ariaLabel="Daily production plans"
          columns={columns}
          data={paginatedPlans}
          rowKey={(row) => row.dailyPlanId}
          loading={loading}
          pagination={{
            currentPage,
            totalPages,
            onPageChange: setCurrentPage,
          }}
          emptyMessage={
            hasActiveFilters && (filterStatus || filterMachine || filterShift)
              ? "No daily plans match these filters."
              : 'No daily plans found. Click "New Daily Plan" to schedule a production run.'
          }
          emptyAction={
            filterStatus || filterMachine || filterShift ? (
              <ActionPill variant="secondary" onClick={handleClearFilters}>
                Clear filters
              </ActionPill>
            ) : (
              newPlanButton
            )
          }
        />
      </div>

      {/* ─────── View Modal Removed ─────── */}

      {/* ─────── Stop Production Modal ─────── */}
      <CommonModal
        show={showStopModal}
        onHide={() => {
          setShowStopModal(false);
          setStopPlan(null);
        }}
        title={
          <div className="flex items-center gap-2.5">
            <span className="sl-dialog-icon sl-dialog-icon-danger !h-9 !w-9 !rounded-[12px]">
              <Square size={15} aria-hidden="true" />
            </span>
            <span className="text-base font-bold text-ink">Stop Production Plan</span>
          </div>
        }
        maxWidth="3xl"
        footer={
          <div className="flex items-center justify-end gap-2.5">
            <ActionPill
              variant="secondary"
              onClick={() => {
                setShowStopModal(false);
                setStopPlan(null);
              }}
              disabled={isStopping}
            >
              Cancel
            </ActionPill>
            <ActionPill
              variant="danger"
              icon={<Square size={15} />}
              onClick={confirmStopProduction}
              loading={isStopping}
              loadingText="Stopping..."
              disabled={!stopReason.trim()}
            >
              Stop Production
            </ActionPill>
          </div>
        }
      >
        {(() => {
          const plannedQty = Number(stopPlan?.plannedQty || 0);
          const producedQty = Array.isArray(stopPlan?.hourlyProductions)
            ? stopPlan.hourlyProductions.reduce(
                (sum: number, h: any) =>
                  sum +
                  Math.max(
                    0,
                    Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                  ),
                0
              )
            : 0;
          const pendingQty = plannedQty > producedQty ? plannedQty - producedQty : 0;

          return (
            <div className="text-sm flex flex-col gap-4">
              <div>
                <p className="mb-2 text-ink-muted leading-relaxed">
                  You are about to stop the production plan{" "}
                  <strong className="rounded-full bg-card-2 px-2 py-0.5 font-mono text-ink">
                    {stopPlan?.dailyPlanId}
                  </strong>{" "}
                  prematurely.
                </p>
                <div className="flex items-start gap-2.5 rounded-[14px] bg-card-2 p-3 text-xs text-ink-muted">
                  <Info
                    className="mt-0.5 flex-shrink-0 text-[color:var(--color-warning)]"
                    size={15}
                    aria-hidden="true"
                  />
                  <span className="leading-relaxed">
                    The number of logged hourly productions is{" "}
                    <strong className="font-semibold text-[color:var(--color-warning)]">
                      {Array.isArray(stopPlan?.hourlyProductions)
                        ? stopPlan.hourlyProductions.filter((h: any) => Number(h.hourIndex) > 0)
                            .length
                        : 0}
                    </strong>
                    . The planned hours for this plan will be adjusted to match the logged hours.
                  </span>
                </div>
              </div>

              {(() => {
                const relatedPlans = allPlans
                  .filter(
                    (p: any) =>
                      p.productionOrderId === stopPlan?.productionOrderId &&
                      p.dailyPlanId !== stopPlan?.dailyPlanId
                  )
                  .sort(
                    (a: any, b: any) =>
                      new Date(a.productionDate).getTime() - new Date(b.productionDate).getTime()
                  );

                if (relatedPlans.length === 0) return null;

                const historyColumns: DataTableColumn<any>[] = [
                  {
                    header: "Date",
                    render: (row) => (
                      <span className="text-ink-subtle">
                        {row.productionDate?.split("T")[0] || "—"}
                      </span>
                    ),
                  },
                  {
                    header: "Plan ID",
                    render: (row) => (
                      <span className="font-mono text-ink-muted">{row.dailyPlanId}</span>
                    ),
                  },
                  { header: "Planned", accessor: "plannedQty", align: "right" },
                  {
                    header: "Produced",
                    render: (row) => (
                      <span className="font-medium text-ink tabular-nums">
                        {Array.isArray(row.hourlyProductions)
                          ? row.hourlyProductions.reduce(
                              (s: number, h: any) => s + Number(h.qtyProduced || 0),
                              0
                            )
                          : 0}
                      </span>
                    ),
                    align: "right",
                  },
                  {
                    header: "Status",
                    align: "center",
                    render: (row) => (
                      <Chip size="sm" tone="muted">
                        {row.status.replace(/_/g, " ")}
                      </Chip>
                    ),
                  },
                ];

                return (
                  <div className="rounded-[14px] bg-card-2 p-3.5">
                    <h6 className="sl-section-label m-0 mb-2.5">Production Order History</h6>
                    <div className="max-h-40 overflow-y-auto rounded-[12px]">
                      <DataTable
                        columns={historyColumns}
                        data={relatedPlans}
                        rowKey={(row) => row.dailyPlanId}
                        density="compact"
                      />
                    </div>
                  </div>
                );
              })()}

              <TextArea
                label="Reason for Stopping"
                name="stopReason"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                placeholder="e.g. Urgent production order PO-XXX required on this machine"
                rows={3}
                required
              />
              <div className="flex flex-col gap-2">
                <span className="sl-label">
                  Stop Action Type
                  <span className="sl-required" aria-hidden="true">
                    *
                  </span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      value: "completed_stop",
                      title: "Permanent Stop (Close PO)",
                      desc: "Stop this daily plan AND lock the Weekly Target. No new plans can be created. Post-production for produced pieces will still continue.",
                      activeClass:
                        "border-[color:var(--color-danger)] ring-2 ring-[color:var(--color-danger)]/20",
                      badgeClass: "text-[color:var(--color-danger)]",
                      radioAccent: "",
                    },
                    ...(stopPlan?.status !== "STOPPED" &&
                    stopPlan?.status !== "SHORT_CLOSED" &&
                    !(
                      stopPlan?.status === "COMPLETED" &&
                      stopPlan?.remarks?.includes("Short Closed:")
                    )
                      ? [
                          {
                            value: "carry_forward",
                            title: "Short Stop",
                            desc:
                              pendingQty > 0
                                ? `Stop this machine plan. Weekly Target remains open to carry forward the remaining ${pendingQty} pcs to a new plan later.`
                                : `Stop this machine plan. Weekly Target remains open for future planning.`,
                            activeClass:
                              "border-[color:var(--color-warning)] ring-2 ring-[color:var(--color-warning)]/20",
                            badgeClass: "text-[color:var(--color-warning)]",
                            radioAccent: "",
                          },
                        ]
                      : []),
                  ].map((opt) => (
                    <div
                      key={opt.value}
                      className={`flex min-h-[72px] cursor-pointer flex-col rounded-[14px] border bg-card p-3.5 transition-colors ${
                        stopOption === opt.value ? opt.activeClass : "border-line hover:bg-card-2"
                      }`}
                      onClick={() => setStopOption(opt.value as any)}
                    >
                      <div className="flex items-center gap-2.5 font-semibold text-sm">
                        <input
                          type="radio"
                          name="stopOption"
                          checked={stopOption === opt.value}
                          onChange={() => setStopOption(opt.value as any)}
                          className={`sl-check ${opt.radioAccent}`}
                        />
                        <span className={stopOption === opt.value ? opt.badgeClass : "text-ink"}>
                          {opt.title}
                        </span>
                      </div>
                      <span className="text-xs text-ink-subtle mt-2 pl-6 leading-relaxed">
                        {opt.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
      </CommonModal>

      {/* ─────── Status Advance Confirm Modal ─────── */}
      <CommonConfirmModal
        show={showStatusModal}
        onHide={() => {
          setShowStatusModal(false);
          setStatusChangePlan(null);
        }}
        onConfirm={confirmStatusChange}
        title={statusModalTitle}
        message={statusModalMessage}
        confirmText="Confirm"
        confirmVariant="success"
      />

      {/* ─────── Delete Confirm Modal ─────── */}
      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => {
          setShowDeleteModal(false);
          setDeletePlanId(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Delete Daily Plan"
        message="Are you sure you want to permanently delete this daily production plan?"
        confirmText="Delete"
        confirmVariant="danger"
      />

      {/* ─────── Material Issue Modal ─────── */}
      {showMaterialIssueModal && materialIssuePlan && (
        <MaterialIssueModal
          show={showMaterialIssueModal}
          onHide={() => {
            setShowMaterialIssueModal(false);
            setMaterialIssuePlan(null);
          }}
          productionOrderId={materialIssuePlan.productionOrderId}
          rawMaterials={
            materialIssuePlan.productionOrder?.draftRawMaterials ||
            materialIssuePlan.productionOrder?.rawMaterials ||
            []
          }
          rawMaterialsMap={rawMaterialsMap}
          defaultStoreId={materialIssuePlan.productionOrder?.sourceStoreId}
          dailyPlanQty={Number(materialIssuePlan.plannedQty || 0)}
          totalTargetQty={Number(materialIssuePlan.productionOrder?.targetQty || 0)}
          onSuccess={handleMaterialIssueSuccess}
        />
      )}

      {/* ─────── Production Order View Modal ─────── */}
      <ProductionOrderViewModal
        show={showPOViewModal}
        onHide={() => {
          setShowPOViewModal(false);
          setSelectedPOForView(null);
        }}
        order={selectedPOForView}
      />

      {/* ─────── Daily Plan View Modal ─────── */}
      <DailyPlanViewModal
        show={showDailyPlanViewModal}
        onHide={() => {
          setShowDailyPlanViewModal(false);
          setSelectedDailyPlanForView(null);
        }}
        plan={selectedDailyPlanForView}
      />
    </PageBody>
  );
};

export default DailyProductionPlanningPage;
