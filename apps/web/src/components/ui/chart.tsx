"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ");

// Format: { THEME_NAME: CSS_SELECTOR } — the app sets data-theme on <html>.
const THEMES = { light: "", dark: ':root[data-theme="dark"]' } as const;

/** The four categorical series colours (style.css `--chart-series-*`), in order of use. */
export const CHART_SERIES = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
] as const;

/** Series colour for index `i`, cycling through the four-colour palette. */
export const chartSeriesColor = (i: number): string => CHART_SERIES[i % CHART_SERIES.length];

const RESERVED_TOKEN =
  /^(primary|accent|ink|card|line|page|head|success|warning|danger|info|chip|cta|brand|nav|surface|border|bg|text|secondary|neutral|black|white)(-|$)/;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Partial<Record<keyof typeof THEMES, string>> }
  );
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

export function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

/** Recharts wrapper: themed axis/grid colours and `--color-<key>` vars from the config. */
export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          // Axis text, grid and cursors read from the theme tokens (recharts draws #ccc / #fff by default).
          "[&_.recharts-cartesian-axis-tick_text]:fill-[color:var(--color-ink-subtle)] [&_.recharts-cartesian-axis-line]:stroke-[color:var(--color-line)] [&_.recharts-cartesian-axis-tick-line]:stroke-[color:var(--color-line)] [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-[color:var(--color-line-soft)] [&_.recharts-curve.recharts-tooltip-cursor]:stroke-[color:var(--color-line)] [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-[color:var(--color-line-soft)] [&_.recharts-radial-bar-background-sector]:fill-[color:var(--color-card-2)] [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-[color:var(--color-nav-hover)] [&_.recharts-reference-line_[stroke='#ccc']]:stroke-[color:var(--color-line)] flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-[color:var(--color-card)] [&_.recharts-layer]:outline-none [&_.recharts-sector]:outline-none [&_.recharts-sector[stroke='#fff']]:stroke-[color:var(--color-card)] [&_.recharts-surface]:outline-none [&_:focus]:outline-none [&_*:focus]:outline-none",
          className
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  // Only keys that make valid custom-property names, and never ones that would shadow a
  // theme token (a series called "primary" must not repaint the app's --color-primary).
  const colorConfig = Object.entries(config).filter(
    ([key, config]) =>
      (config.theme || config.color) && /^[\w-]+$/.test(key) && !RESERVED_TOKEN.test(key)
  );

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix ? `${prefix} ` : ""}[data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join("\n")}
}
`
          )
          .join("\n"),
      }}
    />
  );
};

export const ChartTooltip = RechartsPrimitive.Tooltip;

/** Tooltip card in the popover style with a coloured dot per series. */
export function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: React.ComponentProps<"div"> & {
  active?: boolean;
  payload?: Array<Record<string, any>>;
  label?: string | number;
  labelFormatter?: (label: any, payload: any) => React.ReactNode;
  labelClassName?: string;
  formatter?: (value: any, name: any, item: any, index: any, payload: any) => React.ReactNode;
  color?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: "line" | "dot" | "dashed";
  nameKey?: string;
  labelKey?: string;
}) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = `${labelKey || item?.dataKey || item?.name || "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string"
        ? config[label as keyof typeof config]?.label || label
        : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
      );
    }

    if (!value) {
      return null;
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        "sl-popover grid min-w-[9rem] items-start gap-1.5 !rounded-[12px] !px-3 !py-2 text-xs",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item: any, index: number) => {
          const key = `${nameKey || item.name || item.dataKey || "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = color || item.payload.fill || item.color;

          return (
            <div
              key={item.dataKey}
              className={cn(
                "[&>svg]:text-ink-subtle flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5",
                indicator === "dot" && "items-center"
              )}
            >
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn(
                          "shrink-0 rounded-full border-(--color-border) bg-(--color-bg)",
                          indicator === "dot" && "h-2.5 w-2.5",
                          indicator === "line" && "w-1",
                          indicator === "dashed" &&
                            "w-0 border-[1.5px] border-dashed bg-transparent",
                          nestLabel && indicator === "dashed" && "my-0.5"
                        )}
                        style={
                          {
                            "--color-bg": indicatorColor,
                            "--color-border": indicatorColor,
                          } as React.CSSProperties
                        }
                      />
                    )
                  )}
                  <div
                    className={cn(
                      "flex flex-1 justify-between leading-none gap-2",
                      nestLabel ? "items-end" : "items-center"
                    )}
                  >
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-ink-muted font-semibold">
                        {itemConfig?.label || item.name}
                      </span>
                    </div>
                    {item.value && (
                      <span className="text-ink font-bold tabular-nums">
                        {item.value.toLocaleString()}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ChartLegend = RechartsPrimitive.Legend;

/** Legend row with round swatches. */
export function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> & {
  payload?: Array<{ value?: any; dataKey?: string; color?: string; [key: string]: any }>;
  verticalAlign?: RechartsPrimitive.LegendProps["verticalAlign"];
  hideIcon?: boolean;
  nameKey?: string;
}) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);

        return (
          <div
            key={item.value}
            className={cn(
              "[&>svg]:text-ink-subtle flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 text-xs font-medium text-ink-muted"
            )}
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key as keyof typeof config];
}
