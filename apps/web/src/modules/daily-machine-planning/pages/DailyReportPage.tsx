import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cog,
  Gauge,
  Printer,
} from "lucide-react";
import {
  ActionPill,
  Chip,
  PageHeader,
  SectionLabel,
  StatTile,
  Tile,
  type ChipTone,
} from "../../../components/ui/v2";
import { PageBody, ProgressBar, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";

import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";

import { dailyPlanService } from "../../../services/dailyPlanService";
import { machineService } from "../../../services/machineService";
import { shiftService } from "../../../services/shiftService";
import { useSocketSync } from "../../../hooks/useSocketSync";
import apiClient from "../../../api/apiClient";
import config from "../../../api/config";

const DailyReportPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const passedState = location.state as any;

  const [dailyPlans, setDailyPlans] = useState<any[]>(passedState?.dailyPlans || []);
  const [machines, setMachines] = useState<any[]>(passedState?.machines || []);
  const [shifts, setShifts] = useState<any[]>(passedState?.shifts || []);
  const [hourlyProductions, setHourlyProductions] = useState<any[]>([]);

  const [loading, setLoading] = useState(!passedState?.dailyPlans);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (!passedState?.dailyPlans) {
        const [plans, machs, shfts] = await Promise.all([
          dailyPlanService.getAll(),
          machineService.getAll(),
          shiftService.fetchAll(),
        ]);
        // Services answer with a bare array or a { data } / { machines } envelope.
        const toArray = (v: any, key?: string): any[] =>
          Array.isArray(v)
            ? v
            : Array.isArray(v?.data)
              ? v.data
              : key && Array.isArray(v?.[key])
                ? v[key]
                : [];
        setDailyPlans(toArray(plans));
        setMachines(toArray(machs, "machines"));
        setShifts(Array.isArray(shfts) ? shfts : (shfts as any)?.data || []);
      }

      // Fetch hourly productions for the selected date
      const hpRes = await apiClient.get(config.hourlyProduction.base, {
        params: { productionDate: selectedDate },
      });
      if (hpRes.data?.success) {
        setHourlyProductions(hpRes.data.data || []);
      } else {
        setHourlyProductions([]);
      }
    } catch (err) {
      console.error("Failed to load report data", err);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, passedState?.dailyPlans]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useSocketSync("dailyPlan", undefined, fetchData);
  useSocketSync("hourlyProduction", undefined, fetchData);

  const reportData = useMemo(() => {
    if (!selectedDate)
      return {
        machineWise: [],
        totals: {
          machinesPlanned: 0,
          machinesExecuted: 0,
          plannedCapacity: 0,
          actualProduction: 0,
          pendingQuantity: 0,
          efficiency: 0,
          runningHours: 0,
          hourlyEntries: 0,
        },
      };

    const plansForDate = dailyPlans.filter((p: any) => {
      if (p.planDate) {
        return p.planDate.split("T")[0] === selectedDate;
      }
      return p.createdAt?.split("T")[0] === selectedDate; // fallback
    });

    const hourlyForDate = hourlyProductions.filter((hp: any) => {
      if (hp.productionDate) {
        return hp.productionDate.split("T")[0] === selectedDate;
      }
      return hp.createdAt?.split("T")[0] === selectedDate;
    });

    let totalPlannedCapacity = 0;
    let totalActualProduction = 0;
    let totalPendingQuantity = 0;
    let totalRunningHours = 0;

    const machineWise: any[] = [];

    const executedMachineIds = new Set<string>();
    const plannedMachineIds = new Set<string>();

    plansForDate.forEach((plan: any) => {
      if (plan.status === "CANCELLED") return;

      const plannedCapacity =
        Number(plan.targetQty) || Number(plan.plannedQuantity) || Number(plan.plannedQty) || 0;

      const planHourly = Array.isArray(plan.hourlyProductions)
        ? plan.hourlyProductions
        : hourlyForDate.filter(
            (hp: any) =>
              hp.dailyPlanId === plan.id ||
              hp.dailyPlanId === plan.dailyPlanId ||
              hp.productionOrderId === plan.productionOrderId
          );

      const actualProduction = planHourly.reduce(
        (sum: number, hp: any) => sum + (Number(hp.qtyProduced) || 0),
        0
      );
      const pendingQty = Math.max(0, plannedCapacity - actualProduction);

      const efficiency = plannedCapacity > 0 ? (actualProduction / plannedCapacity) * 100 : 0;

      let status = "Low";
      if (actualProduction >= plannedCapacity) {
        status = "Highest";
      } else if (efficiency >= 90) {
        status = "Medium";
      }

      totalPlannedCapacity += plannedCapacity;
      totalActualProduction += actualProduction;
      totalPendingQuantity += pendingQty;
      totalRunningHours += planHourly.length;

      let machineName = "Unknown";
      if (plan.machine?.machineName) machineName = plan.machine.machineName;
      else if (plan.Machine?.machineName) machineName = plan.Machine.machineName;
      else {
        const mId = plan.machineId || plan.machineMachineId;
        const m = machines.find((m: any) => m.id === mId || m.machineId === mId);
        if (m) machineName = m.machineName;
      }

      if (plan.machineId || plan.machineMachineId) {
        plannedMachineIds.add(plan.machineId || plan.machineMachineId);
      }

      if (actualProduction > 0 && (plan.machineId || plan.machineMachineId)) {
        executedMachineIds.add(plan.machineId || plan.machineMachineId);
      }

      let shiftName = plan.shift?.shiftName || "Unknown";
      if (!plan.shift?.shiftName && plan.shiftId) {
        const s = shifts.find((sh) => sh.id === plan.shiftId || sh.shiftCode === plan.shiftId);
        if (s) shiftName = s.shiftName;
      }

      const productName =
        plan.product?.productName || plan.productionOrder?.productItem?.productName || "Unknown";

      machineWise.push({
        id: plan.id || plan.dailyPlanId,
        machineName,
        productionOrder: plan.productionOrder?.orderNumber || plan.productionOrderId || "-",
        productName,
        shiftName,
        plannedCapacity,
        actualProduction,
        pendingQty,
        efficiency: efficiency.toFixed(1),
        status,
        planStatus: plan.status,
      });
    });

    const overallEfficiency =
      totalPlannedCapacity > 0 ? (totalActualProduction / totalPlannedCapacity) * 100 : 0;

    return {
      machineWise,
      totals: {
        machinesPlanned: plannedMachineIds.size,
        machinesExecuted: executedMachineIds.size,
        plannedCapacity: totalPlannedCapacity,
        actualProduction: totalActualProduction,
        pendingQuantity: totalPendingQuantity,
        efficiency: overallEfficiency.toFixed(1),
        runningHours: totalRunningHours,
        hourlyEntries: hourlyForDate.length,
      },
    };
  }, [selectedDate, dailyPlans, hourlyProductions, machines, shifts]);

  const effTone = (eff: number): ChipTone =>
    eff >= 90 ? "success" : eff >= 50 ? "muted" : "danger";
  const columns: DataTableColumn<any>[] = [
    {
      header: "Machine",
      render: (item) => <span className="font-semibold text-ink">{item.machineName}</span>,
    },
    {
      header: "Order · product",
      render: (item) => (
        <div className="py-1">
          <div className="font-mono text-[13px] font-semibold text-accent">
            {item.productionOrder}
          </div>
          <div className="text-ink">{item.productName}</div>
        </div>
      ),
    },
    {
      header: "Shift",
      render: (item) => <Chip size="sm">{item.shiftName}</Chip>,
    },
    {
      header: "Planned cap.",
      align: "right",
      render: (item) => (
        <span className="text-ink-muted tabular-nums">{formatQty(item.plannedCapacity)}</span>
      ),
    },
    {
      header: "Actual prod.",
      align: "right",
      render: (item) => (
        <span className="font-semibold text-ink tabular-nums">
          {formatQty(item.actualProduction)}
        </span>
      ),
    },
    {
      header: "Pending qty",
      align: "right",
      render: (item) => (
        <span
          className={
            item.pendingQty > 0
              ? "font-medium text-[color:var(--color-warning)] tabular-nums"
              : "text-ink-subtle tabular-nums"
          }
        >
          {item.pendingQty > 0 ? formatQty(item.pendingQty) : "—"}
        </span>
      ),
    },
    {
      header: "Efficiency %",
      align: "right",
      render: (item) => (
        <Chip size="sm" tone={effTone(Number(item.efficiency))} className="tabular-nums">
          {item.efficiency}%
        </Chip>
      ),
    },
    {
      header: "Status",
      render: (item) => (
        <Chip
          size="sm"
          dot
          tone={
            item.status === "Highest" ? "success" : item.status === "Medium" ? "muted" : "danger"
          }
        >
          {item.status}
        </Chip>
      ),
    },
  ];

  const csvColumns = [
    { header: "Machine", accessor: (item: any) => item.machineName },
    { header: "Production Order", accessor: (item: any) => item.productionOrder },
    { header: "Product", accessor: (item: any) => item.productName },
    { header: "Shift", accessor: (item: any) => item.shiftName },
    { header: "Planned Capacity", accessor: (item: any) => item.plannedCapacity },
    { header: "Actual Production", accessor: (item: any) => item.actualProduction },
    { header: "Pending Qty", accessor: (item: any) => item.pendingQty },
    { header: "Efficiency %", accessor: (item: any) => item.efficiency },
    { header: "Status", accessor: (item: any) => item.status },
  ];

  const handlePrint = () => {
    window.print();
  };

  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const shiftDate = (days: number) => {
    const d = new Date(selectedDate || todayStr);
    d.setDate(d.getDate() + days);
    setSelectedDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  };
  const t = reportData.totals;

  return (
    <PageBody className="report-print-container" id="daily-production-report">
      <PageHeader
        title="Daily production report"
        icon={<BarChart3 size={22} />}
        subtitle={`Overview of production progress across all machines · ${selectedDate ? formatDate(selectedDate) : ""}`}
        back={() => navigate(-1)}
        breadcrumbs={[
          { label: "Daily machine planning", to: "/daily-machine-planning" },
          { label: "Daily production report" },
        ]}
        actions={
          <div className="no-print flex flex-wrap items-center gap-2.5">
            <ExportCSVButton
              data={reportData.machineWise}
              columns={csvColumns}
              filename={`Daily_Production_Report_${selectedDate}.csv`}
              text="Export Excel"
            />
            <ActionPill variant="secondary" icon={<Printer size={17} />} onClick={handlePrint}>
              Print / PDF
            </ActionPill>
          </div>
        }
      />

      {/* Filter bar */}
      <Tile padding="sm" className="no-print">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => shiftDate(-1)}
            aria-label="Previous day"
            className="sl-icon-btn sl-icon-btn-md"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <label className="sl-label !mb-0 whitespace-nowrap" htmlFor="daily-report-date">
            Select Date
          </label>
          <input
            id="daily-report-date"
            type="date"
            className="sl-input h-11 w-[170px]"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button
            type="button"
            onClick={() => shiftDate(1)}
            aria-label="Next day"
            className="sl-icon-btn sl-icon-btn-md"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <Chip
            size="lg"
            selected={selectedDate === todayStr}
            onClick={() => setSelectedDate(todayStr)}
          >
            Today
          </Chip>
        </div>
      </Tile>

      {/* Summary Metric Tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Machines"
          value={t.machinesExecuted}
          hint={`of ${t.machinesPlanned} planned`}
          icon={<Cog size={18} />}
          loading={loading}
        />
        <StatTile
          label="Production"
          value={formatQty(t.actualProduction)}
          hint={`of ${formatQty(t.plannedCapacity)} target`}
          icon={<CheckCircle2 size={18} />}
          loading={loading}
        />
        <StatTile
          label="Pending"
          value={formatQty(t.pendingQuantity)}
          hint="units remaining"
          icon={<AlertCircle size={18} />}
          loading={loading}
        />
        <StatTile
          label="Efficiency"
          value={`${t.efficiency}%`}
          hint="overall"
          icon={<Gauge size={18} />}
          loading={loading}
        />
      </div>

      {!loading && (
        <Tile>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">Overall Daily Progress</span>
            <Chip size="sm" className="tabular-nums">
              {formatQty(t.actualProduction)} / {formatQty(t.plannedCapacity)}
            </Chip>
          </div>
          <ProgressBar
            pct={Number(t.efficiency) || 0}
            label="Overall daily progress"
            className="h-3"
          />
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs font-medium text-ink-subtle">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              {t.runningHours} Running Hours
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ink-subtle" aria-hidden="true" />
              {t.hourlyEntries} Hourly Records
            </span>
          </div>
        </Tile>
      )}

      {/* Machine-wise Production Table */}
      <div>
        <SectionLabel>Machine-wise Production Summary</SectionLabel>
        <DataTable
          ariaLabel="Machine-wise production summary"
          columns={columns}
          data={reportData.machineWise}
          loading={loading}
          density="compact"
          rowKey={(row) =>
            row.id ??
            row.machineId ??
            `${row.machineName ?? ""}-${row.productName ?? ""}-${row.shiftName ?? ""}`
          }
          emptyMessage="No production records found for the selected date."
        />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          @media print {
            body * {
              visibility: hidden;
            }
            .report-print-container, .report-print-container * {
              visibility: visible;
              color: #000 !important;
              background: #fff !important;
              box-shadow: none !important;
            }
            .report-print-container {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            .no-print {
              display: none !important;
            }
          }
        `,
        }}
      />
    </PageBody>
  );
};

export default DailyReportPage;
