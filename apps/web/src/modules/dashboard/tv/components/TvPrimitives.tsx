import React from "react";
import { u, ring, type TvTheme } from "../tvTheme";

/* ══════════════════════════════════════════════════════════════════
   SHARED TV PRIMITIVES (UI v2)
   The concept's white rounded tiles, scaled for a wall: every size is a
   design-board pixel run through u(), so the whole set grows with the
   display. Numbers stay in ink; colour marks identity or state.
   ══════════════════════════════════════════════════════════════════ */

const RADIUS = 22;

/* ── Panel ──────────────────────────────────────────────────────── */
export const Panel: React.FC<{
  theme: TvTheme;
  title?: string;
  right?: React.ReactNode;
  /** Emphasised border, used by the Management Attention panel. */
  accentBorder?: string;
  padX?: number;
  padY?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ theme, title, right, accentBorder, padX = 24, padY = 20, style, children }) => (
  <div
    className="tv-panel"
    style={{
      background: theme.T.panel,
      border: accentBorder
        ? `${u(2)} solid ${accentBorder}`
        : `${u(1)} solid ${theme.T.panelBorder}`,
      borderRadius: u(RADIUS),
      boxShadow: theme.T.panelShadow,
      padding: `${u(padY)} ${u(padX)}`,
      ...style,
    }}
  >
    {(title || right) && (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: u(12),
          marginBottom: u(12),
          flex: "0 0 auto",
        }}
      >
        {title && (
          <div style={{ fontSize: u(24), fontWeight: 700, letterSpacing: "-0.015em" }}>{title}</div>
        )}
        {right}
      </div>
    )}
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {children}
    </div>
  </div>
);

/* ── Empty state ────────────────────────────────────────────────────
   A wall display must never imply data exists when it does not. Panels
   with no backing records say so plainly instead of showing zeros.
   ------------------------------------------------------------------ */
export const TvEmpty: React.FC<{ theme: TvTheme; label: string; hint?: string }> = ({
  theme,
  label,
  hint,
}) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: u(8),
      textAlign: "center",
    }}
  >
    <div
      aria-hidden="true"
      style={{
        width: u(44),
        height: u(44),
        borderRadius: u(14),
        background: theme.T.badgeBg,
        marginBottom: u(4),
      }}
    />
    <div style={{ fontSize: u(20), fontWeight: 600, color: theme.T.textDim }}>{label}</div>
    {hint && <div style={{ fontSize: u(15), color: theme.T.textMute }}>{hint}</div>}
  </div>
);

/* ── KPI card ───────────────────────────────────────────────────── */
export const KpiCard: React.FC<{
  theme: TvTheme;
  label: string;
  value: string;
  sub?: string;
  trend?: string;
  trendColor?: string;
  /** Identity/state colour: the marker beside the label, and the value when it is an alarm. */
  color: string;
  /** Kept for API compatibility with scene 0; the marker replaces the old rail. */
  rail?: boolean;
  valueSize?: number;
}> = ({ theme, label, value, sub, trend, trendColor, color, valueSize = 44 }) => {
  // Big numbers stay in ink so they read at distance; only an alarm turns red.
  const valueColor = color === theme.A.red ? color : theme.T.text;
  return (
    <div
      className="tv-panel"
      style={{
        flex: 1,
        background: theme.T.panel,
        border: `${u(1)} solid ${theme.T.panelBorder}`,
        borderRadius: u(RADIUS),
        boxShadow: theme.T.panelShadow,
        padding: `${u(20)} ${u(22)}`,
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: u(10),
          fontSize: u(16),
          fontWeight: 600,
          color: theme.T.textDim,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: u(10),
            height: u(22),
            flex: "0 0 auto",
            borderRadius: u(6),
            background: color,
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div
        style={{
          fontSize: u(valueSize),
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1,
          marginTop: u(8),
          color: valueColor,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: u(10),
          gap: u(8),
        }}
      >
        <span
          style={{
            fontSize: u(15),
            color: theme.T.textMute,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </span>
        {trend && (
          <span
            style={{
              fontSize: u(15),
              fontWeight: 700,
              color: trendColor,
              flex: "0 0 auto",
              padding: `${u(3)} ${u(10)}`,
              borderRadius: u(999),
              background: theme.T.tile,
            }}
          >
            {trend}
          </span>
        )}
      </div>
    </div>
  );
};

/* ── Circular percentage gauge ──────────────────────────────────── */
export const Gauge: React.FC<{
  theme: TvTheme;
  pct: number;
  color: string;
  size?: number;
  label?: string;
  /** Overrides the centred text — use when the KPI shows a decimal. */
  display?: string;
}> = ({ theme, pct, color, size = 76, label, display }) => {
  const inner = size - 16;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: u(8),
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          width: u(size),
          height: u(size),
          borderRadius: "50%",
          background: ring(pct, color, theme.T.track),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: u(inner),
            height: u(inner),
            borderRadius: "50%",
            background: theme.T.panel,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: u(18),
            fontWeight: 700,
            color: theme.T.text,
          }}
        >
          {display ?? `${Math.round(pct)}%`}
        </div>
      </div>
      {label && (
        <div
          style={{
            fontSize: u(14),
            fontWeight: 600,
            color: theme.T.textDim,
            textAlign: "center",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
};

/* ── Horizontal progress row (production lines, top products) ───── */
export const BarRow: React.FC<{
  theme: TvTheme;
  name: string;
  pct: number;
  color: string;
  nameWidth?: number;
  barHeight?: number;
  valueText?: string;
  status?: string;
  fontSize?: number;
}> = ({
  theme,
  name,
  pct,
  color,
  nameWidth = 96,
  barHeight = 22,
  valueText,
  status,
  fontSize = 17,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: u(14) }}>
    <div
      style={{
        width: u(nameWidth),
        flex: "0 0 auto",
        fontSize: u(fontSize),
        fontWeight: 600,
        color: theme.T.text,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
      title={name}
    >
      {name}
    </div>
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: u(barHeight),
        background: theme.T.track,
        borderRadius: u(999),
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          background: color,
          borderRadius: u(999),
          width: `${Math.max(0, Math.min(100, pct))}%`,
          transition: "width 600ms ease",
        }}
      />
    </div>
    <div
      style={{
        width: u(64),
        flex: "0 0 auto",
        textAlign: "right",
        fontSize: u(fontSize + 2),
        fontWeight: 700,
        color: theme.T.text,
      }}
    >
      {valueText ?? `${Math.round(pct)}%`}
    </div>
    {status && (
      <div
        style={{
          width: u(170),
          flex: "0 0 auto",
          textAlign: "right",
          fontSize: u(16),
          color: theme.T.textDim,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {status}
      </div>
    )}
  </div>
);

/* ── Sparkline bar chart ────────────────────────────────────────── */
export const BarChart: React.FC<{
  theme: TvTheme;
  points: { day: string; value: number }[];
  color: string;
  showDays?: boolean;
  barWidth?: string;
  gap?: number;
  pad?: number;
}> = ({ theme, points, color, showDays = false, barWidth = "56%", gap = 8, pad = 6 }) => {
  // Zero-baselined (bar charts must be), but scaled against the peak plus
  // headroom — otherwise the tallest bar fills the track and a week of similar
  // values reads as one solid block instead of a trend.
  const peak = Math.max(...points.map((p) => p.value), 0);
  const max = peak * 1.15;
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "flex-end",
        gap: u(gap),
        borderRadius: u(14),
        padding: `${u(pad)} ${u(pad)} 0`,
      }}
    >
      {points.map((p, i) => {
        // An all-zero week should read as a flat floor, not a full bar.
        const h = max > 0 ? (p.value / max) * 100 : 0;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: u(6),
            }}
          >
            <div
              style={{
                width: barWidth,
                background: h > 0 ? color : theme.T.track,
                height: `${h}%`,
                minHeight: u(6),
                borderRadius: `${u(6)} ${u(6)} ${u(2)} ${u(2)}`,
                transition: "height 600ms ease",
              }}
            />
            {showDays && (
              <div style={{ fontSize: u(13), color: theme.T.textMute, flex: "0 0 auto" }}>
                {p.day}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/* ── Trend card (label + trend + sparkline) ─────────────────────── */
export const TrendCard: React.FC<{
  theme: TvTheme;
  label: string;
  trend: string;
  trendColor: string;
  points: { day: string; value: number }[];
  color: string;
}> = ({ theme, label, trend, trendColor, points, color }) => (
  <div
    className="tv-panel"
    style={{
      flex: 1,
      background: theme.T.panel,
      border: `${u(1)} solid ${theme.T.panelBorder}`,
      borderRadius: u(RADIUS),
      boxShadow: theme.T.panelShadow,
      padding: `${u(16)} ${u(20)}`,
    }}
  >
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: u(8),
        flex: "0 0 auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: u(8),
          fontSize: u(16),
          fontWeight: 600,
          color: theme.T.textDim,
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: u(10), height: u(10), borderRadius: "50%", background: color }}
        />
        {label}
      </div>
      <div style={{ fontSize: u(16), fontWeight: 700, color: trendColor }}>{trend}</div>
    </div>
    <BarChart theme={theme} points={points} color={color} />
  </div>
);
