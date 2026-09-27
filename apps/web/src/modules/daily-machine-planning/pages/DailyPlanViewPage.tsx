import React, { useEffect, useState, useMemo, useCallback } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  PackageOpen,
  Share2,
  Truck,
} from "lucide-react";
import {
  Chip,
  EmptyState,
  PageHeader,
  Skeleton,
  SkeletonRows,
  SkeletonTile,
  Tile,
  cx,
  type ChipTone,
} from "../../../components/ui/v2";
import { Figure, InfoItem, PageBody, ProgressBar, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";
import { useNavigate, useLocation, useParams } from "react-router-dom";

import apiClient from "../../../api/apiClient";
import config from "../../../api/config";
import { oeeService } from "../../../services/oeeService";
import { weeklyProgramService } from "../../../services/weeklyProgramService";
import { dailyPlanService } from "../../../services/dailyPlanService";
import { productCapacityHistoryService } from "../../../services/productCapacityHistoryService";
import { useSocketSync } from "../../../hooks/useSocketSync";

import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";

const DailyPlanViewPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();

  // Fetch passed plan from location state or fallback to ID
  const [viewPlan, setViewPlan] = useState<any>(location.state?.plan || { dailyPlanId: id });

  const [loadingWeekly, setLoadingWeekly] = useState(false);
  const [weeklyProgram, setWeeklyProgram] = useState<any>(null);
  const [loadingViewLogs, setLoadingViewLogs] = useState(false);
  const [viewHourlyLogs, setViewHourlyLogs] = useState<any[]>([]);
  const [viewPlanOeeSummary, setViewPlanOeeSummary] = useState<any>(null);
  const [loadingPOHistory, setLoadingPOHistory] = useState(false);
  const [poHistoryPlans, setPOHistoryPlans] = useState<any[]>([]);
  const [machineProductCapacity, setMachineProductCapacity] = useState<number | null>(null);

  const fetchAllData = useCallback(async () => {
    if (!viewPlan?.productionOrderId && !viewPlan?.dailyPlanId) return;
    let currentPlan = viewPlan;

    // If we only have ID (from direct link), fetch the full plan first
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
        .then((rec: any) => {
          if (rec && rec.newCapacity != null) setMachineProductCapacity(Number(rec.newCapacity));
          else setMachineProductCapacity(null);
        })
        .catch(() => setMachineProductCapacity(null));
    } else {
      setMachineProductCapacity(null);
    }
  }, [viewPlan?.dailyPlanId, viewPlan?.productionOrderId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useSocketSync("dailyPlan", undefined, fetchAllData);
  useSocketSync("hourlyProduction", undefined, fetchAllData);

  const handleLogHourly = (plan: any) => {
    navigate("/hourly-work-reports/create", {
      state: {
        dailyPlanId: plan.dailyPlanId,
        productionOrderId: plan.productionOrderId,
        machineId: plan.machineId,
        shiftId: plan.shiftId,
        productionDate: plan.productionDate,
        weeklyProgramId: plan.weeklyProgramId,
      },
    });
  };

  const handleBack = () => {
    navigate(-1);
  };

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
  // Net PO produced = sum of (qtyProduced - rejectQty - scrapQty) across ALL plans for this PO
  const netPoProduced =
    poHistoryPlans.length > 0
      ? poHistoryPlans.reduce(
          (total: number, p: any) =>
            total +
            (Array.isArray(p.hourlyProductions)
              ? p.hourlyProductions.reduce(
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
              : 0),
          0
        )
      : null;
  // Use goodQty (net: producedQty − rejectQty − scrapQty) from OEE summary when available
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
              {isCurrent && (
                <Chip size="sm" className="ml-1.5">
                  Current
                </Chip>
              )}
            </span>
          );
        },
      },
      {
        header: "Date",
        render: (plan: any) => (
          <span className="text-xs text-ink-muted">
            {plan.productionDate ? formatDate(plan.productionDate) : "—"}
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
          <Chip size="sm">{plan.shift?.shiftName || plan.shiftId || "—"}</Chip>
        ),
      },
      {
        header: "Planned",
        align: "center",
        render: (plan: any) => (
          <span className="text-xs font-semibold text-ink-muted tabular-nums">
            {formatQty(plan.plannedQty || 0)}
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
              className={`text-xs font-bold tabular-nums ${producedQty >= Number(plan.plannedQty || 0) ? "text-[color:var(--color-success)]" : producedQty > 0 ? "text-[color:var(--color-warning)]" : "text-ink-subtle"}`}
            >
              {formatQty(producedQty)}
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

  const crumbs = [
    { label: "Daily planning", to: "/daily-machine-planning" },
    { label: viewPlan?.dailyPlanId || "Plan" },
  ];

  if (!viewPlan || !viewPlan.productionOrderId) {
    return (
      <PageBody>
        <PageHeader title="Daily Plan" back={() => navigate(-1)} breadcrumbs={crumbs} />
        <SkeletonTile lines={3} label="Loading..." />
        <SkeletonTile lines={5} />
      </PageBody>
    );
  }

  const netProducedThisPlan = viewHourlyLogs.reduce(
    (s: any, h: any) =>
      s +
      Math.max(0, Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)),
    0
  );
  const rejectTotal = viewHourlyLogs.reduce((s: any, h: any) => s + Number(h.rejectQty || 0), 0);
  const scrapTotal = viewHourlyLogs.reduce((s: any, h: any) => s + Number(h.scrapQty || 0), 0);
  const downtimeTotal = viewHourlyLogs.reduce((s: any, h: any) => s + Number(h.downtime || 0), 0);

  // Target vs actual
  const capacity = Number(viewPlan.plannedQty || 0);
  const totalProducedForPlan = Array.isArray(viewPlan.hourlyProductions)
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
  const pendingForPlan = Math.max(0, capacity - totalProducedForPlan);
  const efficiency = capacity > 0 ? ((totalProducedForPlan / capacity) * 100).toFixed(0) : "0";
  const shortfallPct = capacity > 0 ? ((capacity - totalProducedForPlan) / capacity) * 100 : 0;
  const efficiencyBand: { label: string; tone: ChipTone } =
    shortfallPct <= 0
      ? { label: "Highest", tone: "success" }
      : shortfallPct <= 15
        ? { label: "Medium", tone: "muted" }
        : { label: "Low", tone: "warning" };

  return (
    <PageBody>
      <PageHeader
        title={`Daily Plan — ${viewPlan.dailyPlanId}`}
        meta={<StatusBadge status={viewPlan.status} />}
        subtitle={`${viewPlan.productionDate ? formatDate(viewPlan.productionDate) : "—"} · ${viewPlan.machine?.machineName || viewPlan.machineId} · ${viewPlan.shift?.shiftName || viewPlan.shiftId}`}
        back={() => navigate(-1)}
        breadcrumbs={crumbs}
      />

      {/* ── Summary ── */}
      <Tile>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <InfoItem label="Production Order" value={viewPlan.productionOrderId} mono />
          <InfoItem
            label="Product"
            value={viewPlan.productionOrder?.productItem?.productName || "—"}
          />
          <InfoItem
            label="Priority"
            value={<StatusBadge status={viewPlan.priority || "MEDIUM"} />}
          />
          <InfoItem label="Planned Hours" value={`${viewPlan.plannedHours || "—"} hrs`} />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 rounded-[16px] bg-card-2 p-4">
          <Figure size="lg" label="Planned Qty" value={formatQty(viewPlan.plannedQty)} hint="pcs" />
          <Figure
            size="lg"
            label="Produced"
            tone="success"
            value={formatQty(totalProducedForPlan)}
            hint="pcs, net of reject & scrap"
          />
          <Figure
            size="lg"
            label="Pending"
            tone={pendingForPlan > 0 ? "warning" : "default"}
            value={formatQty(pendingForPlan)}
            hint="pcs"
          />
        </div>
        {viewPlan.remarks && (
          <p className="m-0 mt-4 text-sm leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">Remarks: </span>
            {viewPlan.remarks}
          </p>
        )}
      </Tile>

      {/* ── Weekly Production Target Progress ── */}
      {viewPlan.weeklyProgramId && (
        <Tile
          title="Weekly Target Progress"
          icon={<BarChart3 size={18} />}
          actions={
            <Chip size="sm" tone="muted" className="font-mono">
              {viewPlan.weeklyProgramId}
            </Chip>
          }
        >
          {loadingWeekly ? (
            <div className="flex flex-col gap-2" role="status">
              <span className="sr-only">Loading weekly data...</span>
              <Skeleton height={12} width="50%" />
              <Skeleton height={10} />
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">Production Order Target</span>
                  <span className="flex items-center gap-2 text-sm text-ink-muted tabular-nums">
                    {formatQty(weeklyOrderProducedQty)} / {formatQty(weeklyOrderTargetQty)} pcs
                    <Chip
                      size="sm"
                      tone={
                        weeklyOrderPct >= 100
                          ? "success"
                          : weeklyOrderPct >= 50
                            ? "muted"
                            : "warning"
                      }
                    >
                      {weeklyOrderPct}%
                    </Chip>
                  </span>
                </div>
                <ProgressBar pct={weeklyOrderPct} low="warning" />
                <div className="mt-1.5 flex justify-between text-xs text-ink-subtle">
                  <span>
                    Produced:{" "}
                    <strong className="text-[color:var(--color-success)]">
                      {formatQty(weeklyOrderProducedQty)}
                    </strong>
                  </span>
                  <span>
                    Remaining:{" "}
                    <strong className="text-[color:var(--color-warning)]">
                      {formatQty(Math.max(0, weeklyOrderTargetQty - weeklyOrderProducedQty))}
                    </strong>
                  </span>
                </div>
              </div>

              {weeklyTargetQty > 0 && (
                <div className="border-t border-line-soft pt-4">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">Weekly Program Target</span>
                    <span className="flex items-center gap-2 text-sm text-ink-muted tabular-nums">
                      {formatQty(weeklyOrderProducedQty)} / {formatQty(weeklyTargetQty)} pcs
                      <Chip
                        size="sm"
                        tone={
                          weeklyProgramPct >= 100
                            ? "success"
                            : weeklyProgramPct >= 50
                              ? "muted"
                              : "danger"
                        }
                      >
                        {weeklyProgramPct}%
                      </Chip>
                    </span>
                  </div>
                  <ProgressBar pct={weeklyProgramPct} low="danger" />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {weeklyOrderPct >= 100 ? (
                  <Chip tone="success" icon={<CheckCircle2 size={14} />}>
                    Weekly Target Complete!
                  </Chip>
                ) : (
                  <Chip tone="warning" icon={<PackageOpen size={14} />}>
                    {formatQty(Math.max(0, weeklyOrderTargetQty - weeklyOrderProducedQty))} pcs
                    remaining to complete
                  </Chip>
                )}
                {viewPlan.productionOrder?.status === "COMPLETED" && (
                  <Chip tone="info" icon={<Truck size={14} />}>
                    Ready for Dispatch
                  </Chip>
                )}
              </div>
            </div>
          )}
        </Tile>
      )}

      {/* ── Post Production Steps ── */}
      {viewPlan.productionOrder?.productItem?.productionSteps?.length > 0 && (
        <Tile title="Post Production Steps">
          <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
            {viewPlan.productionOrder.productItem.productionSteps.map((step: any, idx: number) => {
              const stepNum = idx + 1;
              const currentStep = viewPlan.currentStepIndex || 1;
              let isCompleted = false;
              let isActive = false;

              if (viewPlan.status === "COMPLETED" || viewPlan.status === "READY_FOR_DISPATCH") {
                isCompleted = true;
              } else if (viewPlan.status === "POST_PRODUCTION") {
                isCompleted = stepNum < currentStep;
                isActive = stepNum === currentStep;
              } else if (
                viewPlan.status === "STOPPED" ||
                viewPlan.status === "CANCELLED" ||
                viewPlan.status === "SHORT_CLOSED"
              ) {
                isCompleted = stepNum < currentStep;
              }

              return (
                <li key={step.id || idx} className="flex items-center gap-2">
                  <span
                    className={cx(
                      "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm font-semibold",
                      isCompleted
                        ? "bg-card-2 text-[color:var(--color-success)]"
                        : isActive
                          ? "bg-nav-active text-nav-active-fg"
                          : "bg-card-2 text-ink-subtle"
                    )}
                    aria-current={isActive ? "step" : undefined}
                  >
                    <span
                      className={cx(
                        "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                        isCompleted
                          ? "bg-card text-[color:var(--color-success)]"
                          : isActive
                            ? "bg-accent text-[color:var(--color-on-primary)]"
                            : "bg-card text-ink-subtle"
                      )}
                    >
                      {isCompleted ? (
                        <Check size={13} aria-label="Done" />
                      ) : (
                        step.stepOrder || stepNum
                      )}
                    </span>
                    {step.stepKey}
                  </span>
                  {idx < viewPlan.productionOrder.productItem.productionSteps.length - 1 && (
                    <ArrowRight size={14} className="text-ink-subtle" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ol>
        </Tile>
      )}

      {/* ── Hourly Production Logs ── */}
      <Tile
        padding="none"
        divider
        title="Hourly Production Entries"
        icon={<ClipboardList size={18} />}
      >
        {loadingViewLogs ? (
          <SkeletonRows rows={4} columns={6} label="Loading entries..." />
        ) : viewHourlyLogs.length > 0 ? (
          <>
            <DataTable
              ariaLabel="Hourly production entries"
              className="!rounded-none !shadow-none"
              columns={[
                {
                  header: "Hour",
                  align: "center",
                  render: (h: any) => (
                    <Chip size="sm" className="tabular-nums">
                      H{h.hourIndex}
                    </Chip>
                  ),
                },
                {
                  header: "Produced",
                  align: "right",
                  render: (h: any) => (
                    <span className="text-base font-bold text-ink tabular-nums">
                      {formatQty(h.qtyProduced)}
                    </span>
                  ),
                },
                {
                  header: "Reject",
                  align: "right",
                  render: (h: any) => (
                    <span
                      className={cx(
                        "text-sm tabular-nums",
                        h.rejectQty > 0
                          ? "font-semibold text-[color:var(--color-danger)]"
                          : "text-ink-subtle"
                      )}
                    >
                      {h.rejectQty || 0}
                    </span>
                  ),
                },
                {
                  header: "Scrap",
                  align: "right",
                  render: (h: any) => (
                    <span
                      className={cx(
                        "text-sm tabular-nums",
                        h.scrapQty > 0
                          ? "font-semibold text-[color:var(--color-warning)]"
                          : "text-ink-subtle"
                      )}
                    >
                      {h.scrapQty || 0}
                    </span>
                  ),
                },
                {
                  header: "Downtime",
                  align: "right",
                  render: (h: any) => (
                    <span className="text-sm text-ink-muted tabular-nums">
                      {h.downtime > 0 ? `${h.downtime} min` : "—"}
                    </span>
                  ),
                },
                {
                  header: "Avail%",
                  align: "right",
                  render: (h: any) => (
                    <span className="text-sm text-ink tabular-nums">
                      {h.availabilityPct !== undefined ? `${h.availabilityPct}%` : "—"}
                    </span>
                  ),
                },
                {
                  header: "Qual%",
                  align: "right",
                  render: (h: any) => (
                    <span className="text-sm text-ink tabular-nums">
                      {h.qualityPct !== undefined ? `${h.qualityPct}%` : "—"}
                    </span>
                  ),
                },
                {
                  header: "OEE%",
                  align: "right",
                  render: (h: any) => (
                    <span className="text-sm font-bold text-accent tabular-nums">
                      {h.hourlyOEE !== undefined ? `${h.hourlyOEE}%` : "—"}
                    </span>
                  ),
                },
                {
                  header: "Operator",
                  render: (h: any) => (
                    <span
                      className="inline-block max-w-[150px] truncate text-sm font-medium text-ink-muted"
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
            {/* Totals */}
            <div className="border-t border-line-soft bg-card-2 p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Figure
                  label="Produced (net)"
                  tone="success"
                  value={formatQty(netProducedThisPlan)}
                />
                <Figure
                  label="Reject"
                  tone={rejectTotal > 0 ? "danger" : "default"}
                  value={formatQty(rejectTotal)}
                />
                <Figure
                  label="Scrap"
                  tone={scrapTotal > 0 ? "warning" : "default"}
                  value={formatQty(scrapTotal)}
                />
                <Figure label="Downtime" value={downtimeTotal > 0 ? `${downtimeTotal} min` : "—"} />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3 text-sm">
                <div className="flex flex-wrap gap-5 font-semibold text-ink-muted">
                  <span>
                    Total Produced:{" "}
                    <span className="text-[color:var(--color-success)] tabular-nums">
                      {formatQty(weeklyOrderProducedQty)} pcs
                    </span>
                  </span>
                  <span>
                    Pending:{" "}
                    <span className="text-[color:var(--color-warning)] tabular-nums">
                      {formatQty(Math.max(0, weeklyOrderTargetQty - weeklyOrderProducedQty))} pcs
                    </span>
                  </span>
                </div>
                {viewPlan.carryForwardTo && viewPlan.carryForwardTo.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="sl-section-label">Carried Forward To</span>
                    <Chip icon={<Share2 size={13} />}>
                      {viewPlan.carryForwardTo[0].dailyPlanId}
                      <span className="font-normal opacity-80">
                        (
                        {viewPlan.carryForwardTo[0].productionDate
                          ? formatDate(viewPlan.carryForwardTo[0].productionDate)
                          : "—"}
                        )
                      </span>
                    </Chip>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            compact
            icon={<ClipboardList size={22} />}
            title="No hourly entries recorded yet for this plan."
          />
        )}
      </Tile>

      {/* ── Daily Target vs Actual Comparison ── */}
      {viewHourlyLogs.length > 0 && (
        <Tile padding="none" divider title="Target vs Actual Comparison">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Target vs actual">
              <thead>
                <tr className="border-b border-line-soft bg-card-2">
                  {[
                    "Machine",
                    "Product",
                    "Capacity",
                    "Produced",
                    "Pending",
                    "Efficiency",
                    "Status",
                  ].map((h, i) => (
                    <th
                      key={h}
                      scope="col"
                      className={cx(
                        "sl-th px-5 py-3",
                        i >= 2 && i <= 5 ? "text-right" : "text-left"
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-5 py-4 font-medium text-ink">
                    {viewPlan.machine?.machineName || viewPlan.machineId || "—"}
                  </td>
                  <td className="px-5 py-4 text-ink-muted">
                    {viewPlan.productionOrder?.productItem?.productName || "—"}
                  </td>
                  <td className="px-5 py-4 text-right text-base font-bold text-ink tabular-nums">
                    {formatQty(capacity)}
                  </td>
                  <td className="px-5 py-4 text-right text-base font-bold text-[color:var(--color-success)] tabular-nums">
                    {formatQty(totalProducedForPlan)}
                  </td>
                  <td className="px-5 py-4 text-right text-base font-bold text-[color:var(--color-warning)] tabular-nums">
                    {formatQty(pendingForPlan)}
                  </td>
                  <td className="px-5 py-4 text-right text-base font-bold text-accent tabular-nums">
                    {efficiency}%
                  </td>
                  <td className="px-5 py-4">
                    <Chip size="sm" dot tone={efficiencyBand.tone}>
                      {efficiencyBand.label}
                    </Chip>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Tile>
      )}

      {/* ── Production Order History ── */}
      <Tile
        padding="none"
        divider
        title="Production Order History"
        icon={<CalendarDays size={18} />}
        actions={
          <>
            <Chip size="sm" tone="muted" className="font-mono">
              {viewPlan.productionOrderId}
            </Chip>
            {!loadingPOHistory && (
              <Chip size="sm">
                {poHistoryPlans.length} plan{poHistoryPlans.length !== 1 ? "s" : ""}
              </Chip>
            )}
          </>
        }
      >
        {loadingPOHistory ? (
          <SkeletonRows rows={3} columns={6} label="Loading history..." />
        ) : poHistoryPlans.length > 0 ? (
          <div className="flex flex-col">
            <DataTable
              ariaLabel="Daily plans of this production order"
              className="!rounded-none !shadow-none"
              columns={poHistoryColumns}
              data={poHistoryPlans}
              rowKey={(row) => row.dailyPlanId}
              emptyMessage="No records found."
              minHeightClassName="min-h-0"
              density="compact"
              rowClassName={(row) =>
                row.dailyPlanId === viewPlan.dailyPlanId ? "bg-nav-active" : ""
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-card-2 px-5 py-4">
              <div className="text-sm font-bold text-ink-muted">Total</div>
              <div className="flex flex-wrap items-center gap-6 text-sm font-bold tabular-nums">
                <span className="text-ink">
                  Planned:{" "}
                  {formatQty(
                    poHistoryPlans.reduce((s: number, p: any) => s + Number(p.plannedQty || 0), 0)
                  )}
                </span>
                <span className="text-[color:var(--color-success)]">
                  Produced: {formatQty(weeklyOrderProducedQty)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            compact
            icon={<CalendarDays size={22} />}
            title="No other daily plans found for this production order."
          />
        )}
      </Tile>
    </PageBody>
  );
};

export default DailyPlanViewPage;
