import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { CalendarRange, Check, Lock, Save } from "lucide-react";
import { ActionPill, EmptyState, PageHeader, SkeletonRows, Tile } from "../../../components/ui/v2";
import { PageBody, StickyFormFooter, formatQty } from "../../production/ui";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";

import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { createWeeklyProgram } from "../../../features/weekly-programs/weeklyProgramSlice";
import { weeklyProgramService } from "../../../services/weeklyProgramService";
import { productionOrderService } from "../../../services/productionOrderService";
import { usePermission } from "../../../hooks/usePermission";

const WeeklyMachineScheduleCreate: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const [weekStartDate, setWeekStartDate] = useState("");
  const [weekEndDate, setWeekEndDate] = useState("");

  const [productionOrders, setProductionOrders] = useState<any[]>([]);
  const [loadingPo, setLoadingPo] = useState(false);

  const [alreadyScheduled, setAlreadyScheduled] = useState<any[]>([]);

  const [selectedOrders, setSelectedOrders] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useFormShortcuts({});

  useEffect(() => {
    const loadProductionOrders = async () => {
      setLoadingPo(true);
      try {
        const res: any = await productionOrderService.fetchAll({ limit: 10 } as any);
        const list = res.data || res || [];
        const poList = Array.isArray(list) ? list : list.data || [];
        setProductionOrders(poList);
      } catch {
        // silently fail
      } finally {
        setLoadingPo(false);
      }
    };
    loadProductionOrders();
  }, [dispatch]);

  useEffect(() => {
    if (location.state) {
      const item = location.state as any;
      if (item.weekStartDate) setWeekStartDate(item.weekStartDate.split("T")[0]);
      if (item.weekEndDate) setWeekEndDate(item.weekEndDate.split("T")[0]);
    }
  }, [location.state]);

  const handleDateChange = useCallback((e: React.ChangeEvent<any>) => {
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
        setWeekStartDate(`${yyyy}-${mm}-${dd}`);
        const endDate = new Date(mondayDate);
        endDate.setDate(mondayDate.getDate() + 6);
        setWeekEndDate(
          `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`
        );
      }
    } else {
      setWeekStartDate("");
      setWeekEndDate("");
    }
  }, []);

  useEffect(() => {
    if (!weekStartDate) {
      setAlreadyScheduled([]);
      return;
    }
    const fetchScheduled = async () => {
      try {
        const res: any = await weeklyProgramService.getAll({ weekStartDate });
        const list = res.data || res || [];
        setAlreadyScheduled(Array.isArray(list) ? list : list.data || []);
      } catch {
        // silently fail
      }
    };
    fetchScheduled();
  }, [weekStartDate]);

  const displayOrders = useMemo(() => {
    const scheduledPoIds = new Set(alreadyScheduled.map((item: any) => item.productionOrderId));
    return productionOrders.filter((po: any) => {
      const isReadyStatus =
        po.status === "RM_AVAILABLE" ||
        po.status === "READY_FOR_PLANNING" ||
        po.status === "SCHEDULE_DELETED";
      return isReadyStatus && !scheduledPoIds.has(po.productionOrderId);
    });
  }, [productionOrders, alreadyScheduled]);

  const handleToggleSelect = (poId: string) => {
    setSelectedOrders((prev) => ({ ...prev, [poId]: !prev[poId] }));
  };

  const handleSubmit = async () => {
    const selectedIds = Object.keys(selectedOrders).filter((id) => selectedOrders[id]);
    if (selectedIds.length === 0) {
      toast.error("Please select at least one order to allocate.");
      return;
    }
    setIsSubmitting(true);
    try {
      for (let i = 0; i < selectedIds.length; i++) {
        const poId = selectedIds[i];
        const po = displayOrders.find((o: any) => o.productionOrderId === poId);
        if (!po) continue;
        const qty = Number(po.targetQty) || 0;
        if (qty <= 0) continue;
        const actualId = await weeklyProgramService.fetchNextId();
        const validPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"];
        const mappedPriority =
          po.priority && validPriorities.includes(po.priority.toUpperCase())
            ? po.priority.toUpperCase()
            : "MEDIUM";
        await dispatch(
          createWeeklyProgram({
            weeklyProgramId: actualId,
            productionOrderId: po.productionOrderId,
            weekStartDate,
            weekEndDate,
            machineId: null,
            dayOfWeek: 1,
            shiftId: null,
            plannedQty: qty,
            plannedHours: 0,
            setupHours: 0,
            sequenceNo: i + 1,
            priority: mappedPriority,
            status: "PLANNED",
          })
        ).unwrap();
      }
      toast.success("Orders successfully allocated to the week!");
      navigate("/weekly-machine-schedules");
    } catch (err: any) {
      let errMsg = "Failed to save schedule.";
      if (typeof err === "string") errMsg = err;
      else if (err?.message && err.message !== "Rejected") errMsg = err.message;
      else if (err?.response?.data?.message) errMsg = err.response.data.message;
      toast.error(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCount = Object.values(selectedOrders).filter(Boolean).length;

  return (
    <PageBody className="max-w-[1200px]">
      <PageHeader
        title="Allocate Weekly Schedule"
        subtitle="Select a week and assign ready production orders"
        back="/weekly-machine-schedules"
        backLabel="Back to List"
        breadcrumbs={[
          { label: "Weekly schedules", to: "/weekly-machine-schedules" },
          { label: "Plan week" },
        ]}
      />

      <Tile title="Week" subtitle="Any date you pick snaps to its Monday; the week ends on Sunday.">
        <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
          <DatePickerCalendar
            label="Week Start Date"
            name="weekStartDate"
            value={weekStartDate ? new Date(weekStartDate) : null}
            required
            onChange={(e: any) => handleDateChange(e)}
          />
          <DatePickerCalendar
            label="Week End Date"
            name="weekEndDate"
            value={weekEndDate ? new Date(weekEndDate) : null}
            disabled
          />
        </div>
      </Tile>

      {weekStartDate ? (
        <Tile
          padding="none"
          title="Ready production orders"
          subtitle="Tap the orders to run this week. Orders already on the schedule are shown greyed out."
          divider
        >
          {loadingPo ? (
            <SkeletonRows rows={4} columns={4} label="Loading production orders..." />
          ) : displayOrders.length > 0 || alreadyScheduled.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-ink">
                <thead className="bg-card-2">
                  <tr className="border-b border-line-soft">
                    <th scope="col" className="sl-th px-4 py-3 text-center" style={{ width: 56 }}>
                      <span className="sr-only">Select</span>
                      <Check size={13} className="mx-auto text-ink-subtle" aria-hidden="true" />
                    </th>
                    <th scope="col" className="sl-th px-4 py-3">
                      Production Order
                    </th>
                    <th scope="col" className="sl-th px-4 py-3">
                      Product
                    </th>
                    <th scope="col" className="sl-th px-4 py-3 text-right">
                      Qty
                    </th>
                    <th scope="col" className="sl-th px-4 py-3">
                      Priority / Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrders.map((po: any) => {
                    const isSelected = !!selectedOrders[po.productionOrderId];
                    return (
                      <tr
                        key={po.productionOrderId}
                        className={`sl-row-hover h-[56px] cursor-pointer border-b border-line-soft ${isSelected ? "bg-nav-active" : ""}`}
                        onClick={() => handleToggleSelect(po.productionOrderId)}
                      >
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="sl-check h-5 w-5"
                            aria-label={`Select ${po.productionOrderId}`}
                            checked={isSelected}
                            onChange={() => handleToggleSelect(po.productionOrderId)}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-[13px] font-semibold text-accent">
                          {po.productionOrderId}
                        </td>
                        <td className="px-4 py-3 font-medium text-ink">
                          {po.productItem?.productName || "-"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">
                          {formatQty(po.targetQty)}{" "}
                          <span className="text-xs font-normal text-ink-subtle">PCS</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={po.priority || "MEDIUM"} />
                        </td>
                      </tr>
                    );
                  })}

                  {alreadyScheduled.length > 0 &&
                    alreadyScheduled.map((program: any) => (
                      <tr
                        key={`sched-${program.weeklyProgramId}`}
                        className="h-[56px] border-b border-line-soft bg-card-2 text-ink-subtle"
                      >
                        <td className="px-4 py-3 text-center">
                          <Lock size={14} className="mx-auto" aria-label="Already scheduled" />
                        </td>
                        <td className="px-4 py-3 font-mono text-[13px] font-semibold">
                          {program.productionOrderId}
                        </td>
                        <td className="px-4 py-3">
                          {program.productionOrder?.productItem?.productName || "-"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatQty(program.plannedQty)} <span className="text-xs">PCS</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={program.status || "SCHEDULED"} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No ready production orders found for this week."
              description="Orders appear here once their material is ready and they are not yet scheduled."
            />
          )}
        </Tile>
      ) : (
        <Tile>
          <EmptyState
            icon={<CalendarRange size={28} />}
            title="Waiting for Week Start Date"
            description="Select a Week Start Date above to view ready production orders."
          />
        </Tile>
      )}

      {weekStartDate && selectedCount > 0 && (
        <StickyFormFooter
          hint={
            <span className="font-semibold text-accent">
              {selectedCount} order{selectedCount > 1 ? "s" : ""} selected
            </span>
          }
        >
          <ActionPill variant="secondary" onClick={() => navigate("/weekly-machine-schedules")}>
            Cancel
          </ActionPill>
          {can("weekly_programs.create") && (
            <ActionPill
              icon={<Save size={17} />}
              onClick={handleSubmit}
              loading={isSubmitting}
              loadingText="Saving..."
            >
              Confirm & Allocate
            </ActionPill>
          )}
        </StickyFormFooter>
      )}
    </PageBody>
  );
};

export default WeeklyMachineScheduleCreate;
