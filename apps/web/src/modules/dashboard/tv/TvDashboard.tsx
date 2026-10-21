import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../../providers/ThemeProvider";

import "./tv.css";
import { getTvTheme, u, type TvMode, type TvTheme } from "./tvTheme";
import { useTvSummary, useTvClock } from "./useTvSummary";
import { hasMoney } from "../../../services/dashboardService";
import SceneOverview from "./scenes/SceneOverview";
import SceneProduction from "./scenes/SceneProduction";
import SceneSales from "./scenes/SceneSales";
import SceneInventoryFinance from "./scenes/SceneInventoryFinance";
import SceneFieldSales from "./scenes/SceneFieldSales";
import { inrCompact } from "./tvFormat";

/* ══════════════════════════════════════════════════════════════════
   MANAGEMENT TV DASHBOARD
   ------------------------------------------------------------------
   A full-screen, unattended wall display: four scenes on a timer, a
   live ticker, and a single-line banner that states the most urgent
   thing needing management attention.

   Keyboard: ← / → change scene · Space pauses rotation ·
             T toggles theme · F fullscreen · Esc exits.
   ══════════════════════════════════════════════════════════════════ */

const SCENE_LABELS = [
  "Executive overview",
  "Production",
  "Sales and orders",
  "Inventory and finance",
  "Field sales — GPS",
];

const ROTATE_SECONDS = 13;
const THEME_KEY = "tv-dashboard-theme";

const RestrictedScene: React.FC<{ theme: TvTheme; label: string }> = ({ theme, label }) => (
  <div
    style={{
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 28,
      fontWeight: 700,
      color: theme.T.textDim,
    }}
  >
    {label} is shown to people with accounts access
  </div>
);

const TvDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [scene, setScene] = useState(0);
  const [rotating, setRotating] = useState(true);
  const [mode, setMode] = useState<TvMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light") return saved;
      // No wall-display preference yet — inherit the operator's app theme.
      if (document.documentElement.getAttribute("data-theme") === "light") return "light";
    } catch {
      /* private mode / storage blocked — fall through to the default */
    }
    return "dark";
  });

  const theme = getTvTheme(mode);
  const { T, A } = theme;

  /* ── Theme ────────────────────────────────────────────────────────
     The wall keeps its own light/dark choice. Its colours are the app's
     tokens, so while mounted it sets the document theme to that choice,
     and on the way out it hands the document back to the app's theme. */
  const { mode: appMode } = useTheme();
  const appModeRef = useRef(appMode);
  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);
  useEffect(() => {
    const rootEl = document.documentElement;
    rootEl.setAttribute("data-theme", mode);
    rootEl.classList.toggle("dark", mode === "dark");
  }, [mode]);
  useEffect(
    () => () => {
      const rootEl = document.documentElement;
      rootEl.setAttribute("data-theme", appModeRef.current);
      rootEl.classList.toggle("dark", appModeRef.current === "dark");
    },
    []
  );
  const { tv, accounts, loading, stale, lastUpdated } = useTvSummary();
  const { dateStr, timeStr } = useTvClock();

  /* ── Scene rotation ───────────────────────────────────────────── */
  const timer = useRef<number | null>(null);
  const clearTimer = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    clearTimer();
    if (!rotating) return;
    timer.current = window.setTimeout(
      () => setScene((s) => (s + 1) % SCENE_LABELS.length),
      ROTATE_SECONDS * 1000
    );
    return clearTimer;
  }, [scene, rotating]);

  const wrap = (i: number) =>
    ((i % SCENE_LABELS.length) + SCENE_LABELS.length) % SCENE_LABELS.length;

  const goTo = useCallback((i: number) => setScene(wrap(i)), []);

  // Functional update: several arrow presses inside one frame must each
  // advance a step rather than all resolving against the same stale scene.
  const step = useCallback((delta: number) => setScene((s) => wrap(s + delta)), []);

  const toggleTheme = useCallback(() => {
    setMode((m) => {
      const next: TvMode = m === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* storage blocked — the toggle still applies for this session */
      }
      return next;
    });
  }, []);

  /* ── Keyboard control ─────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
          step(1);
          break;
        case "ArrowLeft":
          step(-1);
          break;
        case " ":
          e.preventDefault();
          setRotating((r) => !r);
          break;
        case "t":
        case "T":
          toggleTheme();
          break;
        case "f":
        case "F":
          if (document.fullscreenElement) document.exitFullscreen?.();
          else document.documentElement.requestFullscreen?.().catch(() => {});
          break;
        case "Escape":
          if (!document.fullscreenElement) navigate("/dashboard");
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, toggleTheme, navigate]);

  /* ── Summary banner ───────────────────────────────────────────── */
  const alerts = tv?.alerts ?? [];
  const hasAlerts = alerts.length > 0;
  const banner = hasAlerts
    ? {
        bg: A.critTint,
        dot: A.red,
        color: A.red,
        headline: `Attention — ${alerts[0].text}`,
        sub: `${alerts.length} item${alerts.length > 1 ? "s" : ""} flagged for management review`,
      }
    : {
        bg: A.okTint,
        dot: A.green,
        color: A.green,
        headline: "All systems on track",
        sub: "No critical exceptions across production, sales, inventory or finance",
      };

  /* ── Ticker ───────────────────────────────────────────────────── */
  const ticker = tv
    ? [
        tv.sales ? `Sales ${tv.sales.todayLabel}` : null,
        `Production ${tv.production.achievement}%`,
        `Orders ${tv.orders.total}${tv.orders.delayed ? ` (${tv.orders.delayed} delayed)` : ""}`,
        tv.finance ? `Receivable ${tv.finance.receivableLabel}` : null,
        accounts ? `Payable ${inrCompact(accounts.totalPayable)}` : null,
        accounts
          ? `Cash + bank ${inrCompact(
              Number(accounts.totalCashInHand || 0) + Number(accounts.totalBankBalance || 0)
            )}`
          : null,
        `Inventory ${tv.inventory.healthyPct}% healthy`,
      ]
        .filter(Boolean)
        .join("   ·   ")
    : "Loading live data…";

  const pill = (active: boolean): React.CSSProperties => ({
    padding: `${u(8)} ${u(16)}`,
    borderRadius: u(999),
    background: active ? A.accentBg : "transparent",
    color: active ? A.accentText : T.textDim,
  });

  const chrome: React.CSSProperties = {
    background: T.panel,
    border: `${u(1)} solid ${T.panelBorder}`,
    boxShadow: T.panelShadow,
    borderRadius: u(999),
  };

  const scenePad = `${u(18)} ${u(32)} ${u(16)}`;

  return (
    <div className="tv-root" style={{ background: T.bg, color: T.text } as React.CSSProperties}>
      <div className="tv-board">
        {/* ── HEADER ─────────────────────────────────────────────── */}
        <div
          style={{
            flex: `0 0 ${u(92)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `${u(18)} ${u(32)} 0`,
            gap: u(16),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: u(18), minWidth: 0 }}>
            <div
              aria-hidden="true"
              style={{
                width: u(56),
                height: u(56),
                flex: "0 0 auto",
                borderRadius: u(16),
                background: "var(--color-brand)",
                color: A.accentText,
                boxShadow: `0 ${u(5)} 0 color-mix(in srgb, var(--color-brand) 65%, var(--color-black) 35%)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: u(26),
              }}
            >
              S
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: u(30),
                  fontWeight: 400,
                  letterSpacing: "-0.02em",
                  color: T.textDim,
                  whiteSpace: "nowrap",
                  lineHeight: 1.1,
                }}
              >
                Shiftline <strong style={{ fontWeight: 700, color: A.blue }}>Management</strong>
              </div>
              <div
                style={{
                  display: "inline-flex",
                  marginTop: u(6),
                  fontSize: u(15),
                  fontWeight: 600,
                  color: T.badgeText,
                  background: T.badgeBg,
                  padding: `${u(3)} ${u(14)}`,
                  borderRadius: u(999),
                }}
              >
                {SCENE_LABELS[scene]}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: u(14), flex: "0 0 auto" }}>
            <div style={{ textAlign: "right", marginRight: u(6) }}>
              <div style={{ fontSize: u(20), fontWeight: 700 }}>{dateStr}</div>
              <div style={{ fontSize: u(16), color: T.textMute }}>{timeStr}</div>
            </div>

            {/* LIVE / STALE indicator */}
            <div
              title={
                lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Connecting…"
              }
              style={{
                ...chrome,
                display: "flex",
                alignItems: "center",
                gap: u(8),
                padding: `${u(9)} ${u(16)}`,
              }}
            >
              <div
                className={stale ? undefined : "tv-live-dot"}
                style={{
                  width: u(10),
                  height: u(10),
                  borderRadius: "50%",
                  background: stale ? A.amber : A.green,
                }}
              />
              <span style={{ fontSize: u(15), fontWeight: 700 }}>{stale ? "Stale" : "Live"}</span>
            </div>

            {/* Theme toggle */}
            <div
              onClick={toggleTheme}
              role="button"
              tabIndex={0}
              aria-label={`Switch to ${theme.isDark ? "light" : "dark"} theme (T)`}
              onKeyDown={(e) => e.key === "Enter" && toggleTheme()}
              style={{
                ...chrome,
                display: "flex",
                padding: u(4),
                cursor: "pointer",
                fontSize: u(14),
                fontWeight: 600,
              }}
            >
              <div style={pill(theme.isDark)}>Dark</div>
              <div style={pill(!theme.isDark)}>Light</div>
            </div>

            {/* Exit — a full-screen route needs a visible way back. */}
            <div
              onClick={() => navigate("/dashboard")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && navigate("/dashboard")}
              title="Back to the regular dashboard (Esc)"
              style={{
                ...chrome,
                cursor: "pointer",
                fontSize: u(14),
                fontWeight: 600,
                padding: `${u(12)} ${u(18)}`,
                color: T.text,
              }}
            >
              Exit
            </div>
          </div>
        </div>

        {/* ── SUMMARY BANNER ─────────────────────────────────────── */}
        <div style={{ flex: "0 0 auto", padding: `${u(16)} ${u(32)} 0` }}>
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: u(14),
              padding: `${u(12)} ${u(22)}`,
              background: banner.bg,
              borderRadius: u(999),
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: u(12),
                height: u(12),
                borderRadius: "50%",
                background: banner.dot,
                flex: "0 0 auto",
              }}
            />
            <div
              style={{
                fontSize: u(19),
                fontWeight: 700,
                color: banner.color,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: "0 1 auto",
              }}
            >
              {banner.headline}
            </div>
            <div
              style={{
                fontSize: u(16),
                color: T.textDim,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: "0 1 auto",
              }}
            >
              {banner.sub}
            </div>
          </div>
        </div>

        {/* ── SCENES ─────────────────────────────────────────────── */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {!tv ? (
            <div
              className="tv-scene"
              style={{
                padding: scenePad,
                alignItems: "center",
                justifyContent: "center",
                gap: u(10),
              }}
            >
              <div style={{ fontSize: u(30), fontWeight: 700, color: T.textDim }}>
                {loading ? "Loading live data…" : "Data unavailable"}
              </div>
              {!loading && (
                <div style={{ fontSize: u(18), color: T.textMute }}>
                  Retrying automatically — check the API connection
                </div>
              )}
            </div>
          ) : (
            <div className="tv-scene" style={{ padding: scenePad, gap: u(16) }}>
              {scene === 0 && <SceneOverview theme={theme} tv={tv} accounts={accounts} />}
              {scene === 1 && <SceneProduction theme={theme} tv={tv} />}
              {scene === 2 &&
                (hasMoney(tv) ? (
                  <SceneSales theme={theme} tv={tv} />
                ) : (
                  <RestrictedScene theme={theme} label="Sales and orders" />
                ))}
              {scene === 3 &&
                (hasMoney(tv) ? (
                  <SceneInventoryFinance theme={theme} tv={tv} accounts={accounts} />
                ) : (
                  <RestrictedScene theme={theme} label="Inventory and finance" />
                ))}
              {scene === 4 && <SceneFieldSales theme={theme} />}
            </div>
          )}
        </div>

        {/* ── FOOTER ─────────────────────────────────────────────── */}
        <div
          style={{
            flex: `0 0 ${u(52)}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: `0 ${u(32)} ${u(8)}`,
            gap: u(24),
          }}
        >
          <div style={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
            <div className="tv-ticker" style={{ fontSize: u(16), color: T.textDim }}>
              {ticker} &nbsp;&nbsp;&nbsp;·&nbsp;&nbsp;&nbsp; {ticker}
            </div>
          </div>

          <div style={{ display: "flex", gap: u(8), flex: "0 0 auto" }}>
            {SCENE_LABELS.map((label, i) => (
              <div
                key={label}
                onClick={() => goTo(i)}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-current={scene === i ? "true" : undefined}
                onKeyDown={(e) => e.key === "Enter" && goTo(i)}
                style={{
                  width: scene === i ? u(40) : u(12),
                  height: u(12),
                  borderRadius: u(999),
                  background: scene === i ? A.accentBg : T.dotInactive,
                  cursor: "pointer",
                  transition: "width 300ms ease",
                }}
              />
            ))}
          </div>

          <div
            onClick={() => setRotating((r) => !r)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setRotating((r) => !r)}
            title="Toggle auto-rotate (Space)"
            style={{
              fontSize: u(14),
              color: T.textMute,
              flex: "0 0 auto",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Auto-rotate {rotating ? `on · ${ROTATE_SECONDS}s` : "off"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TvDashboard;
