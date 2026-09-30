import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { LuChartColumn, LuChartPie, LuList, LuPackage } from "react-icons/lu";
import { DashTile, TileHeader, EmptyState, SkeletonRows, ChipToggle } from "./DashboardPrimitives";

type ViewMode = "list" | "bar" | "pie";
const STORAGE_KEY = "dashboard_top_products_chart_type";

/* Top products is one measure (stock on hand), so the ranking and the
   column chart wear a single series colour; only the share view needs
   identity colours, and it folds everything past the top three into
   "Other" so it never cycles the four-hue palette. */
const SERIES = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
];

const tooltipBox =
  "rounded-[12px] border border-line-soft bg-card px-3 py-2 text-xs text-ink shadow-[var(--shadow-md)]";

export const TopProductsTile: React.FC<{
  products: { name: string; value: number }[];
  loading: boolean;
  className?: string;
}> = ({ products, loading, className = "" }) => {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "list" || saved === "bar" || saved === "pie") return saved;
    } catch {}
    return "list";
  });

  const changeMode = (m: ViewMode) => {
    setMode(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {}
  };

  const total = useMemo(() => products.reduce((s, p) => s + (p.value || 0), 0), [products]);
  const max = products[0]?.value || 1;

  const share = useMemo(() => {
    const top = products.slice(0, 3).map((p, i) => ({ ...p, color: SERIES[i] }));
    const rest = products.slice(3).reduce((s, p) => s + p.value, 0);
    return rest > 0 ? [...top, { name: "Other", value: rest, color: SERIES[3] }] : top;
  }, [products]);

  return (
    <DashTile labelledBy="dash-top-products" className={className}>
      <TileHeader
        id="dash-top-products"
        icon={LuPackage}
        tone="sales"
        title="Top products"
        subtitle="Finished goods by stock on hand"
        actions={
          <ChipToggle
            label="Top products view"
            size="sm"
            value={mode}
            onChange={changeMode}
            options={[
              { value: "list", label: <LuList aria-hidden="true" />, title: "Ranking" },
              { value: "bar", label: <LuChartColumn aria-hidden="true" />, title: "Column chart" },
              { value: "pie", label: <LuChartPie aria-hidden="true" />, title: "Share" },
            ]}
          />
        }
      />

      {loading && products.length === 0 ? (
        <SkeletonRows rows={4} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={LuPackage}
          title="No finished goods in stock yet"
          hint="Your best-stocked products will rank here once production posts to stock."
          action={{ label: "View finished stock", to: "/finished-stock" }}
        />
      ) : mode === "list" ? (
        <ol className="flex flex-1 flex-col gap-3.5 px-5 pb-5">
          {products.map((p, i) => (
            <li key={p.name} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-card-2 text-[11px] font-semibold text-ink-muted">
                    {i + 1}
                  </span>
                  <span className="truncate font-medium text-ink" title={p.name}>
                    {p.name}
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-ink tabular-nums">
                  {p.value.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-[var(--chart-series-1)] transition-[width] duration-700 motion-reduce:transition-none"
                  style={{ width: `${Math.min((p.value / max) * 100, 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : mode === "bar" ? (
        <div className="min-h-[240px] flex-1 px-3 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={products} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
              <XAxis
                dataKey="name"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
                tickFormatter={(v: string) => (v && v.length > 8 ? `${v.slice(0, 7)}…` : v)}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "var(--color-ink-subtle)" }}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
              />
              <Tooltip
                cursor={{ fill: "var(--color-card-2)" }}
                content={({ active, payload }: any) =>
                  active && payload?.length ? (
                    <div className={tooltipBox}>
                      <p className="max-w-[180px] truncate font-semibold">
                        {payload[0].payload.name}
                      </p>
                      <p className="text-ink-muted">
                        Stock{" "}
                        <strong className="text-ink tabular-nums">
                          {Number(payload[0].value).toLocaleString("en-IN")}
                        </strong>
                      </p>
                    </div>
                  ) : null
                }
              />
              <Bar
                dataKey="value"
                fill="var(--chart-series-1)"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4 px-5 pb-5">
          <div className="relative h-[160px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  content={({ active, payload }: any) =>
                    active && payload?.length ? (
                      <div className={tooltipBox}>
                        <p className="font-semibold">{payload[0].payload.name}</p>
                        <p className="text-ink-muted tabular-nums">
                          {Number(payload[0].value).toLocaleString("en-IN")} ·{" "}
                          {total > 0 ? Math.round((payload[0].value / total) * 100) : 0}%
                        </p>
                      </div>
                    ) : null
                  }
                />
                <Pie
                  data={share}
                  dataKey="value"
                  innerRadius={50}
                  outerRadius={74}
                  paddingAngle={2}
                  stroke="var(--color-card)"
                  strokeWidth={2}
                >
                  {share.map((s) => (
                    <Cell key={s.name} fill={s.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[11px] text-ink-subtle">Total</span>
              <span className="text-base font-bold text-ink tabular-nums">
                {total.toLocaleString("en-IN")}
              </span>
            </div>
          </div>
          <ul className="flex w-full flex-col gap-2">
            {share.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="flex-1 truncate text-ink-muted" title={s.name}>
                  {s.name}
                </span>
                <span className="font-semibold text-ink tabular-nums">
                  {s.value.toLocaleString("en-IN")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashTile>
  );
};
