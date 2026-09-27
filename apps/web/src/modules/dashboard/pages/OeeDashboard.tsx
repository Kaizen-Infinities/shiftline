import React, { useState, useEffect, useMemo } from "react";
import {
  LuCircleAlert,
  LuCircleCheck,
  LuCirclePause,
  LuCog,
  LuFactory,
  LuGauge,
  LuHourglass,
  LuWrench,
} from "react-icons/lu";
import { oeeService } from "../../../services/oeeService";
import { toast } from "react-toastify";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { usePermission } from "../../../hooks/usePermission";
import { EmptyState } from "../components/DashboardPrimitives";
import { oeeTone } from "../components/dashboardFormat";

/* ════════════════════════════════════════════════════════════════
   OEE & MACHINE ACTIVITY (UI v2)
   Factory OEE and its three factors, machines by state, then one tile per
   machine. A machine with no OEE for the day shows "—", not zero.
   ════════════════════════════════════════════════════════════════ */

const formatLocalDateString = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const thresholdColor = oeeTone;

const STATUS: Record<
  string,
  { label: string; chip: string; icon: React.ComponentType<{ className?: string }> }
> = {
  RUNNING: { label: "Running", chip: "sl-chip-success", icon: LuCircleCheck },
  IDLE: { label: "Idle", chip: "sl-chip-muted", icon: LuCirclePause },
  BREAKDOWN: { label: "Breakdown", chip: "sl-chip-danger", icon: LuCircleAlert },
  SETUP: { label: "Setup", chip: "sl-chip-warning", icon: LuWrench },
  MATERIAL_WAITING: { label: "Waiting for material", chip: "sl-chip", icon: LuHourglass },
};
const statusOf = (s: string) =>
  STATUS[s] ?? { label: s || "Unknown", chip: "sl-chip-muted", icon: LuCog };

const OeeDashboard: React.FC = () => {
  const { can } = usePermission();
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState<string>(formatLocalDateString(new Date()));

  useEffect(() => {
    fetchMachineStatus();
    const interval = setInterval(fetchMachineStatus, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [date]);

  async function fetchMachineStatus() {
    try {
      const data = await oeeService.getAllMachinesStatus(date);
      setMachines(data);
    } catch (error) {
      console.error("Failed to fetch machine statuses", error);
      toast.error("Failed to fetch OEE data");
    } finally {
      setLoading(false);
    }
  }

  // Refresh when production activity happens.
  useSocketSync("hourlyProduction", undefined, fetchMachineStatus);
  useSocketSync("productionWastage", undefined, fetchMachineStatus);
  useSocketSync("dailyPlan", undefined, fetchMachineStatus);
  useSocketSync("machine", undefined, fetchMachineStatus);

  const agg = useMemo(() => {
    let totalOee = 0,
      totalAvail = 0,
      totalPerf = 0,
      totalQual = 0,
      validCount = 0,
      running = 0,
      idle = 0,
      breakdown = 0,
      waiting = 0;
    machines.forEach((m) => {
      if (m.currentOee !== null && m.currentOee !== undefined) {
        totalOee += m.currentOee;
        totalAvail += m.availability || 0;
        totalPerf += m.performance || 0;
        totalQual += m.quality || 0;
        validCount++;
      }
      if (m.machineStatus === "RUNNING") running++;
      else if (m.machineStatus === "IDLE") idle++;
      else if (m.machineStatus === "BREAKDOWN") breakdown++;
      else waiting++;
    });
    const avg = (v: number) => (validCount > 0 ? Number((v / validCount).toFixed(1)) : null);
    return {
      oee: avg(totalOee),
      avail: avg(totalAvail),
      perf: avg(totalPerf),
      qual: avg(totalQual),
      running,
      idle,
      breakdown,
      waiting,
    };
  }, [machines]);

  const fmt = (v: number | null) => (v == null ? "—" : `${v}%`);

  const counts = [
    {
      key: "running",
      label: "Running",
      value: agg.running,
      chip: "sl-chip-success",
      icon: LuCircleCheck,
    },
    { key: "idle", label: "Idle", value: agg.idle, chip: "sl-chip-muted", icon: LuCirclePause },
    {
      key: "breakdown",
      label: "Breakdown",
      value: agg.breakdown,
      chip: "sl-chip-danger",
      icon: LuCircleAlert,
    },
    {
      key: "waiting",
      label: "Waiting / setup",
      value: agg.waiting,
      chip: "sl-chip-warning",
      icon: LuHourglass,
    },
  ];

  return (
    <div className="flex w-full flex-col gap-6 pb-10">
      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="sl-h1">OEE and machine activity</h1>
          <p className="sl-muted mt-1 text-sm">Factory overview and equipment effectiveness</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <span>Day</span>
          <input
            type="date"
            className="sl-input w-auto py-2"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </header>

      {/* ── Factory OEE + factors ── */}
      <section
        aria-label="Factory OEE"
        className="sl-tile grid grid-cols-2 gap-y-6 p-6 md:grid-cols-4"
      >
        {loading && machines.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-3" aria-hidden="true">
                <div className="sl-skeleton h-3 w-20" />
                <div className="sl-skeleton h-10 w-24" />
              </div>
            ))
          : [
              { label: "Factory OEE", v: agg.oee, color: thresholdColor(agg.oee), big: true },
              { label: "Availability", v: agg.avail, color: "var(--color-ink)" },
              { label: "Performance", v: agg.perf, color: "var(--color-ink)" },
              { label: "Quality", v: agg.qual, color: "var(--color-ink)" },
            ].map((m, i) => (
              <div
                key={m.label}
                className={`flex flex-col items-center gap-1.5 text-center ${
                  i > 0 ? "md:border-l md:border-line-soft" : ""
                }`}
              >
                <span className="text-[13px] font-medium text-ink-muted">{m.label}</span>
                <span
                  className={`leading-none font-bold tracking-tight tabular-nums ${
                    m.big ? "text-5xl" : "text-4xl"
                  }`}
                  style={{ color: m.color }}
                >
                  {fmt(m.v)}
                </span>
              </div>
            ))}
      </section>

      {/* ── Machines by state ── */}
      <section aria-label="Machines by state" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {counts.map((c) => (
          <div key={c.key} className="sl-tile flex items-center justify-between gap-3 p-5">
            <div>
              <p className="text-[13px] font-medium text-ink-muted">{c.label}</p>
              <p className="mt-1 text-3xl leading-none font-bold text-ink tabular-nums">
                {c.value}
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`${c.chip} grid h-10 w-10 place-items-center rounded-[12px]`}
            >
              <c.icon className="text-lg" />
            </span>
          </div>
        ))}
      </section>

      {/* ── Machine tiles ── */}
      <section aria-labelledby="oee-machines" className="flex flex-col gap-3">
        <h2 id="oee-machines" className="sl-section-label">
          Machines
        </h2>
        {loading && machines.length === 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="sl-tile flex flex-col gap-4 p-5">
                <div className="sl-skeleton h-4 w-1/2" />
                <div className="sl-skeleton mx-auto h-12 w-24" />
                <div className="sl-skeleton h-20 w-full" />
              </div>
            ))}
          </div>
        ) : machines.length === 0 ? (
          <div className="sl-tile">
            <EmptyState
              icon={LuFactory}
              title="No machines to show"
              hint="Machines appear here with their live state and OEE once they are set up."
              action={can("machines.view") ? { label: "Open machines", to: "/machines" } : null}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {machines.map((machine) => {
              const st = statusOf(machine.machineStatus);
              const oee = machine.currentOee ?? null;
              return (
                <article key={machine.machineId} className="sl-tile flex flex-col overflow-hidden">
                  <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`${st.chip === "sl-chip" ? "bg-chip text-accent" : st.chip} grid h-10 w-10 shrink-0 place-items-center rounded-[12px]`}
                      >
                        <LuGauge className="text-lg" />
                      </span>
                      <h3 className="sl-h2 truncate text-[15px]">{machine.machineName}</h3>
                    </div>
                    <span className={`sl-chip ${st.chip} shrink-0 px-2.5 py-0.5 text-xs`}>
                      <st.icon aria-hidden="true" />
                      {st.label}
                    </span>
                  </header>

                  <div className="flex flex-col items-center gap-1 px-5 py-3">
                    <span className="text-xs text-ink-subtle">Current OEE</span>
                    <span
                      className="text-5xl leading-none font-bold tracking-tight tabular-nums"
                      style={{ color: thresholdColor(oee) }}
                    >
                      {oee == null ? "—" : `${oee}%`}
                    </span>
                  </div>

                  <dl className="mx-5 grid grid-cols-3 divide-x divide-line-soft rounded-[14px] bg-card-2 py-3 text-center">
                    {[
                      { k: "Availability", v: machine.availability },
                      { k: "Performance", v: machine.performance },
                      { k: "Quality", v: machine.quality },
                    ].map((x) => (
                      <div key={x.k} className="flex flex-col gap-0.5 px-2">
                        <dt className="truncate text-[11px] text-ink-subtle">{x.k}</dt>
                        <dd className="text-sm font-semibold text-ink tabular-nums">
                          {x.v == null ? "—" : `${x.v}%`}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-sm">
                    <dt className="text-ink-subtle">Operator</dt>
                    <dd className="truncate text-right font-medium text-ink">
                      {machine.operatorId || "Unassigned"}
                    </dd>
                    <dt className="text-ink-subtle">Active plan</dt>
                    <dd
                      className="truncate text-right font-medium text-ink"
                      title={machine.activeProductionOrderId || "None"}
                    >
                      {machine.activeProductionOrderId || "None"}
                    </dd>
                    <dt className="text-ink-subtle">Planned run</dt>
                    <dd className="text-right font-medium text-ink tabular-nums">
                      {machine.todayPlannedHours ? `${machine.todayPlannedHours} h` : "0 h"}
                    </dd>
                    <dt className="text-ink-subtle">Cycle time</dt>
                    <dd className="text-right font-medium text-ink tabular-nums">
                      {machine.cycleTime ? `${machine.cycleTime} s` : "—"}
                    </dd>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default OeeDashboard;
