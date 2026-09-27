import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { Save } from "lucide-react";
import { ActionPill, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import { Figure, InfoItem, PageBody, StickyFormFooter, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  createWeeklyProgram,
  fetchWeeklyPrograms,
} from "../../../features/weekly-programs/weeklyProgramSlice";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { fetchShifts } from "../../../features/shifts/shiftSlice";
import { weeklyProgramService } from "../../../services/weeklyProgramService";
import { productionOrderService } from "../../../services/productionOrderService";
import { usePermission } from "../../../hooks/usePermission";

const normalizePriority = (pri?: string): "LOW" | "MEDIUM" | "HIGH" | "URGENT" => {
  if (!pri) return "MEDIUM";
  const upper = pri.toUpperCase();
  if (upper === "LOW") return "LOW";
  if (upper === "MEDIUM" || upper === "NORMAL") return "MEDIUM";
  if (upper === "HIGH") return "HIGH";
  if (upper === "URGENT") return "URGENT";
  return "MEDIUM";
};

const generateTempId = () => `WP-TEMP-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

const WeeklyMachineScheduleEdit: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const [weekStartDate, setWeekStartDate] = useState("");
  const [weekEndDate, setWeekEndDate] = useState("");
  const [targetPoId, setTargetPoId] = useState("");

  const [productionOrders, setProductionOrders] = useState<any[]>([]);
  const [loadingPo, setLoadingPo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form inputs for editing
  const [selectedMachineId, setSelectedMachineId] = useState("");
  const [plannedQty, setPlannedQty] = useState("");

  const [deletedDbPrograms, setDeletedDbPrograms] = useState<string[]>([]);

  useFormShortcuts({});

  const { data: machines } = useAppSelector((state) => state.machines);
  const { data: shifts } = useAppSelector((state: any) => state.shifts || { data: [] });
  const { data: weeklyPrograms } = useAppSelector(
    (state: any) => state.weeklyPrograms || { data: [] }
  );

  useEffect(() => {
    dispatch(fetchMachines());
    dispatch(fetchShifts());
    dispatch(fetchWeeklyPrograms(undefined));

    const loadProductionOrders = async () => {
      setLoadingPo(true);
      try {
        const res: any = await productionOrderService.fetchAll({ limit: 10 } as any);
        const list = res.data || res || [];
        const poList = Array.isArray(list) ? list : list.data || [];
        setProductionOrders(poList);
      } catch (err) {
        console.error("Failed to load production orders", err);
      } finally {
        setLoadingPo(false);
      }
    };

    loadProductionOrders();

    if (location.state) {
      const item = location.state as any;
      if (item.productionOrderId) {
        setTargetPoId(item.productionOrderId);
      }
      if (item.machineId) {
        setSelectedMachineId(item.machineId);
      }
      if (item.weekStartDate) {
        const date = new Date(item.weekStartDate);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        setWeekStartDate(`${yyyy}-${mm}-${dd}`);

        const endDate = new Date(date);
        endDate.setDate(date.getDate() + 6);
        const endYyyy = endDate.getFullYear();
        const endMm = String(endDate.getMonth() + 1).padStart(2, "0");
        const endDd = String(endDate.getDate()).padStart(2, "0");
        setWeekEndDate(`${endYyyy}-${endMm}-${endDd}`);
      }
    } else {
      toast.error("No schedule context provided for edit.");
      navigate("/weekly-machine-schedules");
    }
  }, [dispatch, location.state, navigate]);

  // Active programs in DB for the selected week & production order
  const dbProgramsForPo = useMemo(
    () =>
      weeklyPrograms.filter(
        (wp: any) =>
          wp.weekStartDate.split("T")[0] === weekStartDate &&
          wp.productionOrderId === targetPoId &&
          wp.status !== "CANCELLED"
      ),
    [weeklyPrograms, weekStartDate, targetPoId]
  );

  // Initial load of planned qty from existing db schedules
  useEffect(() => {
    if (dbProgramsForPo.length > 0) {
      const totalPlanned = dbProgramsForPo.reduce(
        (sum: number, wp: any) => sum + Number(wp.plannedQty || 0),
        0
      );
      setPlannedQty(String(totalPlanned));
      setDeletedDbPrograms(dbProgramsForPo.map((wp: any) => wp.weeklyProgramId));
    }
  }, [dbProgramsForPo]);

  // Details of the specific PO being edited
  const currentPo = useMemo(
    () => productionOrders.find((po: any) => po.productionOrderId === targetPoId),
    [productionOrders, targetPoId]
  );

  // Helper to calculate total allocated quantity for a PO excluding the current week's editable records
  const getOtherAllocatedQty = useCallback(() => {
    const totalAllocated = weeklyPrograms
      .filter((wp: any) => wp.productionOrderId === targetPoId && wp.status !== "CANCELLED")
      .reduce((sum: number, wp: any) => sum + Number(wp.plannedQty || 0), 0);

    const currentWeekAllocated = dbProgramsForPo.reduce(
      (sum: number, wp: any) => sum + Number(wp.plannedQty || 0),
      0
    );

    return Math.max(0, totalAllocated - currentWeekAllocated);
  }, [weeklyPrograms, dbProgramsForPo, targetPoId]);

  // Distributes planned quantities sequentially across shifts and days in the background
  const autoAllocatePrograms = (plannedQuantity: number, machineId: string) => {
    const newStaged: any[] = [];
    const bookedInSlot: Record<string, number> = {};

    // Pre-populate bookedInSlot with other active weekly program allocations (excluding the ones we are editing/deleting)
    const currentWeekIds = dbProgramsForPo.map((wp: any) => wp.weeklyProgramId);
    weeklyPrograms.forEach((wp: any) => {
      if (
        wp.weekStartDate.split("T")[0] === weekStartDate &&
        wp.status !== "CANCELLED" &&
        !currentWeekIds.includes(wp.weeklyProgramId)
      ) {
        const key = `${wp.machineId}_${wp.dayOfWeek}_${wp.shiftId}`;
        bookedInSlot[key] = (bookedInSlot[key] || 0) + Number(wp.plannedQty);
      }
    });

    const machine = machines.find((m) => m.machineId === machineId);
    if (!machine) return newStaged;

    const shiftCapacityQty = (machine as any).capacity ? Number((machine as any).capacity) : 2000;
    const cycleTimeSec = machine.cycleTime
      ? Number(machine.cycleTime)
      : (8 * 3600) / shiftCapacityQty;

    let remainingRequiredQty = plannedQuantity;
    let currentDay = 1;
    let currentShiftIndex = 0;

    while (remainingRequiredQty > 0) {
      if (currentDay > 7) {
        const sundayLastShift = shifts[shifts.length - 1];
        if (sundayLastShift) {
          const activeShiftId = sundayLastShift.shiftCode || sundayLastShift.id;
          const nextIdTemp = generateTempId();
          newStaged.push({
            weeklyProgramId: nextIdTemp,
            productionOrderId: targetPoId,
            weekStartDate,
            weekEndDate,
            machineId,
            dayOfWeek: 7,
            shiftId: activeShiftId,
            plannedQty: remainingRequiredQty,
            plannedHours: Number(((remainingRequiredQty * cycleTimeSec) / 3600).toFixed(2)),
            setupHours: 0,
            sequenceNo: 1,
            priority: normalizePriority(currentPo?.priority),
            status: "PLANNED",
            productItem: currentPo?.productItem,
          });
        }
        break;
      }

      const currentShift = shifts[currentShiftIndex];
      if (!currentShift) {
        currentShiftIndex = 0;
        currentDay++;
        continue;
      }

      const activeShiftId = currentShift.shiftCode || currentShift.id;
      const slotKey = `${machineId}_${currentDay}_${activeShiftId}`;

      const bookedQtyInSlot = bookedInSlot[slotKey] || 0;
      const shiftRemainingCapacityQty = Math.max(0, shiftCapacityQty - bookedQtyInSlot);

      if (shiftRemainingCapacityQty > 0) {
        const qtyToAllocate = Math.min(shiftRemainingCapacityQty, remainingRequiredQty);
        const nextIdTemp = generateTempId();

        newStaged.push({
          weeklyProgramId: nextIdTemp,
          productionOrderId: targetPoId,
          weekStartDate,
          weekEndDate,
          machineId,
          dayOfWeek: currentDay,
          shiftId: activeShiftId,
          plannedQty: qtyToAllocate,
          plannedHours: Number(((qtyToAllocate * cycleTimeSec) / 3600).toFixed(2)),
          setupHours: 0,
          sequenceNo: 1,
          priority: normalizePriority(currentPo?.priority),
          status: "PLANNED",
          productItem: currentPo?.productItem,
        });

        bookedInSlot[slotKey] = bookedQtyInSlot + qtyToAllocate;
        remainingRequiredQty -= qtyToAllocate;
      }

      if (remainingRequiredQty > 0) {
        currentShiftIndex++;
        if (currentShiftIndex >= shifts.length) {
          currentShiftIndex = 0;
          currentDay++;
        }
      }
    }

    return newStaged;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMachineId || !plannedQty) {
      toast.error("Please select a machine and enter planned quantity.");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Delete old DB entries
      for (const idToDelete of deletedDbPrograms) {
        await weeklyProgramService.delete(idToDelete);
      }

      // 2. Generate new allocations in background
      const staged = autoAllocatePrograms(Number(plannedQty), selectedMachineId);
      if (staged.length === 0) {
        toast.error("Could not allocate any quantity. Please verify machine capacities.");
        setIsSubmitting(false);
        return;
      }

      // 3. Save new allocations sequentially
      for (let i = 0; i < staged.length; i++) {
        const program = staged[i];
        const actualId = await weeklyProgramService.fetchNextId();
        const payload = {
          ...program,
          weeklyProgramId: actualId,
          sequenceNo: i + 1,
        };
        await dispatch(createWeeklyProgram(payload)).unwrap();
      }

      toast.success("Weekly assignment updated successfully!");
      navigate("/weekly-machine-schedules");
    } catch (err: any) {
      console.error("EDIT SAVE ERROR =>", err);
      toast.error(
        err?.response?.data?.message || err?.message || "Failed to update weekly assignment"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const otherAllocated = getOtherAllocatedQty();
  const remainingToPlan = currentPo ? Math.max(0, Number(currentPo.targetQty) - otherAllocated) : 0;

  const uom = currentPo?.uom?.toLowerCase() === "ea" ? "pcs" : currentPo?.uom;
  const header = (
    <PageHeader
      title="Edit Weekly Assignment"
      subtitle="Update the planned quantity and machine for this week"
      back="/weekly-machine-schedules"
      backLabel="Back to List"
      breadcrumbs={[
        { label: "Weekly schedules", to: "/weekly-machine-schedules" },
        { label: "Edit assignment" },
      ]}
    />
  );

  if (loadingPo || !currentPo) {
    return (
      <PageBody className="max-w-[1100px]">
        {header}
        <SkeletonTile lines={4} label="Loading assignment details..." />
        <SkeletonTile lines={2} />
      </PageBody>
    );
  }

  return (
    <PageBody className="max-w-[1100px]">
      {header}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Tile title="Assignment Context">
          <dl className="m-0 grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoItem label="Production Order ID" value={targetPoId} mono />
            <InfoItem
              label="Product Name"
              value={currentPo.productItem?.productName || "Unknown Product"}
            />
            <InfoItem
              label="Week Start Date"
              value={weekStartDate ? formatDate(weekStartDate) : "—"}
            />
            <InfoItem label="Week End Date" value={weekEndDate ? formatDate(weekEndDate) : "—"} />
          </dl>
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-[16px] bg-card-2 p-4">
            <Figure label="Order Target Qty" value={formatQty(currentPo.targetQty)} hint={uom} />
            <Figure label="Other Weeks Allocated" value={formatQty(otherAllocated)} hint={uom} />
            <Figure
              label="Remaining To Plan"
              tone="accent"
              value={formatQty(remainingToPlan)}
              hint={uom}
            />
          </div>
        </Tile>

        <Tile title="This week">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              label="Planned Qty This Week"
              name="plannedQty"
              type="number"
              inputMode="numeric"
              required
              value={plannedQty}
              onChange={(e) => setPlannedQty(e.target.value)}
              min={1}
              max={remainingToPlan}
            />
            <TextInput
              label="Assigned Machine"
              name="assignedMachine"
              value={
                machines.find((m: any) => m.machineId === selectedMachineId)?.machineName ||
                selectedMachineId
              }
              disabled
            />
          </div>
        </Tile>

        <StickyFormFooter hint="F2 saves">
          <ActionPill
            variant="secondary"
            onClick={() => navigate("/weekly-machine-schedules")}
            disabled={isSubmitting}
          >
            Cancel
          </ActionPill>
          {can("weekly_programs.edit") && (
            <ActionPill
              type="submit"
              icon={<Save size={17} />}
              loading={isSubmitting}
              loadingText="Saving..."
            >
              Update Assignment
            </ActionPill>
          )}
        </StickyFormFooter>
      </form>
    </PageBody>
  );
};

export default WeeklyMachineScheduleEdit;
