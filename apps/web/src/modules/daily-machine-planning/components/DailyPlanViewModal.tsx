import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Cog,
  PackageOpen,
  Share2,
  Truck,
} from "lucide-react";
import { formatDate } from "../../../utils/dateUtils";

import apiClient from "../../../api/apiClient";
import config from "../../../api/config";
import { oeeService } from "../../../services/oeeService";
import { weeklyProgramService } from "../../../services/weeklyProgramService";
import { dailyPlanService } from "../../../services/dailyPlanService";
import { productCapacityHistoryService } from "../../../services/productCapacityHistoryService";
import { useSocketSync } from "../../../hooks/useSocketSync";

import CommonModal from "../../../components/ui/Modal/CommonModal";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";

interface DailyPlanViewModalProps {
  show: boolean;
  onHide: () => void;
  plan: any;
}

const DailyPlanViewModal: React.FC<DailyPlanViewModalProps> = ({
  show,
  onHide,
  plan: initialPlan,
}) => {
  const [viewPlan, setViewPlan] = useState<any>(initialPlan);

  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [weeklyProgram, setWeeklyProgram] = useState<any>(null);
  const [loadingViewLogs, setLoadingViewLogs] = useState(false);
  const [viewHourlyLogs, setViewHourlyLogs] = useState<any[]>([]);
  const [viewPlanOeeSummary, setViewPlanOeeSummary] = useState<any>(null);
  const [loadingPOHistory, setLoadingPOHistory] = useState(false);
  const [poHistoryPlans, setPOHistoryPlans] = useState<any[]>([]);

  // Reset and fetch when plan changes or modal opens
  useEffect(() => {
    if (show && initialPlan) {
      setViewPlan(initialPlan);
      setWeeklyProgram(null);
      setViewHourlyLogs([]);
      setViewPlanOeeSummary(null);
      setPOHistoryPlans([]);
    }
  }, [show, initialPlan?.dailyPlanId]);

  const fetchAllData = useCallback(async () => {
    if (!show) return;
    if (!viewPlan?.productionOrderId && !viewPlan?.dailyPlanId) return;
    let currentPlan = viewPlan;

    if (!currentPlan.productionOrderId && currentPlan.dailyPlanId) {
      try {
        const res = await dailyPlanService.getById(currentPlan.dailyPlanId);
        if (res) {
          currentPlan = res;
          setViewPlan(currentPlan);
        }
      } catch (e) {
        console.error("Failed to fetch plan details", e);
        return;
      }
    }

    setLoadingViewLogs(true);
    apiClient
      .get(config.hourlyProduction.base, {
        params: {
          machineId: currentPlan.machineId,
          shiftId: currentPlan.shiftId,
          productionDate: currentPlan.productionDate?.split("T")[0],
          productionOrderId: currentPlan.productionOrderId,
        },
      })
      .then((res) => {
        if (res.data?.success)
          setViewHourlyLogs((res.data.data || []).filter((h: any) => Number(h.hourIndex) > 0));
        else setViewHourlyLogs([]);
      })
      .catch(() => setViewHourlyLogs([]))
      .finally(() => setLoadingViewLogs(false));

    oeeService
      .getProductionOrderOee(currentPlan.productionOrderId)
      .then((data: any) => setViewPlanOeeSummary(data))
      .catch(() => setViewPlanOeeSummary(null));

    if (currentPlan.weeklyProgramId) {
      setLoadingWeekly(true);
      weeklyProgramService
        .getById(currentPlan.weeklyProgramId)
        .then((res: any) => {
          const data = res?.data || res;
          setWeeklyProgram(data);
        })
        .catch(() => setWeeklyProgram(null))
        .finally(() => setLoadingWeekly(false));
    }

    if (currentPlan.productionOrderId) {
      setLoadingPOHistory(true);
      dailyPlanService
        .getAll({ productionOrderId: currentPlan.productionOrderId })
        .then((res: any) => {
          let plans: any[] = [];
          if (Array.isArray(res)) plans = res;
          else if (Array.isArray(res?.data)) plans = res.data;
          else if (Array.isArray(res?.data?.dailyPlans)) plans = res.data.dailyPlans;
          else if (Array.isArray(res?.dailyPlans)) plans = res.dailyPlans;
          plans.sort(
            (a: any, b: any) =>
              new Date(b.productionDate || 0).getTime() - new Date(a.productionDate || 0).getTime()
          );
          setPOHistoryPlans(plans);
        })
        .catch(() => setPOHistoryPlans([]))
        .finally(() => setLoadingPOHistory(false));
    }

    if (currentPlan.machineId && currentPlan.productionOrder?.productItem?.id) {
      productCapacityHistoryService
        .fetchByProductAndMachine(
          Number(currentPlan.productionOrder.productItem.id),
          currentPlan.machineId
        )
        .catch(() => {});
    }
  }, [show, viewPlan?.dailyPlanId, viewPlan?.productionOrderId]);

  useEffect(() => {
    if (show) fetchAllData();
  }, [fetchAllData, show]);

  useSocketSync("dailyPlan", undefined, () => {
    if (show) fetchAllData();
  });
  useSocketSync("hourlyProduction", undefined, () => {
    if (show) fetchAllData();
  });

  const weeklyTargetQty = weeklyProgram ? Number(weeklyProgram.targetQty || 0) : 0;
  const weeklyProducedQty = viewPlan?.productionOrder
    ? (() => {
        const totalProduced = Array.isArray(viewPlan.hourlyProductions)
          ? viewPlan.hourlyProductions.reduce(
              (s: number, h: any) =>
                s +
                Math.max(
                  0,
                  Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                ),
              0
            )
          : 0;
        return totalProduced;
      })()
    : 0;
  const weeklyOrderTargetQty = viewPlan?.productionOrder
    ? Number(viewPlan.productionOrder.targetQty || 0)
    : 0;
  const weeklyOrderProducedQty = viewPlanOeeSummary?.goodQty ?? weeklyProducedQty;
  const weeklyOrderPct =
    weeklyOrderTargetQty > 0
      ? Math.min(100, Math.round((weeklyOrderProducedQty / weeklyOrderTargetQty) * 100))
      : 0;
  const weeklyProgramPct =
    weeklyTargetQty > 0
      ? Math.min(100, Math.round((weeklyOrderProducedQty / weeklyTargetQty) * 100))
      : 0;

  const poHistoryColumns: DataTableColumn<any>[] = useMemo(
    () => [
      {
        header: "Plan ID",
        render: (plan: any) => {
          const isCurrent = plan.dailyPlanId === viewPlan?.dailyPlanId;
          return (
            <span
              className={`font-mono text-xs font-semibold ${isCurrent ? "text-accent" : "text-ink-muted"}`}
            >
              {plan.dailyPlanId}
              {isCurrent && <span className="sl-chip sl-chip-sm ml-1.5">Current</span>}
            </span>
          );
        },
      },
      {
        header: "Date",
        render: (plan: any) => (
          <span className="text-xs text-ink-muted">
            {plan.productionDate
              ? new Date(plan.productionDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </span>
        ),
      },
      {
        header: "Machine",
        render: (plan: any) => (
          <span className="text-xs text-ink-muted">
            {plan.machine?.machineName || plan.machineId || "—"}
          </span>
        ),
      },
      {
        header: "Shift",
        render: (plan: any) => (
          <span className="text-[10px] bg-card-2 text-ink-muted border border-line px-2 py-0.5 rounded font-medium">
            {plan.shift?.shiftName || plan.shiftId || "—"}
          </span>
        ),
      },
      {
        header: "Planned",
        align: "center",
        render: (plan: any) => (
          <span className="text-xs font-semibold text-ink-muted">
            {Number(plan.plannedQty || 0).toLocaleString("en-IN")}
          </span>
        ),
      },
      {
        header: "Produced",
        align: "center",
        render: (plan: any) => {
          const producedQty = Array.isArray(plan.hourlyProductions)
            ? plan.hourlyProductions.reduce(
                (s: number, h: any) =>
                  s +
                  Math.max(
                    0,
                    Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
                  ),
                0
              )
            : 0;
          return (
            <span
              className={`text-xs font-bold ${producedQty >= Number(plan.plannedQty || 0) ? "text-[color:var(--color-success)]" : producedQty > 0 ? "text-[color:var(--color-warning)]" : "text-ink-subtle"}`}
            >
              {producedQty.toLocaleString("en-IN")}
            </span>
          );
        },
      },
      {
        header: "Status",
        align: "center",
        render: (plan: any) => <StatusBadge status={plan.status} />,
      },
    ],
    [viewPlan?.dailyPlanId]
  );

  if (!show) return null;

  const modalTitle = (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] bg-chip text-accent">
        <Cog size={17} aria-hidden="true" />
      </div>
      <div>
        <div className="text-base font-bold text-ink leading-tight">
          Daily Plan — {viewPlan?.dailyPlanId}
        </div>
        <div className="text-xs text-ink-subtle mt-0.5">
          {viewPlan?.productionDate ? formatDate(viewPlan.productionDate) : "—"} ·{" "}
          {viewPlan?.machine?.machineName || viewPlan?.machineId} ·{" "}
          {viewPlan?.shift?.shiftName || viewPlan?.shiftId}
        </div>
      </div>
    </div>
  );

  return (
    <CommonModal show={show} onHide={onHide} title={modalTitle} maxWidth="6xl">
      <div className="overflow-y-auto p-5 space-y-5">
        {/* ── Weekly Production Target Progress ── */}
        {viewPlan?.weeklyProgramId && (
          <div className="rounded-[16px] bg-card-2 p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="text-ink-subtle" size={15} />
              <h6 className="sl-h2 m-0 text-[15px]">Weekly Target Progress</h6>
              <span className="ml-auto text-xs sl-chip sl-chip-sm sl-chip-muted font-mono">
                {viewPlan.weeklyProgramId}
              </span>
            </div>

            {loadingWeekly ? (
              <div className="flex items-center gap-2 text-sm text-ink-subtle">
                <div className="w-4 h-4 border-2 border-line border-t-transparent rounded-full motion-safe:animate-spin" />
                Loading weekly data...
              </div>
            ) : (
              <div className="space-y-4">
                {/* Production Order Target */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-ink-muted">
                      Production Order Target
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-ink-subtle">
                        {weeklyOrderProducedQty.toLocaleString("en-IN")} /{" "}
                        {weeklyOrderTargetQty.toLocaleString("en-IN")} pcs
                      </span>
                      <span
                        className={`sl-chip sl-chip-sm ${weeklyOrderPct >= 100 ? "sl-chip-success" : weeklyOrderPct >= 50 ? "sl-chip-muted" : "sl-chip-warning"}`}
                      >
                        {weeklyOrderPct}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 bg-card-2 rounded-full overflow-hidden border border-line-soft">
                    <div
                      className={`h-full rounded-full transition-all ${weeklyOrderPct >= 100 ? "bg-[color:var(--color-success)]" : weeklyOrderPct >= 50 ? "bg-accent" : "bg-[color:var(--color-warning)]"}`}
                      style={{ width: `${weeklyOrderPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-xs text-ink-subtle">
                      Produced:{" "}
                      <strong className="text-[color:var(--color-success)]">
                        {weeklyOrderProducedQty.toLocaleString("en-IN")}
                      </strong>
                    </span>
                    <span className="text-xs text-ink-subtle">
                      Remaining:{" "}
                      <strong className="text-[color:var(--color-warning)]">
                        {Math.max(0, weeklyOrderTargetQty - weeklyOrderProducedQty).toLocaleString(
                          "en-IN"
                        )}
                      </strong>
                    </span>
                  </div>
                </div>

                {/* Weekly Program Target */}
                {weeklyTargetQty > 0 && (
                  <div className="pt-3 border-t border-line-soft">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-ink-muted">
                        Weekly Program Target
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-subtle">
                          {weeklyOrderProducedQty.toLocaleString("en-IN")} /{" "}
                          {weeklyTargetQty.toLocaleString("en-IN")} pcs
                        </span>
                        <span
                          className={`sl-chip sl-chip-sm ${weeklyProgramPct >= 100 ? "sl-chip-success" : weeklyProgramPct >= 50 ? "sl-chip-muted" : "sl-chip-danger"}`}
                        >
                          {weeklyProgramPct}%
                        </span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-card-2 rounded-full overflow-hidden border border-line-soft">
                      <div
                        className={`h-full rounded-full transition-all ${weeklyProgramPct >= 100 ? "bg-[color:var(--color-success)]" : weeklyProgramPct >= 50 ? "bg-accent" : "bg-[color:var(--color-danger)]"}`}
                        style={{ width: `${weeklyProgramPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Completion chips */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {weeklyOrderPct >= 100 ? (
                    <span className="sl-chip sl-chip-success">
                      <CheckCircle2 size={13} aria-hidden="true" /> Weekly Target Complete!
                    </span>
                  ) : (
                    <span className="sl-chip sl-chip-warning">
                      <PackageOpen size={13} aria-hidden="true" />{" "}
                      {Math.max(0, weeklyOrderTargetQty - weeklyOrderProducedQty).toLocaleString(
                        "en-IN"
                      )}{" "}
                      pcs remaining to complete
                    </span>
                  )}
                  {viewPlan?.productionOrder?.status === "COMPLETED" && (
                    <span className="sl-chip sl-chip-info">
                      <Truck size={13} aria-hidden="true" /> Ready for Dispatch
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Plan Details Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-[16px] bg-card-2 p-4">
            <h6 className="sl-section-label m-0 mb-3">Plan Details</h6>
            <dl className="space-y-2.5 text-sm">
              {[
                { label: "Production Order", value: viewPlan?.productionOrderId },
                {
                  label: "Product",
                  value: viewPlan?.productionOrder?.productItem?.productName || "—",
                },
                { label: "Date", value: viewPlan?.productionDate?.split("T")[0] },
                { label: "Machine", value: viewPlan?.machine?.machineName || viewPlan?.machineId },
                { label: "Shift", value: viewPlan?.shift?.shiftName || viewPlan?.shiftId },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start gap-2">
                  <dt className="text-ink-subtle font-medium w-36 flex-shrink-0">{label}:</dt>
                  <dd className="text-ink font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-[16px] bg-card-2 p-4">
            <h6 className="sl-section-label m-0 mb-3">Quantities & Status</h6>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-start gap-2">
                <dt className="text-ink-subtle font-medium w-36 flex-shrink-0">Planned Qty:</dt>
                <dd className="text-ink font-semibold">{viewPlan?.plannedQty} pcs</dd>
              </div>
              <div className="flex items-start gap-2">
                <dt className="text-ink-subtle font-medium w-36 flex-shrink-0">Planned Hours:</dt>
                <dd className="text-ink font-semibold">{viewPlan?.plannedHours || "—"} hrs</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-ink-subtle font-medium w-36 flex-shrink-0">Priority:</dt>
                <dd>
                  <StatusBadge status={viewPlan?.priority || "MEDIUM"} />
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-ink-subtle font-medium w-36 flex-shrink-0">Status:</dt>
                <dd>
                  <StatusBadge status={viewPlan?.status} />
                </dd>
              </div>
              {viewPlan?.remarks && (
                <div className="flex items-start gap-2 mt-1">
                  <dt className="text-ink-subtle font-medium w-36 flex-shrink-0">Narration:</dt>
                  <dd className="text-ink-muted text-sm leading-relaxed">{viewPlan.remarks}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* ── Post Production Steps ── */}
        {viewPlan?.productionOrder?.productItem?.productionSteps?.length > 0 && (
          <div className="rounded-[16px] border border-line-soft overflow-hidden">
            <div className="px-4 py-2.5 bg-card-2 border-b border-line">
              <h6 className="sl-section-label m-0">Post Production Steps</h6>
            </div>
            <div className="p-4 flex flex-wrap gap-2.5 items-center">
              {viewPlan.productionOrder.productItem.productionSteps.map(
                (step: any, idx: number) => {
                  const stepNum = idx + 1;
                  const currentStep = viewPlan.currentStepIndex || 1;
                  let isCompleted = false;
                  let isActive = false;

                  if (viewPlan.status === "COMPLETED" || viewPlan.status === "READY_FOR_DISPATCH") {
                    isCompleted = true;
                  } else if (viewPlan.status === "POST_PRODUCTION") {
                    isCompleted = stepNum < currentStep;
                    isActive = stepNum === currentStep;
                  } else if (["STOPPED", "CANCELLED", "SHORT_CLOSED"].includes(viewPlan.status)) {
                    isCompleted = stepNum < currentStep;
                  }

                  const badgeColors = isCompleted
                    ? "bg-card text-[color:var(--color-success)] border-[color:var(--color-success)]"
                    : isActive
                      ? "bg-card text-accent border-accent"
                      : "bg-card-2 text-ink-subtle border-line";

                  const dotColors = isCompleted
                    ? "bg-[color:var(--color-success)] text-[color:var(--color-card)]"
                    : isActive
                      ? "bg-accent text-[color:var(--color-on-primary)]"
                      : "bg-line text-ink-subtle";

                  return (
                    <React.Fragment key={step.id || idx}>
                      <span
                        className={`px-3 py-1.5 font-semibold text-sm rounded-[14px] border flex items-center gap-2 ${badgeColors}`}
                      >
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold ${dotColors}`}
                        >
                          {step.stepOrder || stepNum}
                        </span>
                        {step.stepKey}
                      </span>
                      {idx < viewPlan.productionOrder.productItem.productionSteps.length - 1 && (
                        <ArrowRight size={14} className="text-ink-subtle" aria-hidden="true" />
                      )}
                    </React.Fragment>
                  );
                }
              )}
            </div>
          </div>
        )}

        {/* ── Hourly Production Logs ── */}
        <div>
          <h6 className="sl-section-label m-0 mb-3">Hourly Production Entries</h6>
          {loadingViewLogs ? (
            <div className="flex items-center justify-center gap-2 py-8 rounded-[16px] bg-card-2 text-ink-subtle text-sm">
              <div className="w-5 h-5 border-2 border-line border-t-transparent rounded-full motion-safe:animate-spin" />
              Loading entries...
            </div>
          ) : viewHourlyLogs.length > 0 ? (
            <div className="rounded-[16px] border border-line-soft overflow-hidden">
              <DataTable
                columns={[
                  {
                    header: "Hour",
                    align: "center",
                    render: (h: any) => (
                      <span className="font-bold font-mono text-ink-muted text-sm">
                        H{h.hourIndex}
                      </span>
                    ),
                  },
                  {
                    header: "Produced",
                    align: "center",
                    render: (h: any) => (
                      <span className="font-bold text-[color:var(--color-success)] text-base">
                        {h.qtyProduced}
                      </span>
                    ),
                  },
                  {
                    header: "Reject",
                    align: "center",
                    render: (h: any) => (
                      <span className="text-[color:var(--color-danger)] text-sm">
                        {h.rejectQty || 0}
                      </span>
                    ),
                  },
                  {
                    header: "Scrap",
                    align: "center",
                    render: (h: any) => (
                      <span className="text-[color:var(--color-warning)] text-sm">
                        {h.scrapQty || 0}
                      </span>
                    ),
                  },
                  {
                    header: "Downtime",
                    align: "center",
                    render: (h: any) => (
                      <span className="text-ink-subtle text-sm">
                        {h.downtime > 0 ? `${h.downtime} min` : "—"}
                      </span>
                    ),
                  },
                  {
                    header: "Avail%",
                    align: "center",
                    render: (h: any) => (
                      <span className="font-semibold text-[color:var(--color-success)] text-sm">
                        {h.availabilityPct !== undefined ? `${h.availabilityPct}%` : "—"}
                      </span>
                    ),
                  },
                  {
                    header: "Qual%",
                    align: "center",
                    render: (h: any) => (
                      <span className="font-semibold text-ink text-sm">
                        {h.qualityPct !== undefined ? `${h.qualityPct}%` : "—"}
                      </span>
                    ),
                  },
                  {
                    header: "OEE%",
                    align: "center",
                    render: (h: any) => (
                      <span className="font-extrabold text-accent text-sm">
                        {h.hourlyOEE !== undefined ? `${h.hourlyOEE}%` : "—"}
                      </span>
                    ),
                  },
                  {
                    header: "Operator",
                    render: (h: any) => (
                      <span
                        className="text-ink-muted font-medium text-sm truncate max-w-[120px] inline-block"
                        title={h.operatorName || h.operatorId}
                      >
                        {h.operatorName || h.operatorId || "—"}
                      </span>
                    ),
                  },
                ]}
                data={viewHourlyLogs}
                rowKey={(h: any) => h.hourlyProductionId}
                minHeightClassName="min-h-0"
              />
              {/* Totals Footer */}
              <div className="bg-card-2 px-4 py-3 border-t border-line space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3 font-bold">
                  <span className="text-ink-subtle text-xs uppercase tracking-wider">Totals:</span>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span className="text-[color:var(--color-success)]">
                      ✓ Produced:{" "}
                      {viewHourlyLogs.reduce(
                        (s: any, h: any) =>
                          s +
                          Math.max(
                            0,
                            Number(h.qtyProduced || 0) -
                              Number(h.rejectQty || 0) -
                              Number(h.scrapQty || 0)
                          ),
                        0
                      )}
                    </span>
                    <span className="text-[color:var(--color-danger)]">
                      ✕ Reject:{" "}
                      {viewHourlyLogs.reduce((s: any, h: any) => s + Number(h.rejectQty || 0), 0)}
                    </span>
                    <span className="text-[color:var(--color-warning)]">
                      ⚠ Scrap:{" "}
                      {viewHourlyLogs.reduce((s: any, h: any) => s + Number(h.scrapQty || 0), 0)}
                    </span>
                    <span className="text-ink-subtle">
                      ↓ Downtime:{" "}
                      {(() => {
                        const t = viewHourlyLogs.reduce(
                          (s: any, h: any) => s + Number(h.downtime || 0),
                          0
                        );
                        return t > 0 ? `${t} min` : "—";
                      })()}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm pt-2 border-t border-line border-dashed">
                  <div className="flex gap-5 font-bold">
                    <span className="text-ink-muted">
                      Total Produced:{" "}
                      <span className="text-[color:var(--color-success)] ml-1">
                        {viewPlanOeeSummary?.goodQty ??
                          viewHourlyLogs.reduce(
                            (s: any, h: any) =>
                              s +
                              Math.max(
                                0,
                                Number(h.qtyProduced || 0) -
                                  Number(h.rejectQty || 0) -
                                  Number(h.scrapQty || 0)
                              ),
                            0
                          )}{" "}
                        pcs
                      </span>
                    </span>
                    <span className="text-ink-muted">
                      Pending:{" "}
                      <span className="text-[color:var(--color-warning)] ml-1">
                        {Math.max(
                          0,
                          Number(viewPlan?.plannedQty) -
                            (viewPlanOeeSummary?.goodQty ??
                              viewHourlyLogs.reduce(
                                (s: any, h: any) =>
                                  s +
                                  Math.max(
                                    0,
                                    Number(h.qtyProduced || 0) -
                                      Number(h.rejectQty || 0) -
                                      Number(h.scrapQty || 0)
                                  ),
                                0
                              ))
                        )}{" "}
                        pcs
                      </span>
                    </span>
                  </div>
                  {viewPlan?.carryForwardTo && viewPlan.carryForwardTo.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-ink-subtle uppercase tracking-wider text-xs">
                        Carried Forward To:
                      </span>
                      <span className="sl-chip">
                        <Share2 size={13} aria-hidden="true" />
                        {viewPlan.carryForwardTo[0].dailyPlanId}
                        <span className="ml-1 font-normal opacity-80">
                          ({viewPlan.carryForwardTo[0].productionDate?.split("T")[0]})
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 rounded-[16px] bg-card-2 text-center">
              <ClipboardList className="text-ink-subtle mb-3" size={32} />
              <span className="text-ink-subtle font-medium text-sm">
                No hourly entries recorded yet for this plan.
              </span>
            </div>
          )}
        </div>

        {/* ── Daily Target vs Actual Comparison ── */}
        {viewHourlyLogs.length > 0 && (
          <div>
            <h6 className="sl-section-label m-0 mb-3">Target vs Actual Comparison</h6>
            <div className="rounded-[16px] border border-line-soft overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-card-2 border-b border-line">
                    {[
                      "Machine",
                      "Product",
                      "Capacity",
                      "Produced",
                      "Pending",
                      "Efficiency",
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className={`px-4 py-2.5 text-xs font-bold text-ink-subtle uppercase tracking-wider ${["Capacity", "Produced", "Pending", "Efficiency", "Status"].includes(h) ? "text-center" : "text-left"}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(() => {
                    const capacity = Number(viewPlan?.plannedQty || 0);
                    const totalProduced = Array.isArray(viewPlan?.hourlyProductions)
                      ? viewPlan.hourlyProductions.reduce(
                          (s: number, h: any) =>
                            s +
                            Math.max(
                              0,
                              Number(h.qtyProduced || 0) -
                                Number(h.rejectQty || 0) -
                                Number(h.scrapQty || 0)
                            ),
                          0
                        )
                      : 0;
                    const pending = Math.max(0, capacity - totalProduced);
                    const efficiency =
                      capacity > 0 ? ((totalProduced / capacity) * 100).toFixed(0) : "0";
                    const shortfallPct =
                      capacity > 0 ? ((capacity - totalProduced) / capacity) * 100 : 0;
                    const statusText =
                      shortfallPct <= 0 ? "Highest" : shortfallPct <= 15 ? "Medium" : "Low";
                    const customColor =
                      shortfallPct <= 0
                        ? {
                            bg: "color-mix(in srgb, var(--color-success) 15%, transparent)",
                            text: "var(--color-success)",
                          }
                        : shortfallPct <= 15
                          ? { bg: "var(--color-card-2)", text: "var(--color-ink-muted)" }
                          : {
                              bg: "color-mix(in srgb, var(--color-warning) 15%, transparent)",
                              text: "var(--color-warning)",
                            };

                    return (
                      <tr>
                        <td className="px-4 py-3 text-ink-muted font-medium">
                          {viewPlan?.machine?.machineName || viewPlan?.machineId || "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">
                          {viewPlan?.productionOrder?.productItem?.productName || "—"}
                        </td>
                        <td className="px-4 py-3 text-center text-ink font-bold">{capacity}</td>
                        <td className="px-4 py-3 text-center text-[color:var(--color-success)] font-bold">
                          {totalProduced}
                        </td>
                        <td className="px-4 py-3 text-center text-[color:var(--color-warning)] font-bold">
                          {pending}
                        </td>
                        <td className="px-4 py-3 text-center text-accent font-bold">
                          {efficiency}%
                        </td>
                        <td className="px-4 py-3 text-center">
                          <StatusBadge
                            status="CUSTOM"
                            customText={statusText}
                            customColor={customColor}
                          />
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Production Order History ── */}
        <div className="border border-line-soft rounded-[12px] overflow-hidden">
          <div className="px-4 py-3 bg-card-2 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ClipboardList className="text-ink-subtle" size={14} />
              <h3 className="font-bold text-ink text-sm m-0">Production Order History</h3>
              <span className="text-xs text-ink-subtle font-mono bg-card px-2 py-0.5 rounded border border-line">
                {viewPlan?.productionOrderId}
              </span>
            </div>
            {!loadingPOHistory && (
              <span className="text-xs text-ink-subtle bg-card px-2.5 py-0.5 rounded font-medium border border-line">
                {poHistoryPlans.length} plan{poHistoryPlans.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {loadingPOHistory ? (
            <div className="flex items-center justify-center gap-2 py-7 bg-card-2 text-ink-subtle text-sm">
              <div className="w-4 h-4 border-2 border-line border-t-transparent rounded-full motion-safe:animate-spin" />
              Loading history...
            </div>
          ) : poHistoryPlans.length > 0 ? (
            <div className="flex flex-col">
              <DataTable
                columns={poHistoryColumns}
                data={poHistoryPlans}
                rowKey={(row) => row.dailyPlanId}
                emptyMessage="No records found."
                minHeightClassName="min-h-0"
                density="compact"
                rowClassName={(row) =>
                  row.dailyPlanId === viewPlan?.dailyPlanId ? "bg-nav-active" : ""
                }
              />
              <div className="flex items-center justify-between bg-card-2 border-t border-line px-4 py-3">
                <div className="text-sm font-bold text-ink-muted">Total</div>
                <div className="flex gap-8 md:gap-16 items-center pr-10">
                  <div className="text-sm font-bold text-ink">
                    Planned:{" "}
                    {poHistoryPlans
                      .reduce((s: number, p: any) => s + Number(p.plannedQty || 0), 0)
                      .toLocaleString("en-IN")}
                  </div>
                  <div className="text-sm font-bold text-[color:var(--color-success)]">
                    Produced:{" "}
                    {poHistoryPlans
                      .reduce((s: number, p: any) => {
                        const produced = Array.isArray(p.hourlyProductions)
                          ? p.hourlyProductions.reduce(
                              (ss: number, h: any) =>
                                ss +
                                Math.max(
                                  0,
                                  Number(h.qtyProduced || 0) -
                                    Number(h.rejectQty || 0) -
                                    Number(h.scrapQty || 0)
                                ),
                              0
                            )
                          : 0;
                        return s + produced;
                      }, 0)
                      .toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 bg-card-2 text-center">
              <CalendarDays className="text-ink-subtle mb-2.5" size={28} />
              <span className="text-ink-subtle font-medium text-sm">
                No other daily plans found for this production order.
              </span>
            </div>
          )}
        </div>
      </div>
    </CommonModal>
  );
};

export default DailyPlanViewModal;
