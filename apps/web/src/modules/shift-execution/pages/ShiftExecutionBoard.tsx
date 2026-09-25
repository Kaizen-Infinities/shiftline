import React, { useState, useEffect, useMemo } from "react";
import {
  FaPlay,
  FaStop,
  FaCheck,
  FaUnlock,
  FaLock,
  FaClipboardList,
  FaClock,
  FaPlus,
  FaTrash,
  FaCalculator,
} from "react-icons/fa";
import { toast } from "react-toastify";
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
import CustomButton from "../../../components/ui/Button/Button";
import CommonModal from "../../../components/ui/Modal/CommonModal";
import { useSocketSync } from "../../../hooks/useSocketSync";

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
  const [passcode, setPasscode] = useState("");

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
        toast.info("Shift production started!");
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
        toast.success(
          "Shift production finishing phase initiated! Status updated to Post-Production."
        );

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
      toast.error(err || "Failed to update status");
    }
  };

  // Submit log for a specific hour
  const handleSaveHourlyRow = async (hourIndex: number) => {
    if (!activeOrderId) return;
    const row = hourlyInputs[hourIndex];
    if (!row.actual) {
      toast.error("Please enter actual production quantity");
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
        toast.success(`Hour ${hourIndex} log updated successfully!`);
      } else {
        await dispatch(
          createHourlyProduction({
            productionOrderId: activeOrderId,
            hourIndex,
            qtyProduced: Number(row.actual),
          })
        ).unwrap();
        toast.success(`Hour ${hourIndex} log saved successfully!`);
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
      toast.error(err || "Failed to save hourly log");
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
  const handleSupervisorVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcode === "1234") {
      setSupervisorMode(true);
      setShowSupervisorModal(false);
      setPasscode("");
      toast.success("Supervisor Mode activated! Editing unlocked.");
    } else {
      toast.error("Incorrect passcode. Editing remains locked.");
    }
  };

  // Add Downtime log
  const handleAddDowntime = (e: React.FormEvent) => {
    e.preventDefault();
    if (!downtimeStart || !downtimeEnd) {
      toast.error("Please enter start and end time");
      return;
    }

    const start = new Date(downtimeStart);
    const end = new Date(downtimeEnd);
    if (end <= start) {
      toast.error("End time must be after start time");
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
    toast.success("Downtime stoppage logged!");

    setDowntimeStart("");
    setDowntimeEnd("");
  };

  // Delete Downtime log
  const handleDeleteDowntime = (id: string) => {
    const updated = downtimeLogs.filter((log) => log.id !== id);
    setDowntimeLogs(updated);
    localStorage.setItem(`downtime_${activeOrderId}`, JSON.stringify(updated));
    toast.info("Downtime log deleted");
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

  const statusButtonClass = (isCurrent: boolean, tone: "accent" | "danger") =>
    `flex items-center justify-center gap-2 py-2.5 px-3 rounded-sm text-sm font-semibold border transition-colors ${
      isCurrent
        ? "border-line-soft bg-card-2 text-ink-subtle opacity-60 cursor-not-allowed"
        : tone === "danger"
          ? "border-[color:var(--color-danger)] text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)] hover:text-white"
          : "border-accent text-accent hover:bg-accent hover:text-white"
    }`;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-3">
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 mb-4 pb-3 border-b border-line">
        <h2 className="text-xl font-bold text-ink">Operator Shift Execution Console</h2>
        {isConsoleActive && (
          <button
            onClick={() => {
              setIsConsoleActive(false);
              setActiveOrderId("");
              setSupervisorMode(false);
            }}
            className="px-4 py-2 rounded-sm border border-[color:var(--color-danger)] text-[color:var(--color-danger)] text-sm font-semibold hover:bg-[color:var(--color-danger)] hover:text-white transition-colors cursor-pointer"
          >
            Close Console Session
          </button>
        )}
      </div>

      {/* Setup Phase */}
      {!isConsoleActive ? (
        <div className="flex justify-center py-6">
          <div className="w-full max-w-lg bg-card rounded-sm border border-line p-6">
            <h4 className="text-lg font-bold text-ink text-center mb-5">
              Setup Shift Console Session
            </h4>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!selectedMachineId || !selectedShiftId || !operatorName) {
                  toast.error("Please fill in all setup fields");
                  return;
                }
                setIsConsoleActive(true);
                // auto select order if single one is available
                if (availableOrders.length > 0) {
                  setActiveOrderId(availableOrders[0].productionOrderId || "");
                }
              }}
            >
              <div className="space-y-4">
                <SelectInput
                  label="Machine"
                  name="machineId"
                  value={selectedMachineId}
                  options={machines.map((m) => ({
                    label: m.machineName,
                    value: m.machineId,
                  }))}
                  required
                  defaultOptionLabel="Select Machine"
                  onChange={(e) => setSelectedMachineId(e.target.value)}
                />
                <SelectInput
                  label="Shift"
                  name="shiftId"
                  value={selectedShiftId}
                  options={[
                    { label: "Morning Shift", value: "MORNING" },
                    { label: "Evening Shift", value: "EVENING" },
                  ]}
                  required
                  defaultOptionLabel="Select Shift"
                  onChange={(e) => setSelectedShiftId(e.target.value)}
                />
                <TextInput
                  label="Operator Name / ID"
                  name="operatorName"
                  value={operatorName}
                  required
                  placeholder="Enter your name"
                  onChange={(e) => setOperatorName(e.target.value)}
                />
                <div className="pt-2">
                  <CustomButton
                    text="Initialize Operator Board"
                    type="submit"
                    size="lg"
                    className="w-full"
                  />
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : (
        /* Active Console Session */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Active Order Details & Status Toggles */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-card rounded-sm border border-line p-4">
              <h5 className="text-sm font-bold text-ink border-b border-line-soft pb-2 mb-3">
                Console Session
              </h5>
              <div className="text-xs text-ink-muted space-y-1 mb-3">
                <div>
                  <span className="font-semibold text-ink">Operator:</span> {operatorName}
                </div>
                <div>
                  <span className="font-semibold text-ink">Machine:</span>{" "}
                  {machines.find((m) => m.machineId === selectedMachineId)?.machineName}
                </div>
                <div>
                  <span className="font-semibold text-ink">Shift:</span>{" "}
                  {selectedShiftId === "MORNING" ? "Morning Shift" : "Evening Shift"}
                </div>
              </div>

              <SelectInput
                label="Select Production Order"
                name="activeOrderId"
                value={activeOrderId}
                options={availableOrders.map((po) => ({
                  label: `${po.productionOrderId} (${po.productItem?.productName})`,
                  value: po.productionOrderId || "",
                }))}
                onChange={(e) => setActiveOrderId(e.target.value)}
              />

              {activeOrder ? (
                <div className="mt-4">
                  <div className="p-3 bg-card-2 rounded-md border border-line-soft mb-4">
                    <h6 className="text-xs font-bold text-ink uppercase tracking-wide mb-2">
                      Order Information
                    </h6>
                    <div className="text-xs text-ink-muted space-y-1">
                      <div>
                        <span className="font-semibold text-ink">Product:</span>{" "}
                        {activeOrder.productItem?.productName}
                      </div>
                      <div>
                        <span className="font-semibold text-ink">Planned Target:</span>{" "}
                        {activeOrder.targetQty} {activeOrder.uom}
                      </div>
                      <div>
                        <span className="font-semibold text-ink">Expected Run Hours:</span> 8 Hrs
                      </div>
                      <div>
                        <span className="font-semibold text-ink">Hourly Target:</span>{" "}
                        {hourlyTarget} {activeOrder.uom}/Hr
                      </div>
                      <div>
                        <span className="font-semibold text-ink">Setup Time:</span> N/A
                      </div>
                    </div>
                  </div>

                  <h6 className="text-xs font-bold text-ink uppercase tracking-wide mb-2">
                    Shift Status Controls
                  </h6>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleStatusChange("IN_PRODUCTION")}
                      disabled={activeOrder.status === "IN_PRODUCTION"}
                      className={statusButtonClass(
                        activeOrder.status === "IN_PRODUCTION",
                        "accent"
                      )}
                    >
                      <FaPlay size={13} /> Start Shift / Resume
                    </button>
                    <button
                      onClick={() => handleStatusChange("POST_PRODUCTION")}
                      disabled={
                        activeOrder.status === "POST_PRODUCTION" ||
                        activeOrder.status === "COMPLETED"
                      }
                      className={statusButtonClass(
                        activeOrder.status === "POST_PRODUCTION" ||
                          activeOrder.status === "COMPLETED",
                        "accent"
                      )}
                    >
                      <FaCheck size={13} /> Complete Shift / Finish
                    </button>
                    <button
                      onClick={() => handleStatusChange("CANCELLED")}
                      disabled={activeOrder.status === "CANCELLED"}
                      className={statusButtonClass(activeOrder.status === "CANCELLED", "danger")}
                    >
                      <FaStop size={13} /> Stop / Stoppage
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 p-3 rounded-md border border-[color:var(--color-warning)] bg-card text-[color:var(--color-warning)] text-xs text-center">
                  No active production order loaded for this machine shift slot. Please select or
                  schedule one.
                </div>
              )}
            </div>

            {/* Shift OEE Gauge Panel */}
            {activeOrder && (
              <div className="bg-card rounded-sm border border-line p-4">
                <h5 className="text-sm font-bold text-ink border-b border-line-soft pb-2 mb-3 flex items-center gap-2">
                  <FaCalculator className="text-ink-subtle" size={13} />
                  <span>Real-time Shift OEE</span>
                </h5>
                <div className="text-center py-3">
                  <div className="text-3xl font-bold text-ink font-mono">{analytics.oee}%</div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle font-bold mt-1">
                    Overall Shift OEE
                  </div>
                </div>

                <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-line-soft text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-ink-subtle">Machine Availability:</span>
                    <span className="font-bold text-ink">{analytics.availability}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink-subtle">Production Performance:</span>
                    <span className="font-bold text-ink">{analytics.performance}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink-subtle">Quality Index:</span>
                    <span className="font-bold text-ink">{analytics.quality}%</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-line-soft pt-2 mt-1">
                    <span className="text-ink-subtle">Total Downtime Minutes:</span>
                    <span className="px-2 py-0.5 rounded-sm border border-[color:var(--color-danger)] text-[color:var(--color-danger)] text-[11px] font-bold">
                      {analytics.totalDowntime} Min
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Hourly Production Logs & Downtime Logs */}
          <div className="lg:col-span-8">
            {activeOrder ? (
              <>
                {/* Hourly Entry Panel */}
                <div className="bg-card rounded-sm border border-line p-4 mb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h5 className="text-sm font-bold text-ink flex items-center gap-2">
                      <FaClipboardList className="text-ink-subtle" size={13} />
                      <span>Hourly Production Log</span>
                    </h5>
                    <div className="flex items-center gap-2">
                      {supervisorMode ? (
                        <button
                          onClick={() => setSupervisorMode(false)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-[color:var(--color-success)] text-[color:var(--color-success)] text-xs font-bold cursor-pointer"
                        >
                          <FaUnlock size={11} /> Supervisor Unlocked
                        </button>
                      ) : (
                        <button
                          onClick={() => setShowSupervisorModal(true)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm border border-line text-ink-muted text-xs font-semibold hover:bg-card-2 cursor-pointer"
                        >
                          <FaLock size={11} /> Supervisor Override
                        </button>
                      )}

                      <div className="flex items-center gap-1.5 text-xs text-ink-muted font-mono border border-line-soft rounded-sm px-2 py-1 bg-card-2">
                        Active Hour:
                        <select
                          value={activeHourIndex}
                          onChange={(e) => setActiveHourIndex(Number(e.target.value))}
                          className="border-none bg-transparent font-bold text-ink cursor-pointer focus:outline-none"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
                            <option key={h} value={h}>
                              Hour {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-line-soft rounded-sm">
                    <table className="w-full text-sm text-center">
                      <thead className="bg-card-2 border-b border-line-soft">
                        <tr>
                          <th
                            className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider"
                            style={{ width: "80px" }}
                          >
                            Hour
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Target Qty
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Actual Qty
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Reject Qty
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Scrap Qty
                          </th>
                          <th
                            className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider"
                            style={{ width: "90px" }}
                          >
                            Save
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((hour) => {
                          const isEditable = supervisorMode || hour === activeHourIndex;
                          const input = hourlyInputs[hour] || {
                            actual: "",
                            reject: "",
                            scrap: "",
                          };

                          return (
                            <tr
                              key={hour}
                              className={hour === activeHourIndex ? "bg-accent/5" : ""}
                            >
                              <td className="px-3 py-2 font-bold font-mono text-ink">H-{hour}</td>
                              <td className="px-3 py-2 font-mono text-ink-muted font-semibold">
                                {hourlyTarget} {activeOrder.uom}
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  className="w-full text-center font-mono bg-card border border-line-soft rounded-sm px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50 disabled:bg-card-2"
                                  placeholder="0"
                                  value={input.actual}
                                  disabled={!isEditable}
                                  onChange={(e) =>
                                    handleInputChange(hour, "actual", e.target.value)
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  className="w-full text-center font-mono bg-card border border-line-soft rounded-sm px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50 disabled:bg-card-2"
                                  placeholder="0"
                                  value={input.reject}
                                  disabled={!isEditable}
                                  onChange={(e) =>
                                    handleInputChange(hour, "reject", e.target.value)
                                  }
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number"
                                  className="w-full text-center font-mono bg-card border border-line-soft rounded-sm px-2 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 disabled:opacity-50 disabled:bg-card-2"
                                  placeholder="0"
                                  value={input.scrap}
                                  disabled={!isEditable}
                                  onChange={(e) => handleInputChange(hour, "scrap", e.target.value)}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <button
                                  disabled={!isEditable}
                                  onClick={() => handleSaveHourlyRow(hour)}
                                  className={`px-3 py-1.5 rounded-sm text-xs font-bold border transition-colors ${
                                    isEditable
                                      ? "border-accent text-accent hover:bg-accent hover:text-white cursor-pointer"
                                      : "border-line text-ink-subtle opacity-50 cursor-not-allowed"
                                  }`}
                                >
                                  Save
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Downtime Logs Panel */}
                <div className="bg-card rounded-sm border border-line p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h5 className="text-sm font-bold text-[color:var(--color-danger)] flex items-center gap-2">
                      <FaClock size={13} />
                      <span>Machine Stoppage & Downtime Logs</span>
                    </h5>
                    <button
                      onClick={() => setShowDowntimeModal(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[color:var(--color-danger)] text-white text-xs font-semibold hover:brightness-110 cursor-pointer"
                    >
                      <FaPlus size={11} /> Log Stoppage
                    </button>
                  </div>

                  <div className="overflow-x-auto border border-line-soft rounded-sm">
                    <table className="w-full text-sm text-center">
                      <thead className="bg-card-2 border-b border-line-soft">
                        <tr>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider text-left">
                            Downtime Reason
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Start Time
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            End Time
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Duration
                          </th>
                          <th className="px-3 py-2 text-xs font-bold text-ink-subtle uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {downtimeLogs.length > 0 ? (
                          downtimeLogs.map((log) => (
                            <tr key={log.id}>
                              <td className="px-3 py-2 font-bold text-left text-[color:var(--color-danger)]">
                                {log.reason}
                              </td>
                              <td className="px-3 py-2 font-mono text-ink-subtle text-[12px]">
                                {new Date(log.startTime).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 font-mono text-ink-subtle text-[12px]">
                                {new Date(log.endTime).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 font-bold text-ink font-mono">
                                {log.durationMinutes} Min
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  onClick={() => handleDeleteDowntime(log.id)}
                                  className="text-[color:var(--color-danger)] hover:opacity-70 cursor-pointer"
                                  aria-label="Delete downtime log"
                                >
                                  <FaTrash size={12} />
                                </button>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-ink-subtle text-sm">
                              No machine stoppages logged for this shift. High efficiency!
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-card rounded-sm border border-line py-14 text-center">
                <FaClipboardList className="text-ink-subtle mx-auto mb-3" size={40} />
                <h5 className="text-sm font-bold text-ink mb-1">
                  Awaiting active Production Order selection
                </h5>
                <p className="text-xs text-ink-subtle">
                  Please select a Production Order in the side panel to view execution grids and
                  logs.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Supervisor Verification Modal */}
      <CommonModal
        show={showSupervisorModal}
        onHide={() => setShowSupervisorModal(false)}
        title="Supervisor Authorization"
        maxWidth="sm"
        footer={
          <div className="flex items-center justify-center gap-2.5 w-full">
            <CustomButton
              text="Cancel"
              variant="secondary"
              onClick={() => setShowSupervisorModal(false)}
            />
            <CustomButton
              text="Unlock Console"
              onClick={() =>
                handleSupervisorVerify({ preventDefault: () => {} } as unknown as React.FormEvent)
              }
            />
          </div>
        }
      >
        <form onSubmit={handleSupervisorVerify}>
          <TextInput
            label="Enter Supervisor Passcode"
            name="passcode"
            type="password"
            placeholder="Enter passcode (Hint: 1234)"
            value={passcode}
            required
            onChange={(e) => setPasscode(e.target.value)}
            className="text-center font-mono"
          />
        </form>
      </CommonModal>

      {/* Add Downtime Modal */}
      <CommonModal
        show={showDowntimeModal}
        onHide={() => setShowDowntimeModal(false)}
        title="Log Machine Downtime Stoppage"
        maxWidth="lg"
        footer={
          <>
            <CustomButton
              text="Cancel"
              variant="secondary"
              onClick={() => setShowDowntimeModal(false)}
            />
            <CustomButton
              text="Log Stoppage"
              variant="danger"
              onClick={() =>
                handleAddDowntime({ preventDefault: () => {} } as unknown as React.FormEvent)
              }
            />
          </>
        }
      >
        <form onSubmit={handleAddDowntime}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <SelectInput
                label="Downtime Reason"
                name="downtimeReason"
                value={downtimeReason}
                options={[
                  { label: "Breakdown (Mechanical/Electrical)", value: "Breakdown" },
                  { label: "Mold Change", value: "Mold Change" },
                  { label: "Material Shortage", value: "Material Shortage" },
                  { label: "Power Failure", value: "Power Failure" },
                  { label: "Quality Issue (Inspection delay)", value: "Quality Issue" },
                  { label: "Operator Absence", value: "Operator Absence" },
                ]}
                required
                onChange={(e) => setDowntimeReason(e.target.value)}
              />
            </div>
            <TextInput
              label="Stoppage Start Time"
              name="downtimeStart"
              type="datetime-local"
              value={downtimeStart}
              required
              onChange={(e) => setDowntimeStart(e.target.value)}
            />
            <TextInput
              label="Stoppage End Time"
              name="downtimeEnd"
              type="datetime-local"
              value={downtimeEnd}
              required
              onChange={(e) => setDowntimeEnd(e.target.value)}
            />
          </div>
        </form>
      </CommonModal>
    </div>
  );
};

export default ShiftExecutionBoard;
