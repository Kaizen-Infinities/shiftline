import React, { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  LuChartArea,
  LuChartColumn,
  LuChartPie,
  LuHexagon,
  LuTable,
  LuTrendingUp,
} from "react-icons/lu";
import { usePermission } from "../../../hooks/usePermission";
import { DashTile, TileHeader, ChipToggle, EmptyState } from "./DashboardPrimitives";

/* ════════════════════════════════════════════════════════════════
   SALES & PURCHASE TREND
   Two series, so two identity colours from the validated chart palette
   (--chart-series-1 sales, --chart-series-2 purchase), a legend that also
   carries the period totals, and a table view for the same numbers.
   ════════════════════════════════════════════════════════════════ */

interface SalesPurchaseTrendChartProps {
  salesOrders?: any[];
  purchaseOrders?: any[];
  productionOrders?: any[];
  salesInvoices?: any[];
  purchaseInvoices?: any[];
  externalPeriod?: PeriodKey;
  loading?: boolean;
  className?: string;
}

const SALES = "var(--chart-series-1)";
const PURCHASE = "var(--chart-series-2)";

const PERIODS = {
  "7d": "Daily",
  "30d": "Weekly",
  "90d": "Monthly",
  "12m": "Yearly",
} as const;
type PeriodKey = keyof typeof PERIODS;
type ChartType = "bar" | "area" | "pie" | "radar" | "table";

const PERIOD_CAPTION: Record<PeriodKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 4 weeks",
  "90d": "Last 6 months",
  "12m": "Last 6 years",
};

const useIsMobile = () => {
  const [isMobile, setIsMobile] = React.useState(
    typeof window !== "undefined" ? window.innerWidth < 640 : false
  );
  React.useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
};

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const formatAxis = (value: number) => {
  const v = Math.abs(value);
  if (v >= 1e7) return `₹${(value / 1e7).toFixed(v >= 1e8 ? 0 : 1)}Cr`;
  if (v >= 1e5) return `₹${(value / 1e5).toFixed(v >= 1e6 ? 0 : 1)}L`;
  if (v >= 1e3) return `₹${(value / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K`;
  return `₹${value}`;
};

/** Tooltip in theme tokens: label, then one row per series with its swatch. */
const TrendTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-[12px] border border-line-soft bg-card px-3 py-2 text-xs text-ink shadow-[var(--shadow-md)]">
      {label && <p className="mb-1.5 font-semibold">{label}</p>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 py-0.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: p.payload?.color || p.color || p.stroke }}
          />
          <span className="flex-1 text-ink-muted capitalize">{p.name}</span>
          <span className="font-semibold tabular-nums">{rupees(Number(p.value || 0))}</span>
        </div>
      ))}
    </div>
  );
};

const axisTick = (isMobile: boolean) => ({
  fontSize: isMobile ? 10 : 11,
  fill: "var(--color-ink-subtle)",
});

const SalesPurchaseTrendChart: React.FC<SalesPurchaseTrendChartProps> = ({
  salesOrders = [],
  purchaseOrders = [],
  salesInvoices = [],
  purchaseInvoices = [],
  externalPeriod,
  loading = false,
  className = "",
}) => {
  const { can } = usePermission();
  const [internalPeriod, setInternalPeriod] = useState<PeriodKey>(() => {
    try {
      const saved = localStorage.getItem("dashboard_trend_period");
      if (saved && ["7d", "30d", "90d", "12m"].includes(saved)) return saved as PeriodKey;
    } catch {}
    return "7d";
  });

  // The home page's period switcher drives this chart; standalone it keeps its own.
  const period: PeriodKey = externalPeriod ?? internalPeriod;

  const [chartType, setChartType] = useState<ChartType>(() => {
    try {
      const saved = localStorage.getItem("dashboard_trend_chart_type");
      if (saved && ["bar", "area", "pie", "radar", "table"].includes(saved)) {
        return saved as ChartType;
      }
    } catch {}
    return "bar";
  });

  const handlePeriodChange = (newPeriod: PeriodKey) => {
    setInternalPeriod(newPeriod);
    try {
      localStorage.setItem("dashboard_trend_period", newPeriod);
    } catch {}
  };

  const handleChartTypeChange = (newType: ChartType) => {
    setChartType(newType);
    try {
      localStorage.setItem("dashboard_trend_chart_type", newType);
    } catch {}
  };

  const isMobile = useIsMobile();

  // Bucket invoices (or orders when no invoice exists yet) by the selected period.
  const chartData = useMemo(() => {
    const now = new Date();
    const getStartOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const buckets: { label: string; start: Date; end: Date; sales: number; purchase: number }[] =
      [];

    if (period === "7d") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const start = getStartOfDay(d);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        const label = start.toLocaleDateString("en-US", { weekday: "short" });
        buckets.push({ label, start, end, sales: 0, purchase: 0 });
      }
    } else if (period === "30d") {
      for (let i = 3; i >= 0; i--) {
        const end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        buckets.push({ label: `Week ${4 - i}`, start, end, sales: 0, purchase: 0 });
      }
    } else if (period === "90d") {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        const label = d.toLocaleDateString("en-US", { month: "short" });
        buckets.push({ label, start: d, end, sales: 0, purchase: 0 });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const year = now.getFullYear() - i;
        buckets.push({
          label: String(year),
          start: new Date(year, 0, 1),
          end: new Date(year + 1, 0, 1),
          sales: 0,
          purchase: 0,
        });
      }
    }

    const effectiveSales =
      Array.isArray(salesInvoices) && salesInvoices.length > 0 ? salesInvoices : salesOrders;
    const effectivePurchases =
      Array.isArray(purchaseInvoices) && purchaseInvoices.length > 0
        ? purchaseInvoices
        : purchaseOrders;

    const processItem = (item: any, isSales: boolean) => {
      if (item.status && String(item.status).toUpperCase() === "CANCELLED") return;
      const d = new Date(item.invoiceDate || item.orderDate || item.grnDate || item.createdAt);
      if (isNaN(d.getTime())) return;
      const amount =
        Number(item.grandTotal) ||
        Number(item.netAmount) ||
        Number(item.totalAmount) ||
        Number(item.subtotal) ||
        0;
      for (const b of buckets) {
        if (d >= b.start && d < b.end) {
          if (isSales) b.sales += amount;
          else b.purchase += amount;
          break;
        }
      }
    };

    if (Array.isArray(effectiveSales)) effectiveSales.forEach((o) => processItem(o, true));
    if (Array.isArray(effectivePurchases)) effectivePurchases.forEach((o) => processItem(o, false));

    return buckets.map((b) => ({
      name: b.label,
      sales: Math.round(b.sales),
      purchase: Math.round(b.purchase),
    }));
  }, [salesOrders, purchaseOrders, salesInvoices, purchaseInvoices, period]);

  const totalSales = useMemo(() => chartData.reduce((s, d) => s + d.sales, 0), [chartData]);
  const totalPurchase = useMemo(() => chartData.reduce((s, d) => s + d.purchase, 0), [chartData]);
  const combinedTotal = totalSales + totalPurchase;
  const netMargin = totalSales - totalPurchase;

  const pieData = useMemo(
    () => [
      { name: "Sales", value: totalSales, color: SALES },
      { name: "Purchase", value: totalPurchase, color: PURCHASE },
    ],
    [totalSales, totalPurchase]
  );

  const isEmpty = combinedTotal === 0;

  const grid = <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />;
  const xAxis = (
    <XAxis
      dataKey="name"
      axisLine={false}
      tickLine={false}
      tickMargin={10}
      tick={axisTick(isMobile)}
    />
  );
  const yAxis = (
    <YAxis
      axisLine={false}
      tickLine={false}
      width={56}
      tickMargin={6}
      tickFormatter={formatAxis}
      tick={axisTick(isMobile)}
    />
  );

  return (
    <DashTile labelledBy="dash-trend" className={className}>
      <TileHeader
        id="dash-trend"
        icon={LuTrendingUp}
        title="Sales & purchases"
        subtitle={`Invoiced value · ${PERIOD_CAPTION[period]}`}
        actions={
          <>
            {!externalPeriod && (
              <ChipToggle
                label="Trend period"
                size="sm"
                value={period}
                onChange={handlePeriodChange}
                options={(Object.keys(PERIODS) as PeriodKey[]).map((k) => ({
                  value: k,
                  label: PERIODS[k],
                }))}
              />
            )}
            <ChipToggle
              label="Chart type"
              size="sm"
              value={chartType}
              onChange={handleChartTypeChange}
              options={[
                { value: "bar", label: <LuChartColumn aria-hidden="true" />, title: "Columns" },
                { value: "area", label: <LuChartArea aria-hidden="true" />, title: "Area" },
                { value: "pie", label: <LuChartPie aria-hidden="true" />, title: "Share" },
                { value: "radar", label: <LuHexagon aria-hidden="true" />, title: "Radar" },
                { value: "table", label: <LuTable aria-hidden="true" />, title: "Table" },
              ]}
            />
          </>
        }
      />

      {/* Legend doubles as the period's headline numbers. */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 px-5 pb-2">
        {[
          { label: "Sales", value: totalSales, color: SALES },
          { label: "Purchase", value: totalPurchase, color: PURCHASE },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </span>
            {loading && isEmpty ? (
              <span className="sl-skeleton h-6 w-24" aria-hidden="true" />
            ) : (
              <span className="text-xl font-bold tracking-tight text-ink tabular-nums">
                {rupees(s.value)}
              </span>
            )}
          </div>
        ))}
        {!isEmpty && (
          <span
            className={`sl-chip mb-0.5 px-2.5 py-0.5 text-xs ${
              netMargin >= 0 ? "sl-chip-success" : "sl-chip-danger"
            }`}
          >
            Net {netMargin >= 0 ? "+" : "−"}
            {rupees(Math.abs(netMargin))}
          </span>
        )}
      </div>

      <div className="flex min-h-[300px] flex-1 flex-col px-3 pb-4 sm:px-4">
        {loading && isEmpty ? (
          <div className="flex flex-1 items-end gap-3 px-4 pt-6 pb-2" aria-hidden="true">
            {[45, 70, 35, 85, 55, 65, 40].map((h, i) => (
              <div
                key={i}
                className="sl-skeleton flex-1 rounded-t-[10px]"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        ) : isEmpty && chartType !== "table" ? (
          <div className="relative flex flex-1 flex-col">
            {/* Grey slabs stand in for the bars so the empty chart still reads as a chart. */}
            <div
              className="absolute inset-x-4 top-6 bottom-2 flex items-end gap-3 opacity-60"
              aria-hidden="true"
            >
              {[30, 48, 26, 60, 40, 52, 34].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-[10px] bg-line-soft"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
            <div className="relative z-10 flex flex-1 items-center justify-center">
              <div className="sl-tile px-2 py-1">
                <EmptyState
                  icon={LuTrendingUp}
                  title="No sales or purchases in this period"
                  hint="Raise an invoice and the trend starts drawing itself."
                  action={
                    can("sales-invoices.create")
                      ? { label: "New invoice", to: "/sales-invoices/create" }
                      : null
                  }
                  className="py-5"
                />
              </div>
            </div>
          </div>
        ) : chartType === "bar" ? (
          <div className="min-h-[280px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
                barGap={2}
              >
                {grid}
                {xAxis}
                {yAxis}
                <Tooltip cursor={{ fill: "var(--color-card-2)" }} content={<TrendTooltip />} />
                <Bar
                  dataKey="sales"
                  name="Sales"
                  fill={SALES}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="purchase"
                  name="Purchase"
                  fill={PURCHASE}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : chartType === "area" ? (
          <div className="min-h-[280px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="dashAreaSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SALES} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={SALES} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dashAreaPurchase" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PURCHASE} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={PURCHASE} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {grid}
                {xAxis}
                {yAxis}
                <Tooltip
                  cursor={{ stroke: "var(--color-line)", strokeWidth: 1 }}
                  content={<TrendTooltip />}
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  name="Sales"
                  stroke={SALES}
                  strokeWidth={2}
                  fill="url(#dashAreaSales)"
                  activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2, fill: SALES }}
                />
                <Area
                  type="monotone"
                  dataKey="purchase"
                  name="Purchase"
                  stroke={PURCHASE}
                  strokeWidth={2}
                  fill="url(#dashAreaPurchase)"
                  activeDot={{ r: 5, stroke: "var(--color-card)", strokeWidth: 2, fill: PURCHASE }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : chartType === "pie" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-2 md:flex-row md:justify-around">
            <div className="relative h-56 w-56 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<TrendTooltip />} />
                  <Pie
                    data={pieData}
                    dataKey="value"
                    innerRadius={70}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke="var(--color-card)"
                    strokeWidth={2}
                  >
                    {pieData.map((e) => (
                      <Cell key={e.name} fill={e.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xs text-ink-subtle">Net</span>
                <span className="text-lg font-bold text-ink tabular-nums">
                  {netMargin >= 0 ? "+" : "−"}
                  {rupees(Math.abs(netMargin))}
                </span>
              </div>
            </div>
            <ul className="flex w-full max-w-xs flex-col gap-3">
              {pieData.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between gap-3 rounded-[14px] bg-card-2 px-4 py-3"
                >
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    {s.name}
                  </span>
                  <span className="text-sm font-semibold text-ink tabular-nums">
                    {combinedTotal > 0 ? Math.round((s.value / combinedTotal) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : chartType === "radar" ? (
          <div className="min-h-[300px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={chartData} outerRadius="75%">
                <PolarGrid stroke="var(--color-line-soft)" />
                <PolarAngleAxis dataKey="name" tick={axisTick(isMobile)} />
                <PolarRadiusAxis angle={30} tick={false} axisLine={false} />
                <Tooltip content={<TrendTooltip />} />
                <Radar
                  name="Sales"
                  dataKey="sales"
                  stroke={SALES}
                  fill={SALES}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Radar
                  name="Purchase"
                  dataKey="purchase"
                  stroke={PURCHASE}
                  fill={PURCHASE}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-[14px] border border-line-soft">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card-2 text-xs text-ink-subtle">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    {PERIODS[period]}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Sales
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Purchase
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((row) => {
                  const diff = row.sales - row.purchase;
                  return (
                    <tr key={row.name} className="border-b border-line-soft last:border-b-0">
                      <td className="px-4 py-3 font-medium text-ink">{row.name}</td>
                      <td className="px-4 py-3 text-right text-ink tabular-nums">
                        {rupees(row.sales)}
                      </td>
                      <td className="px-4 py-3 text-right text-ink tabular-nums">
                        {rupees(row.purchase)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums ${
                          diff >= 0
                            ? "text-[color:var(--color-success)]"
                            : "text-[color:var(--color-danger)]"
                        }`}
                      >
                        {diff >= 0 ? "+" : "−"}
                        {rupees(Math.abs(diff))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-card-2 font-semibold text-ink">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">{rupees(totalSales)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{rupees(totalPurchase)}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      netMargin >= 0
                        ? "text-[color:var(--color-success)]"
                        : "text-[color:var(--color-danger)]"
                    }`}
                  >
                    {netMargin >= 0 ? "+" : "−"}
                    {rupees(Math.abs(netMargin))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </DashTile>
  );
};

export default SalesPurchaseTrendChart;
