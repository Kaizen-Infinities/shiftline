import React, { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  LuCalendarDays,
  LuCalendarRange,
  LuCalendar,
  LuClock,
  LuCog,
  LuGauge,
  LuPlus,
  LuTriangleAlert,
  LuFactory,
} from "react-icons/lu";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchProductionOrders } from "../../../features/production-orders/productionOrderSlice";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { usePermission } from "../../../hooks/usePermission";
import { DashTile, TileHeader, EmptyState, SkeletonRows } from "../components/DashboardPrimitives";

/* ════════════════════════════════════════════════════════════════
   PRODUCTION DASHBOARD (UI v2)
   Output against target for today, the week and the month; factory OEE;
   machine status; machine-wise OEE; and output per shift. A figure with
   no data behind it shows "—" and says why — never a placeholder number.
   ════════════════════════════════════════════════════════════════ */

type Pct = number | null;

const pctLabel = (v: Pct) => (v == null ? "—" : `${v.toFixed(1)}%`);
const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** Threshold colour for an OEE-style percentage, as a CSS colour token. */
const toneVar = (v: Pct) =>
  v == null
    ? "var(--color-line)"
    : v > 85
      ? "var(--color-success)"
      : v > 60
        ? "var(--color-warning)"
        : "var(--color-danger)";

const readDowntime = (productionOrderId: string | number | undefined) => {
  if (productionOrderId == null) return 0;
  try {
    const stored = localStorage.getItem(`downtime_${productionOrderId}`);
    if (!stored) return 0;
    const logs = JSON.parse(stored);
    return Array.isArray(logs)
      ? logs.reduce((sum: number, l: any) => sum + (Number(l.durationMinutes) || 0), 0)
      : 0;
  } catch {
    return 0;
  }
};

const Meter: React.FC<{ value: number; color: string; label: string; height?: string }> = ({
  value,
  color,
  label,
  height = "h-2",
}) => (
  <div
    role="meter"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value)}
    className={`${height} w-full overflow-hidden rounded-full bg-line-soft`}
  >
    <div
      className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
      style={{ width: `${clampPct(value)}%`, backgroundColor: color }}
    />
  </div>
);

const ProductionDashboard: React.FC = () => {
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const { data: productionOrders, loading: loadingOrders } = useAppSelector(
    (state) => state.productionOrders
  );
  const { data: machines, loading: loadingMachines } = useAppSelector((state) => state.machines);

  useEffect(() => {
    dispatch(fetchProductionOrders());
    dispatch(fetchMachines());
  }, [dispatch]);

  // Real-time: cards refresh when orders or hourly output change.
  useSocketSync("productionOrder", undefined, () => dispatch(fetchProductionOrders()));
  useSocketSync("hourlyProduction", undefined, () => dispatch(fetchProductionOrders()));

  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const t = {
      todayTarget: 0,
      todayProduced: 0,
      weekTarget: 0,
      weekProduced: 0,
      monthTarget: 0,
      monthProduced: 0,
      monthRejected: 0,
      monthScrap: 0,
    };
    const runningMachineIds = new Set<string>();
    const stoppedMachineIds = new Set<string>();

    productionOrders.forEach((po) => {
      const orderQty = Number(po.targetQty) || 0;
      const producedQty = Number(po.producedQty) || 0;
      if (po.status === "IN PROGRESS") runningMachineIds.add((po as any).machineId);
      if (po.status === "CANCELLED") stoppedMachineIds.add((po as any).machineId);
      if (!po.orderDate) return;
      const d = new Date(po.orderDate);
      if (d.toISOString().split("T")[0] === todayStr) {
        t.todayTarget += orderQty;
        t.todayProduced += producedQty;
      }
      if (d >= startOfWeek) {
        t.weekTarget += orderQty;
        t.weekProduced += producedQty;
      }
      if (d >= startOfMonth) {
        t.monthTarget += orderQty;
        t.monthProduced += producedQty;
        t.monthRejected += Number(po.rejectedQty) || 0;
        t.monthScrap += Number(po.scrapQty) || 0;
      }
    });

    // OEE = availability × performance × quality, each only when it has a basis.
    const active = productionOrders.filter(
      (po) => po.status === "IN PROGRESS" || po.status === "COMPLETED"
    );
    const totalDowntime = active.reduce((s, po) => s + readDowntime(po.productionOrderId), 0);
    const plannedMinutes = active.length * 8 * 60;
    const availability: Pct =
      plannedMinutes > 0
        ? clampPct((Math.max(0, plannedMinutes - totalDowntime) / plannedMinutes) * 100)
        : null;
    const performance: Pct =
      t.monthTarget > 0 ? clampPct((t.monthProduced / t.monthTarget) * 100) : null;
    const quality: Pct =
      t.monthProduced > 0
        ? clampPct(((t.monthProduced - t.monthRejected) / t.monthProduced) * 100)
        : null;
    const oee: Pct =
      availability != null && performance != null && quality != null
        ? (availability / 100) * (performance / 100) * (quality / 100) * 100
        : null;

    return { ...t, runningMachineIds, stoppedMachineIds, availability, performance, quality, oee };
  }, [productionOrders]);

  const machineRows = useMemo(
    () =>
      machines.map((m) => {
        const mOrders = productionOrders.filter((po) => (po as any).machineId === m.machineId);
        const produced = mOrders.reduce((s, po) => s + (Number(po.producedQty) || 0), 0);
        const target = mOrders.reduce((s, po) => s + (Number(po.targetQty) || 0), 0);
        const rejected = mOrders.reduce((s, po) => s + (Number(po.rejectedQty) || 0), 0);
        const downtime = mOrders.reduce((s, po) => s + readDowntime(po.productionOrderId), 0);
        const activeCount = mOrders.filter(
          (po) => po.status === "IN PROGRESS" || po.status === "COMPLETED"
        ).length;
        const planned = activeCount * 8 * 60;
        const availability: Pct =
          planned > 0 ? clampPct((Math.max(0, planned - downtime) / planned) * 100) : null;
        const performance: Pct = target > 0 ? clampPct((produced / target) * 100) : null;
        const quality: Pct =
          produced > 0 ? clampPct(((produced - rejected) / produced) * 100) : null;
        const oee: Pct =
          availability != null && performance != null && quality != null
            ? (availability / 100) * (performance / 100) * (quality / 100) * 100
            : null;

        let status = "IDLE";
        if (!m.isActive) status = "OFFLINE";
        else if (stats.runningMachineIds.has(m.machineId)) status = "RUNNING";
        else if (stats.stoppedMachineIds.has(m.machineId)) status = "STOPPED";

        return {
          machineId: m.machineId,
          machineName: m.machineName,
          status,
          downtime,
          availability,
          performance,
          quality,
          oee,
        };
      }),
    [machines, productionOrders, stats]
  );

  // Output per shift, from the shift recorded on each order.
  const shiftRows = useMemo(() => {
    const groups = new Map<string, { name: string; target: number; produced: number }>();
    productionOrders.forEach((po) => {
      const p = po as any;
      const name = p.shift?.shiftName || p.shiftName || (p.shiftId ? String(p.shiftId) : null);
      if (!name) return;
      const g = groups.get(name) || { name, target: 0, produced: 0 };
      g.target += Number(po.targetQty) || 0;
      g.produced += Number(po.producedQty) || 0;
      groups.set(name, g);
    });
    return Array.from(groups.values()).map((g) => ({
      ...g,
      efficiency: (g.target > 0 ? (g.produced / g.target) * 100 : null) as Pct,
    }));
  }, [productionOrders]);

  const periodTiles = [
    {
      key: "today",
      label: "Today",
      icon: LuCalendarDays,
      produced: stats.todayProduced,
      target: stats.todayTarget,
    },
    {
      key: "week",
      label: "This week",
      icon: LuCalendarRange,
      produced: stats.weekProduced,
      target: stats.weekTarget,
    },
    {
      key: "month",
      label: "This month",
      icon: LuCalendar,
      produced: stats.monthProduced,
      target: stats.monthTarget,
    },
  ];

  const ringR = 52;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className="flex w-full flex-col gap-6 pb-10">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="sl-h1">Production</h1>
          <p className="sl-muted mt-1 text-sm">
            Live output against target, factory OEE and machine status
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {can("oee-dashboard.view") && (
            <Link to="/oee-dashboard" className="sl-btn text-sm">
              <LuGauge aria-hidden="true" /> OEE dashboard
            </Link>
          )}
          {can("production_orders.create") && (
            <Link to="/production-orders/create" className="sl-cta">
              <LuPlus aria-hidden="true" /> New production order
            </Link>
          )}
        </div>
      </header>

      {/* ── Output vs target ── */}
      <section
        aria-label="Output against target"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {periodTiles.map((p) => {
          const pct = p.target > 0 ? (p.produced / p.target) * 100 : null;
          return (
            <div key={p.key} className="sl-tile flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-muted">{p.label}</span>
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 place-items-center rounded-[12px] bg-chip text-accent"
                >
                  <p.icon />
                </span>
              </div>
              <div className="text-[1.75rem] leading-none font-bold tracking-tight text-ink tabular-nums">
                {p.produced.toLocaleString("en-IN")}
                <span className="ml-1.5 text-sm font-medium text-ink-subtle">PCS</span>
              </div>
              <Meter
                value={pct ?? 0}
                color="var(--chart-series-1)"
                label={`${p.label} output against target`}
              />
              <span className="sl-muted text-xs tabular-nums">
                {p.target > 0
                  ? `${Math.round(pct ?? 0)}% of ${p.target.toLocaleString("en-IN")} target`
                  : "No target planned"}
              </span>
            </div>
          );
        })}
        <div className="sl-tile flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-2">
            <span className="text-[13px] font-medium text-ink-muted">Rejected and scrap</span>
            <span
              aria-hidden="true"
              className="sl-chip-danger grid h-9 w-9 place-items-center rounded-[12px]"
            >
              <LuTriangleAlert />
            </span>
          </div>
          <div className="text-[1.75rem] leading-none font-bold tracking-tight text-ink tabular-nums">
            {stats.monthRejected.toLocaleString("en-IN")}
            <span className="mx-1.5 text-sm font-medium text-ink-subtle">rej ·</span>
            {stats.monthScrap.toLocaleString("en-IN")}
            <span className="ml-1.5 text-sm font-medium text-ink-subtle">scrap</span>
          </div>
          <Meter
            value={stats.monthProduced > 0 ? (stats.monthRejected / stats.monthProduced) * 100 : 0}
            color="var(--color-danger)"
            label="Rejects as a share of this month's output"
          />
          <span className="sl-muted text-xs">This month's wastage logs</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ── Factory OEE ── */}
        <DashTile labelledBy="prod-oee">
          <TileHeader
            id="prod-oee"
            icon={LuGauge}
            title="Factory OEE"
            subtitle="Availability × performance × quality, this month"
          />
          <div className="flex flex-1 flex-col items-center gap-6 px-5 pb-6 sm:flex-row sm:items-center">
            <div className="relative h-36 w-36 shrink-0">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle
                  cx="60"
                  cy="60"
                  r={ringR}
                  fill="none"
                  stroke="var(--color-line-soft)"
                  strokeWidth="10"
                />
                {stats.oee != null && (
                  <circle
                    cx="60"
                    cy="60"
                    r={ringR}
                    fill="none"
                    stroke={toneVar(stats.oee)}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={ringC}
                    strokeDashoffset={ringC * (1 - clampPct(stats.oee) / 100)}
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold text-ink tabular-nums">
                  {pctLabel(stats.oee)}
                </span>
                <span className="text-[11px] text-ink-subtle">OEE</span>
              </div>
            </div>
            <div className="flex w-full flex-col gap-4">
              {[
                { label: "Availability", hint: "downtime loss", v: stats.availability },
                { label: "Performance", hint: "speed loss", v: stats.performance },
                { label: "Quality", hint: "reject loss", v: stats.quality },
              ].map((m) => (
                <div key={m.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium text-ink">
                      {m.label}{" "}
                      <span className="text-xs font-normal text-ink-subtle">· {m.hint}</span>
                    </span>
                    <span className="font-semibold text-ink tabular-nums">{pctLabel(m.v)}</span>
                  </div>
                  <Meter value={m.v ?? 0} color="var(--chart-series-1)" label={m.label} />
                </div>
              ))}
              {stats.oee == null && (
                <p className="sl-muted text-xs leading-relaxed">
                  OEE appears once orders are running and output is logged against a target.
                </p>
              )}
            </div>
          </div>
        </DashTile>

        {/* ── Machines ── */}
        <DashTile labelledBy="prod-machines">
          <TileHeader
            id="prod-machines"
            icon={LuCog}
            title="Machines"
            subtitle={`${machineRows.filter((m) => m.status === "RUNNING").length} running · ${machineRows.length} total`}
          />
          {loadingMachines && machineRows.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : machineRows.length === 0 ? (
            <EmptyState
              icon={LuCog}
              title="No machines yet"
              hint="Add your machines to watch their status and OEE here."
              action={can("machines.view") ? { label: "Open machines", to: "/machines" } : null}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
              {machineRows.map((m) => (
                <li key={m.machineId} className="flex flex-col gap-2 rounded-[14px] bg-card-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{m.machineName}</p>
                      <p className="text-xs text-ink-subtle">{m.machineId}</p>
                    </div>
                    <span
                      className={`sl-chip shrink-0 px-2.5 py-0 text-[11px] capitalize ${
                        m.status === "RUNNING"
                          ? "sl-chip-success"
                          : m.status === "STOPPED"
                            ? "sl-chip-danger"
                            : m.status === "IDLE"
                              ? "sl-chip-warning"
                              : "sl-chip-muted"
                      }`}
                    >
                      {m.status.toLowerCase()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <span>
                      OEE <strong className="text-ink tabular-nums">{pctLabel(m.oee)}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <LuClock aria-hidden="true" /> {m.downtime} min down
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DashTile>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* ── Machine-wise OEE ── */}
        <DashTile labelledBy="prod-machine-oee" className="xl:col-span-2">
          <TileHeader
            id="prod-machine-oee"
            icon={LuFactory}
            title="Machine-wise OEE"
            subtitle="Each machine's availability, performance and quality"
          />
          {machineRows.length === 0 ? (
            loadingMachines || loadingOrders ? (
              <SkeletonRows rows={4} />
            ) : (
              <EmptyState
                icon={LuFactory}
                title="Nothing to break down yet"
                hint="Machines appear here once they are set up."
              />
            )
          ) : (
            <div className="overflow-x-auto pb-2">
              <table className="w-full text-left text-sm">
                <thead className="bg-card-2 text-xs text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">
                      Machine
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Availability
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Performance
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      Quality
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      OEE
                    </th>
                    <th scope="col" className="hidden w-36 px-5 py-2.5 font-medium sm:table-cell">
                      <span className="sr-only">OEE bar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {machineRows.map((m) => (
                    <tr key={m.machineId} className="border-b border-line-soft last:border-b-0">
                      <td className="h-[52px] px-5 font-medium text-ink">{m.machineName}</td>
                      <td className="px-3 text-right text-ink-muted tabular-nums">
                        {pctLabel(m.availability)}
                      </td>
                      <td className="px-3 text-right text-ink-muted tabular-nums">
                        {pctLabel(m.performance)}
                      </td>
                      <td className="px-3 text-right text-ink-muted tabular-nums">
                        {pctLabel(m.quality)}
                      </td>
                      <td className="px-3 text-right font-semibold text-ink tabular-nums">
                        {pctLabel(m.oee)}
                      </td>
                      <td className="hidden px-5 sm:table-cell">
                        <Meter
                          value={m.oee ?? 0}
                          color={toneVar(m.oee)}
                          label={`${m.machineName} OEE`}
                          height="h-1.5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashTile>

        {/* ── Shifts ── */}
        <DashTile labelledBy="prod-shifts">
          <TileHeader
            id="prod-shifts"
            icon={LuClock}
            title="Output by shift"
            subtitle="Produced against target"
          />
          {shiftRows.length === 0 ? (
            <EmptyState
              icon={LuClock}
              title="No shift-wise output yet"
              hint="Orders that carry a shift roll up here with their efficiency."
            />
          ) : (
            <ul className="flex flex-col gap-3 px-5 pb-5">
              {shiftRows.map((sh) => (
                <li key={sh.name} className="flex flex-col gap-2 rounded-[14px] bg-card-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{sh.name}</span>
                    <span className="sl-chip sl-chip-success shrink-0 px-2.5 py-0 text-[11px] tabular-nums">
                      {pctLabel(sh.efficiency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-ink-subtle tabular-nums">
                    <span>Target {sh.target.toLocaleString("en-IN")}</span>
                    <span>Produced {sh.produced.toLocaleString("en-IN")}</span>
                  </div>
                  <Meter
                    value={sh.efficiency ?? 0}
                    color="var(--chart-series-3)"
                    label={`${sh.name} efficiency`}
                    height="h-1.5"
                  />
                </li>
              ))}
            </ul>
          )}
        </DashTile>
      </div>
    </div>
  );
};

export default ProductionDashboard;
