import React, { useState, useEffect, useMemo } from "react";
import {
  Check,
  ClipboardList,
  Clock,
  Cog,
  Factory,
  Gauge,
  Lock,
  LogOut,
  Play,
  Plus,
  Square,
  Trash2,
  Unlock,
  User,
} from "lucide-react";
import { toast } from "react-toastify";
import apiClient from "../../../api/apiClient";
import { API_PATHS } from "@shiftline/shared";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchProductionOrders,
  updateProductionOrder,
} from "../../../features/production-orders/productionOrderSlice";
import {
  fetchHourlyProductions,
  createHourlyProduction,
  updateHourlyProduction,
} from "../../../features/hourly-productions/hourlyProductionSlice";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { fetchShifts } from "../../../features/shifts/shiftSlice";
import { createShiftRecord } from "../../../features/product-shift-records/productShiftRecordSlice";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SectionLabel,
  Skeleton,
  Tile,
  cx,
} from "../../../components/ui/v2";
import { Figure, PageBody, formatQty } from "../../production/ui";
import { formatDateTime } from "../../../utils/dateUtils";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { useT } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/en";

/** Stored downtime reasons stay in English (they are data); the label is translated. */
const DOWNTIME_REASON_KEYS: Record<string, MessageKey> = {
  Breakdown: "shift.reason.breakdown",
  "Mold Change": "shift.reason.moldChange",
  "Material Shortage": "shift.reason.materialShortage",
  "Power Failure": "shift.reason.powerFailure",
  "Quality Issue": "shift.reason.qualityIssue",
  "Operator Absence": "shift.reason.operatorAbsence",
};

// Interface for local Downtime log
interface DowntimeLog {
  id: string;
  reason: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

const ShiftExecutionBoard: React.FC = () => {
  const dispatch = useAppDispatch();
  const { t } = useT();

  // Redux data
  const { data: productionOrders } = useAppSelector((state) => state.productionOrders);
  const { data: hourlyProductions } = useAppSelector((state) => state.hourlyProductions);
  const { data: machines } = useAppSelector((state) => state.machines);

  // Console setup state
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [isConsoleActive, setIsConsoleActive] = useState(false);

  // Active production order selection
  const [activeOrderId, setActiveOrderId] = useState("");

  // Lock rules & Supervisor override
  const [activeHourIndex, setActiveHourIndex] = useState(1);
  const [supervisorMode, setSupervisorMode] = useState(false);
  const [showSupervisorModal, setShowSupervisorModal] = useState(false);
  // The supervisor signs in with their own account; the server checks it and their
  // shift-execution.supervise permission. Nothing secret lives in this page.
  const [supervisorEmail, setSupervisorEmail] = useState("");
  const [supervisorPassword, setSupervisorPassword] = useState("");
  const [verifyingSupervisor, setVerifyingSupervisor] = useState(false);

  // Downtime modal state
  const [showDowntimeModal, setShowDowntimeModal] = useState(false);
  const [downtimeReason, setDowntimeReason] = useState("Breakdown");
  const [downtimeStart, setDowntimeStart] = useState("");
  const [downtimeEnd, setDowntimeEnd] = useState("");
  const [downtimeLogs, setDowntimeLogs] = useState<DowntimeLog[]>([]);

  // Hourly inputs (temp form state for 8 hours)
  const [hourlyInputs, setHourlyInputs] = useState<
    Record<number, { actual: string; reject: string; scrap: string }>
  >({
    1: { actual: "", reject: "", scrap: "" },
    2: { actual: "", reject: "", scrap: "" },
    3: { actual: "", reject: "", scrap: "" },
    4: { actual: "", reject: "", scrap: "" },
    5: { actual: "", reject: "", scrap: "" },
    6: { actual: "", reject: "", scrap: "" },
    7: { actual: "", reject: "", scrap: "" },
    8: { actual: "", reject: "", scrap: "" },
  });

  useEffect(() => {
    dispatch(fetchProductionOrders());
    dispatch(fetchHourlyProductions());
    dispatch(fetchMachines());
    dispatch(fetchShifts());
  }, [dispatch]);

  // Real-time sync: refresh production orders and hourly logs when socket events arrive
  useSocketSync("productionOrder", undefined, () => {
    dispatch(fetchProductionOrders());
  });
  useSocketSync("hourlyProduction", undefined, () => {
    dispatch(fetchHourlyProductions());
  });

  // Load downtime logs from local storage when activeOrderId changes
  useEffect(() => {
    if (activeOrderId) {
      const stored = localStorage.getItem(`downtime_${activeOrderId}`);
      if (stored) {
        setDowntimeLogs(JSON.parse(stored));
      } else {
        setDowntimeLogs([]);
      }
    }
  }, [activeOrderId]);

  // Get active order details
  const activeOrder = useMemo(() => {
    return productionOrders.find((po) => po.productionOrderId === activeOrderId);
  }, [productionOrders, activeOrderId]);

  // Load existing hourly production logs for activeOrder
  useEffect(() => {
    if (activeOrderId && hourlyProductions.length > 0) {
      const inputs = { ...hourlyInputs };
      let logsFound = false;

      // Reset
      for (let i = 1; i <= 8; i++) {
        inputs[i] = { actual: "", reject: "", scrap: "" };
      }

      hourlyProductions.forEach((hp) => {
        if (hp.productionOrderId === activeOrderId) {
          const idx = Number(hp.hourIndex);
          if (idx >= 1 && idx <= 8) {
            inputs[idx] = {
              actual: hp.qtyProduced.toString(),
              // Mapped properties or default to 0 if not fetched
              reject: activeOrder?.rejectedQty
                ? (Number(activeOrder.rejectedQty) / 8).toFixed(0)
                : "0",
              scrap: activeOrder?.scrapQty ? (Number(activeOrder.scrapQty) / 8).toFixed(0) : "0",
            };
            logsFound = true;
          }
        }
      });

      if (logsFound) {
        setHourlyInputs(inputs);
      }
    }
  }, [activeOrderId, hourlyProductions, activeOrder]);

  // Compute auto Hourly Target
  const hourlyTarget = useMemo(() => {
    if (!activeOrder) return 0;
    const total = Number(activeOrder.targetQty) || 0;
    const hours = 8;
    return Math.round(total / hours);
  }, [activeOrder]);

  // Filter production orders matching setup criteria — only DAILY_PLANNED or IN_PRODUCTION
  const availableOrders = useMemo(() => {
    return productionOrders.filter(
      (po) =>
        ((po as any).machineId === selectedMachineId || !selectedMachineId) &&
        ((po as any).shiftId === selectedShiftId || !selectedShiftId) &&
        po.status !== "POST_PRODUCTION" &&
        po.status !== "READY_FOR_DISPATCH" &&
        po.status !== "COMPLETED" &&
        po.status !== "DISPATCHED" &&
        po.status !== "CANCELLED"
    );
  }, [productionOrders, selectedMachineId, selectedShiftId]);

  // Handle shift status changes
  const handleStatusChange = async (newStatus: string) => {
    if (!activeOrder) return;
    try {
      const payload: any = {
        ...activeOrder,
        status: newStatus,
      };

      // ✅ FIX: Use "IN_PRODUCTION" (underscore, no space) — correct backend status
      if (newStatus === "IN_PRODUCTION") {
        payload.actualStartDateTime = new Date().toISOString();
        toast.info(t("shift.toast.started"));
      } else if (newStatus === "POST_PRODUCTION") {
        payload.actualEndDateTime = new Date().toISOString();
        // sum actuals to update order's produced qty
        let sumActual = 0;
        let sumReject = 0;
        let sumScrap = 0;
        Object.keys(hourlyInputs).forEach((key) => {
          const val = hourlyInputs[Number(key)];
          sumActual += Number(val.actual) || 0;
          sumReject += Number(val.reject) || 0;
          sumScrap += Number(val.scrap) || 0;
        });

        payload.producedQty = sumActual;
        payload.rejectedQty = sumReject;
        payload.scrapQty = sumScrap;
        toast.success(t("shift.toast.finishing"));

        await dispatch(
          updateProductionOrder({ id: Number(activeOrderId), data: payload })
        ).unwrap();

        dispatch(
          createShiftRecord({
            productId: Number(activeOrder.productItemId),
            productionOrderId: activeOrderId,
            machineId: selectedMachineId,
            shiftId: selectedShiftId,
            achievedQty: sumActual,
            targetQty: Number(activeOrder.targetQty),
            operatorIds: operatorName || null,
          })
        );

        dispatch(fetchProductionOrders());
        return;
      }

      await dispatch(updateProductionOrder({ id: Number(activeOrderId), data: payload })).unwrap();
      dispatch(fetchProductionOrders());
    } catch (err: any) {
      toast.error(err || t("shift.toast.statusFailed"));
    }
  };

  // Submit log for a specific hour
  const handleSaveHourlyRow = async (hourIndex: number) => {
    if (!activeOrderId) return;
    const row = hourlyInputs[hourIndex];
    if (!row.actual) {
      toast.error(t("shift.toast.enterActual"));
      return;
    }

    try {
      // Check if log already exists
      const existing = hourlyProductions.find(
        (hp) => hp.productionOrderId === activeOrderId && Number(hp.hourIndex) === hourIndex
      );

      if (existing) {
        await dispatch(
          updateHourlyProduction({
            id: existing.hourlyProductionId.toString(),
            data: {
              qtyProduced: Number(row.actual),
            },
          })
        ).unwrap();
        toast.success(t("shift.toast.hourUpdated", { hour: hourIndex }));
      } else {
        await dispatch(
          createHourlyProduction({
            productionOrderId: activeOrderId,
            hourIndex,
            qtyProduced: Number(row.actual),
          })
        ).unwrap();
        toast.success(t("shift.toast.hourSaved", { hour: hourIndex }));
      }

      // Automatically advance active hour index
      if (hourIndex === activeHourIndex && activeHourIndex < 8) {
        setActiveHourIndex(activeHourIndex + 1);
      }

      // Sync total production quantities to Production Order
      let totalActual = 0;
      let totalReject = 0;
      let totalScrap = 0;
      for (let i = 1; i <= 8; i++) {
        const val = i === hourIndex ? row : hourlyInputs[i];
        totalActual += Number(val.actual) || 0;
        totalReject += Number(val.reject) || 0;
        totalScrap += Number(val.scrap) || 0;
      }

      await dispatch(
        updateProductionOrder({
          id: Number(activeOrderId),
          data: {
            ...activeOrder,
            producedQty: totalActual,
            rejectedQty: totalReject,
            scrapQty: totalScrap,
          },
        })
      ).unwrap();

      dispatch(fetchHourlyProductions());
      dispatch(fetchProductionOrders());
    } catch (err: any) {
      toast.error(err || t("shift.toast.hourFailed"));
    }
  };

  // Handle input changes
  const handleInputChange = (
    hourIndex: number,
    field: "actual" | "reject" | "scrap",
    value: string
  ) => {
    setHourlyInputs((prev) => ({
      ...prev,
      [hourIndex]: {
        ...prev[hourIndex],
        [field]: value,
      },
    }));
  };

  // Supervisor override authentication
  const handleSupervisorVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supervisorEmail || !supervisorPassword || verifyingSupervisor) return;
    setVerifyingSupervisor(true);
    try {
      const res = await apiClient.post(API_PATHS.shiftExecution.supervisorOverride, {
        email: supervisorEmail,
        password: supervisorPassword,
      });
      const name: string | undefined = res.data?.data?.supervisorName;
      setSupervisorMode(true);
      setShowSupervisorModal(false);
      toast.success(
        name ? t("shift.toast.supervisorOnBy", { name }) : t("shift.toast.supervisorOn")
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t("shift.toast.supervisorFailed"));
    } finally {
      setSupervisorPassword("");
      setVerifyingSupervisor(false);
    }
  };

  // Add Downtime log
  const handleAddDowntime = (e: React.FormEvent) => {
    e.preventDefault();
    if (!downtimeStart || !downtimeEnd) {
      toast.error(t("shift.toast.enterTimes"));
      return;
    }

    const start = new Date(downtimeStart);
    const end = new Date(downtimeEnd);
    if (end <= start) {
      toast.error(t("shift.toast.endAfterStart"));
      return;
    }

    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.round(diffMs / 60000);

    const log: DowntimeLog = {
      id: Date.now().toString(),
      reason: downtimeReason,
      startTime: downtimeStart,
      endTime: downtimeEnd,
      durationMinutes: diffMins,
    };

    const updated = [...downtimeLogs, log];
    setDowntimeLogs(updated);
    localStorage.setItem(`downtime_${activeOrderId}`, JSON.stringify(updated));
    setShowDowntimeModal(false);
    toast.success(t("shift.toast.stoppageLogged"));

    setDowntimeStart("");
    setDowntimeEnd("");
  };

  // Delete Downtime log
  const handleDeleteDowntime = (id: string) => {
    const updated = downtimeLogs.filter((log) => log.id !== id);
    setDowntimeLogs(updated);
    localStorage.setItem(`downtime_${activeOrderId}`, JSON.stringify(updated));
    toast.info(t("shift.toast.stoppageDeleted"));
  };

  // Shift performance analytics calculations
  const analytics = useMemo(() => {
    const totalProduced = Object.values(hourlyInputs).reduce(
      (sum, h) => sum + (Number(h.actual) || 0),
      0
    );
    const totalRejected = Object.values(hourlyInputs).reduce(
      (sum, h) => sum + (Number(h.reject) || 0),
      0
    );
    const totalDowntime = downtimeLogs.reduce((sum, log) => sum + log.durationMinutes, 0);

    const plannedTime = 8 * 60; // minutes
    const runningTime = Math.max(0, plannedTime - totalDowntime);

    // 1. Availability = Running Time / Planned Time
    const availability = plannedTime > 0 ? (runningTime / plannedTime) * 100 : 0;

    // 2. Performance = Produced / Target
    const target = Number(activeOrder?.targetQty) || 1;
    const performance = (totalProduced / target) * 100;

    // 3. Quality = Good / Total
    const quality =
      totalProduced > 0 ? ((totalProduced - totalRejected) / totalProduced) * 100 : 100;

    // 4. OEE = Availability * Performance * Quality
    const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;

    return {
      totalProduced,
      totalRejected,
      totalDowntime,
      availability: Math.min(100, Math.max(0, availability)).toFixed(1),
      performance: Math.min(100, Math.max(0, performance)).toFixed(1),
      quality: Math.min(100, Math.max(0, quality)).toFixed(1),
      oee: Math.min(100, Math.max(0, oee)).toFixed(1),
    };
  }, [hourlyInputs, downtimeLogs, activeOrder]);

  const HOURS = [1, 2, 3, 4, 5, 6, 7, 8];
  const DOWNTIME_REASONS = Object.entries(DOWNTIME_REASON_KEYS).map(([value, key]) => ({
    label: t(key),
    value,
  }));
  const reasonLabel = (reason: string) =>
    DOWNTIME_REASON_KEYS[reason] ? t(DOWNTIME_REASON_KEYS[reason]) : reason;
  const SHIFT_OPTIONS = [
    { label: t("shift.morning"), value: "MORNING" },
    { label: t("shift.evening"), value: "EVENING" },
  ];

  const machineName = machines.find((m) => m.machineId === selectedMachineId)?.machineName;
  const shiftLabel = selectedShiftId === "MORNING" ? t("shift.morning") : t("shift.evening");
  const target = Number(activeOrder?.targetQty) || 0;
  const progressPct = target > 0 ? Math.min(100, (analytics.totalProduced / target) * 100) : 0;
  const isRunning = activeOrder?.status === "IN_PRODUCTION";
  const isFinished =
    activeOrder?.status === "POST_PRODUCTION" || activeOrder?.status === "COMPLETED";
  const numberInputClass =
    "sl-input h-12 w-full text-center text-[18px] font-bold tabular-nums disabled:opacity-60";

  const fieldLabel = (field: "actual" | "reject" | "scrap") =>
    field === "actual"
      ? t("shift.actualQty")
      : field === "reject"
        ? t("shift.rejectQty")
        : t("shift.scrapQty");

  const pickerTile = (selected: boolean) =>
    cx(
      "flex min-h-[56px] w-full items-center rounded-[14px] border px-4 py-3 text-left text-[15px] font-semibold transition-colors",
      selected
        ? "border-accent bg-nav-active text-nav-active-fg"
        : "border-line bg-card text-ink hover:bg-card-2"
    );

  return (
    <PageBody className="mx-auto max-w-[1400px]">
      <PageHeader
        title={t("shift.title")}
        icon={<Factory size={22} />}
        subtitle={t("shift.subtitle")}
        meta={
          isConsoleActive && activeOrder ? (
            <StatusBadge status={activeOrder.status ?? ""} />
          ) : undefined
        }
        actions={
          isConsoleActive ? (
            <ActionPill
              variant="secondary"
              size="lg"
              icon={<LogOut size={18} />}
              onClick={() => {
                setIsConsoleActive(false);
                setActiveOrderId("");
                setSupervisorMode(false);
              }}
            >
              {t("shift.closeSession")}
            </ActionPill>
          ) : undefined
        }
      />

      {!isConsoleActive ? (
        /* ------------------------------------------------ setup */
        <div className="mx-auto w-full max-w-2xl">
          <Tile padding="lg" title={t("shift.setupTitle")} subtitle={t("shift.setupSubtitle")}>
            <form
              className="flex flex-col gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedMachineId || !selectedShiftId || !operatorName) {
                  toast.error(t("shift.fillSetup"));
                  return;
                }
                setIsConsoleActive(true);
                // auto select order if single one is available
                if (availableOrders.length > 0) {
                  setActiveOrderId(availableOrders[0].productionOrderId || "");
                }
              }}
            >
              <div role="radiogroup" aria-label={t("common.machine")}>
                <span className="sl-label">
                  {t("common.machine")}
                  <span className="sl-required" aria-hidden="true">
                    *
                  </span>
                </span>
                {machines.length === 0 ? (
                  <div className="grid grid-cols-2 gap-2" aria-hidden="true">
                    <Skeleton height={56} />
                    <Skeleton height={56} />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    {machines.map((m) => (
                      <button
                        key={m.machineId}
                        type="button"
                        role="radio"
                        aria-checked={selectedMachineId === m.machineId}
                        onClick={() => setSelectedMachineId(m.machineId)}
                        className={pickerTile(selectedMachineId === m.machineId)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{m.machineName}</span>
                          <span className="block font-mono text-[12px] font-medium opacity-70">
                            {m.machineId}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div role="radiogroup" aria-label={t("common.shift")}>
                <span className="sl-label">
                  {t("common.shift")}
                  <span className="sl-required" aria-hidden="true">
                    *
                  </span>
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {SHIFT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={selectedShiftId === opt.value}
                      onClick={() => setSelectedShiftId(opt.value)}
                      className={cx(pickerTile(selectedShiftId === opt.value), "justify-center")}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <TextInput
                label={t("shift.operatorName")}
                name="operatorName"
                value={operatorName}
                required
                placeholder={t("shift.operatorPlaceholder")}
                autoComplete="name"
                inputClassName="h-14 text-[17px]"
                onChange={(e) => setOperatorName(e.target.value)}
              />

              <ActionPill type="submit" size="xl" fullWidth icon={<Play size={20} />}>
                {t("shift.openBoard")}
              </ActionPill>
            </form>
          </Tile>
        </div>
      ) : (
        /* ------------------------------------------------ active console */
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="lg" icon={<Cog size={16} />}>
              {machineName || selectedMachineId}
            </Chip>
            <Chip size="lg" icon={<Clock size={16} />}>
              {shiftLabel}
            </Chip>
            <Chip size="lg" icon={<User size={16} />}>
              {operatorName}
            </Chip>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left: order, big figures, controls, OEE */}
            <div className="flex flex-col gap-5 lg:col-span-4">
              <Tile title={t("shift.productionOrder")}>
                <SelectInput
                  label={t("shift.selectOrder")}
                  name="activeOrderId"
                  value={activeOrderId}
                  options={availableOrders.map((po) => ({
                    label: `${po.productionOrderId} (${po.productItem?.productName})`,
                    value: po.productionOrderId || "",
                  }))}
                  onChange={(e) => setActiveOrderId(e.target.value)}
                />

                {activeOrder ? (
                  <div className="mt-4 flex flex-col gap-4">
                    <div>
                      <p className="m-0 text-[17px] font-bold text-ink">
                        {activeOrder.productItem?.productName}
                      </p>
                      <p className="sl-muted m-0 text-[13px]">
                        {t("shift.runHours", {
                          qty: formatQty(hourlyTarget),
                          uom: activeOrder.uom ?? "",
                        })}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 rounded-[16px] bg-card-2 p-4">
                      <Figure
                        size="lg"
                        label={t("shift.target")}
                        value={formatQty(activeOrder.targetQty)}
                        hint={activeOrder.uom}
                      />
                      <Figure
                        size="lg"
                        label={t("shift.done")}
                        tone="accent"
                        value={formatQty(analytics.totalProduced)}
                        hint={t("shift.ofTarget", { pct: progressPct.toFixed(0) })}
                      />
                      <div
                        className="col-span-2 h-3 overflow-hidden rounded-full bg-card"
                        role="progressbar"
                        aria-label={t("shift.progress")}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progressPct)}
                      >
                        <div
                          className="h-full rounded-full bg-cta transition-[width]"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2.5">
                      <SectionLabel className="!mb-0">{t("shift.controls")}</SectionLabel>
                      <ActionPill
                        variant={isRunning ? "secondary" : "cta"}
                        size={isRunning ? "lg" : "xl"}
                        fullWidth
                        icon={<Play size={20} />}
                        onClick={() => handleStatusChange("IN_PRODUCTION")}
                        disabled={activeOrder.status === "IN_PRODUCTION"}
                        className={isRunning ? "min-h-[56px]" : undefined}
                      >
                        {isRunning ? t("shift.running") : t("shift.start")}
                      </ActionPill>
                      <ActionPill
                        variant={isRunning ? "cta" : "secondary"}
                        size={isRunning ? "xl" : "lg"}
                        fullWidth
                        icon={<Check size={20} />}
                        onClick={() => handleStatusChange("POST_PRODUCTION")}
                        disabled={isFinished}
                        className={!isRunning ? "min-h-[56px]" : undefined}
                      >
                        {t("shift.complete")}
                      </ActionPill>
                      <ActionPill
                        variant="danger"
                        size="lg"
                        fullWidth
                        icon={<Square size={18} />}
                        onClick={() => handleStatusChange("CANCELLED")}
                        disabled={activeOrder.status === "CANCELLED"}
                        className="min-h-[56px]"
                      >
                        {t("shift.stop")}
                      </ActionPill>
                    </div>
                  </div>
                ) : (
                  <div
                    role="status"
                    className="mt-4 rounded-[14px] bg-card-2 p-4 text-center text-[14px] font-medium text-[color:var(--color-warning)]"
                  >
                    {t("shift.noOrder")}
                  </div>
                )}
              </Tile>

              {activeOrder && (
                <Tile title={t("shift.oeeTitle")} icon={<Gauge size={18} />}>
                  <div className="flex items-end justify-between gap-3">
                    <Figure
                      size="lg"
                      label={t("shift.oeeOverall")}
                      value={`${analytics.oee}%`}
                      tone="accent"
                    />
                    <Chip
                      tone={analytics.totalDowntime > 0 ? "danger" : "success"}
                      icon={<Clock size={14} />}
                    >
                      {t("shift.minDown", { count: analytics.totalDowntime })}
                    </Chip>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line-soft pt-4">
                    <Figure label={t("shift.availability")} value={`${analytics.availability}%`} />
                    <Figure label={t("shift.performance")} value={`${analytics.performance}%`} />
                    <Figure label={t("shift.quality")} value={`${analytics.quality}%`} />
                  </div>
                </Tile>
              )}
            </div>

            {/* Right: hourly log and downtime */}
            <div className="flex flex-col gap-5 lg:col-span-8">
              {activeOrder ? (
                <>
                  <Tile
                    title={t("shift.hourlyLog")}
                    icon={<ClipboardList size={18} />}
                    subtitle={
                      supervisorMode ? t("shift.supervisorEditable") : t("shift.activeHourOnly")
                    }
                    actions={
                      supervisorMode ? (
                        <ActionPill
                          variant="secondary"
                          size="sm"
                          icon={<Unlock size={14} />}
                          onClick={() => setSupervisorMode(false)}
                          className="text-[color:var(--color-success)]"
                        >
                          {t("shift.supervisorUnlocked")}
                        </ActionPill>
                      ) : (
                        <ActionPill
                          variant="secondary"
                          size="sm"
                          icon={<Lock size={14} />}
                          onClick={() => setShowSupervisorModal(true)}
                        >
                          {t("shift.supervisorOverride")}
                        </ActionPill>
                      )
                    }
                  >
                    <div
                      role="group"
                      aria-label={t("shift.activeHour")}
                      className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
                    >
                      {HOURS.map((h) => (
                        <Chip
                          key={h}
                          size="lg"
                          selected={activeHourIndex === h}
                          onClick={() => setActiveHourIndex(h)}
                          className="shrink-0 !min-h-[44px] tabular-nums"
                          aria-label={t("shift.hourN", { hour: h })}
                        >
                          H{h}
                          {hourlyInputs[h]?.actual ? <Check size={14} aria-hidden="true" /> : null}
                        </Chip>
                      ))}
                    </div>

                    <div className="hidden grid-cols-[72px_1fr_1fr_1fr_1fr_96px] gap-3 px-3 pb-2 md:grid">
                      {[
                        t("shift.hour"),
                        t("shift.targetQty"),
                        t("shift.actualQty"),
                        t("shift.rejectQty"),
                        t("shift.scrapQty"),
                        "",
                      ].map((h) => (
                        <span key={h} className="sl-th text-center">
                          {h}
                        </span>
                      ))}
                    </div>
                    <ol className="m-0 flex list-none flex-col gap-2 p-0">
                      {HOURS.map((hour) => {
                        const isEditable = supervisorMode || hour === activeHourIndex;
                        const isActive = hour === activeHourIndex;
                        const input = hourlyInputs[hour] || {
                          actual: "",
                          reject: "",
                          scrap: "",
                        };
                        return (
                          <li
                            key={hour}
                            className={cx(
                              "grid grid-cols-3 items-center gap-3 rounded-[16px] p-3 md:grid-cols-[72px_1fr_1fr_1fr_1fr_96px]",
                              isActive ? "bg-nav-active" : "bg-card-2",
                              !isEditable && "opacity-80"
                            )}
                          >
                            <div className="col-span-2 flex items-center gap-2 md:col-span-1 md:block md:text-center">
                              <span className="text-[18px] font-bold text-ink tabular-nums">
                                H-{hour}
                              </span>
                              {!isEditable && (
                                <Lock
                                  size={14}
                                  className="text-ink-subtle md:mx-auto md:mt-0.5 md:block"
                                  aria-label={t("shift.locked")}
                                />
                              )}
                            </div>
                            <div className="text-right md:text-center">
                              <span className="block text-[12px] font-medium text-ink-subtle md:hidden">
                                {t("shift.target")}
                              </span>
                              <span className="font-semibold text-ink-muted tabular-nums">
                                {formatQty(hourlyTarget)} {activeOrder.uom}
                              </span>
                            </div>
                            {(["actual", "reject", "scrap"] as const).map((field) => (
                              <label key={field} className="min-w-0">
                                <span className="block pb-1 text-[12px] font-medium text-ink-subtle md:sr-only">
                                  {fieldLabel(field)}
                                </span>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  aria-label={t("shift.hourFieldQty", {
                                    hour,
                                    field: fieldLabel(field),
                                  })}
                                  className={numberInputClass}
                                  placeholder="0"
                                  value={input[field]}
                                  disabled={!isEditable}
                                  onChange={(e) => handleInputChange(hour, field, e.target.value)}
                                />
                              </label>
                            ))}
                            <ActionPill
                              variant={isActive ? "cta" : "secondary"}
                              size="lg"
                              disabled={!isEditable}
                              onClick={() => handleSaveHourlyRow(hour)}
                              className="col-span-3 min-h-[48px] self-end md:col-span-1"
                              aria-label={t("shift.saveHour", { hour })}
                            >
                              {t("common.save")}
                            </ActionPill>
                          </li>
                        );
                      })}
                    </ol>
                  </Tile>

                  <Tile
                    title={t("shift.downtimeTitle")}
                    icon={<Clock size={18} />}
                    actions={
                      <ActionPill
                        variant="danger"
                        size="md"
                        icon={<Plus size={16} />}
                        onClick={() => setShowDowntimeModal(true)}
                      >
                        {t("shift.logStoppage")}
                      </ActionPill>
                    }
                  >
                    {downtimeLogs.length > 0 ? (
                      <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {downtimeLogs.map((log) => (
                          <li
                            key={log.id}
                            className="flex flex-wrap items-center gap-3 rounded-[14px] bg-card-2 px-4 py-3"
                          >
                            <Chip tone="danger" dot>
                              {reasonLabel(log.reason)}
                            </Chip>
                            <span className="sl-muted text-[13px] tabular-nums">
                              {formatDateTime(log.startTime)} → {formatDateTime(log.endTime)}
                            </span>
                            <span className="ml-auto text-[17px] font-bold text-ink tabular-nums">
                              {t("common.minutes", { count: log.durationMinutes })}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteDowntime(log.id)}
                              className="sl-icon-btn sl-icon-btn-md sl-icon-btn-hover-danger"
                              aria-label={t("shift.deleteDowntime")}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState
                        compact
                        icon={<Check size={22} />}
                        title={t("shift.noStoppages")}
                      />
                    )}
                  </Tile>
                </>
              ) : (
                <Tile>
                  <EmptyState
                    icon={<ClipboardList size={28} />}
                    title={t("shift.awaitingOrder")}
                    description={t("shift.awaitingOrderHelp")}
                  />
                </Tile>
              )}
            </div>
          </div>
        </>
      )}

      {/* Supervisor Verification Modal */}
      <CommonModal
        show={showSupervisorModal}
        onHide={() => setShowSupervisorModal(false)}
        title={t("shift.supervisorTitle")}
        maxWidth="sm"
        footer={
          <div className="flex w-full items-center justify-end gap-2.5">
            <ActionPill variant="secondary" onClick={() => setShowSupervisorModal(false)}>
              {t("common.cancel")}
            </ActionPill>
            <ActionPill
              icon={<Unlock size={16} />}
              loading={verifyingSupervisor}
              disabled={!supervisorEmail || !supervisorPassword}
              onClick={() =>
                handleSupervisorVerify({ preventDefault: () => {} } as unknown as React.FormEvent)
              }
            >
              {t("shift.unlockConsole")}
            </ActionPill>
          </div>
        }
      >
        <form onSubmit={handleSupervisorVerify} className="flex flex-col gap-4">
          <p className="sl-muted text-sm">{t("shift.supervisorHelp")}</p>
          <TextInput
            label={t("shift.supervisorEmail")}
            name="supervisorEmail"
            type="email"
            autoComplete="off"
            value={supervisorEmail}
            required
            onChange={(e) => setSupervisorEmail(e.target.value)}
            inputClassName="h-12"
          />
          <TextInput
            label={t("shift.supervisorPassword")}
            name="supervisorPassword"
            type="password"
            autoComplete="off"
            value={supervisorPassword}
            required
            onChange={(e) => setSupervisorPassword(e.target.value)}
            inputClassName="h-12"
          />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </CommonModal>

      {/* Add Downtime Modal */}
      <CommonModal
        show={showDowntimeModal}
        onHide={() => setShowDowntimeModal(false)}
        title={t("shift.downtimeModalTitle")}
        maxWidth="lg"
        footer={
          <div className="flex w-full items-center justify-end gap-2.5">
            <ActionPill variant="secondary" onClick={() => setShowDowntimeModal(false)}>
              {t("common.cancel")}
            </ActionPill>
            <ActionPill
              variant="danger"
              icon={<Plus size={16} />}
              onClick={() =>
                handleAddDowntime({ preventDefault: () => {} } as unknown as React.FormEvent)
              }
            >
              {t("shift.logStoppage")}
            </ActionPill>
          </div>
        }
      >
        <form onSubmit={handleAddDowntime} className="flex flex-col gap-4">
          <div role="radiogroup" aria-label={t("shift.downtimeReason")}>
            <span className="sl-label">
              {t("shift.downtimeReason")}
              <span className="sl-required" aria-hidden="true">
                *
              </span>
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DOWNTIME_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={downtimeReason === r.value}
                  onClick={() => setDowntimeReason(r.value)}
                  className={pickerTile(downtimeReason === r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInput
              label={t("shift.stoppageStart")}
              name="downtimeStart"
              type="datetime-local"
              value={downtimeStart}
              required
              onChange={(e) => setDowntimeStart(e.target.value)}
            />
            <TextInput
              label={t("shift.stoppageEnd")}
              name="downtimeEnd"
              type="datetime-local"
              value={downtimeEnd}
              required
              onChange={(e) => setDowntimeEnd(e.target.value)}
            />
          </div>
        </form>
      </CommonModal>
    </PageBody>
  );
};

export default ShiftExecutionBoard;
