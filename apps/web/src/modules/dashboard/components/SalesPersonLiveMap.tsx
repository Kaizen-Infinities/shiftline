import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  LuCrosshair,
  LuMapPin,
  LuMaximize2,
  LuMinimize2,
  LuMinus,
  LuPlus,
  LuRefreshCw,
} from "react-icons/lu";
import { useTheme } from "../../../providers/ThemeProvider";
import { useSocket } from "../../../providers/SocketProvider";
import apiClient from "../../../api/apiClient";

/** Latest point per agent as served by GET /api/mobile/admin/positions. */
export interface FieldAgentPosition {
  agentUserId: string;
  agentName: string;
  deviceId: string | null;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  speedKmh: number | null;
  heading: number | null;
  batteryPct: number | null;
  recordedAt: string;
  receivedAt: string;
  today: {
    plannedVisits: number;
    completedVisits: number;
    orders: number;
    collections: number;
    collectedAmount: number;
  };
}

type Freshness = "live" | "recent" | "stale";
type TileLayerType = "theme_default" | "satellite";

const LIVE_MS = 5 * 60 * 1000;
const RECENT_MS = 30 * 60 * 1000;
const REFRESH_MS = 60 * 1000;
const PALETTE = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
];

const freshnessOf = (recordedAt: string, now: number): Freshness => {
  const age = now - new Date(recordedAt).getTime();
  if (age <= LIVE_MS) return "live";
  if (age <= RECENT_MS) return "recent";
  return "stale";
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";

const agoLabel = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/** Names come from user records; never let one become markup inside a Leaflet icon. */
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string
  );

const colorFor = (agentUserId: string) => {
  let h = 0;
  for (const ch of agentUserId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

/**
 * Field team map. Positions come from the Field app's GPS feed
 * (POST /api/mobile/position → agentPosition:updated on the tenant room). No
 * data is invented: with no feed the card says so.
 */
export const SalesPersonLiveMap: React.FC = () => {
  const { mode } = useTheme();
  const { socket } = useSocket();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<{ [id: string]: L.Marker }>({});

  const [agents, setAgents] = useState<FieldAgentPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tileLayerType, setTileLayerType] = useState<TileLayerType>("theme_default");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/mobile/admin/positions", {
        params: { withinMinutes: 24 * 60 },
      });
      setAgents((res.data?.data ?? []) as FieldAgentPosition[]);
      setError(null);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(
        status === 403
          ? "You need the Field App (manage) or dashboard permission to see positions."
          : "Could not load field positions."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load, periodic refresh (counters, stale agents) and a clock for "ago" labels.
  useEffect(() => {
    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(refresh);
      clearInterval(tick);
    };
  }, [load]);

  // Live updates from the tenant room.
  useEffect(() => {
    if (!socket) return;
    // The event carries no coordinates (F04, they would reach every user of the tenant):
    // refetch the positions through the REST API, at most once every few seconds.
    let last = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onPosition = () => {
      const wait = Math.max(0, last + 3000 - Date.now());
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        void load();
      }, wait);
    };
    socket.on("agentPosition:updated", onPosition);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off("agentPosition:updated", onPosition);
    };
  }, [socket, load]);

  const getLayerUrl = (layerType: TileLayerType) =>
    layerType === "satellite"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  // 1. Initialise Leaflet
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    const map = L.map(mapContainerRef.current, {
      center: [20.5937, 78.9629], // India; fitBounds moves it once positions arrive
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    });
    tileLayerRef.current = L.tileLayer(getLayerUrl("theme_default"), {
      maxZoom: 19,
      subdomains: "abc",
    }).addTo(map);
    mapInstanceRef.current = map;
    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Layer switching
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    tileLayerRef.current = L.tileLayer(getLayerUrl(tileLayerType), {
      maxZoom: 19,
      subdomains: "abc",
    }).addTo(map);
  }, [tileLayerType]);

  const decorated = useMemo(
    () =>
      agents.map((a) => ({
        ...a,
        freshness: freshnessOf(a.recordedAt, now),
        initials: escapeHtml(initialsOf(a.agentName)),
        safeName: escapeHtml(a.agentName),
        color: colorFor(a.agentUserId),
      })),
    [agents, now]
  );

  const handleSelect = useCallback((agent: FieldAgentPosition) => {
    setSelectedId(agent.agentUserId);
    mapInstanceRef.current?.flyTo([agent.latitude, agent.longitude], 13, { duration: 1.1 });
  }, []);

  // 3. Markers
  const fittedOnce = useRef(false);
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};
    for (const agent of decorated) {
      const isSelected = agent.agentUserId === selectedId;
      const isLive = agent.freshness === "live";
      const dot =
        agent.freshness === "live"
          ? "bg-[color:var(--color-success)] animate-pulse"
          : agent.freshness === "recent"
            ? "bg-[color:var(--color-warning)]"
            : "bg-ink-subtle";
      const icon = L.divIcon({
        className: "custom-leaflet-marker",
        iconSize: [44, 52],
        iconAnchor: [22, 50],
        html: `
          <div class="relative flex flex-col items-center cursor-pointer select-none">
            ${
              isLive
                ? `<div class="absolute -top-1 w-10 h-10 rounded-full animate-ping opacity-30" style="background-color: ${agent.color}"></div>`
                : ""
            }
            <div class="relative z-10 w-9 h-9 rounded-full border-[2.5px] ${
              isSelected ? "border-card ring-4 ring-[color:var(--color-accent)]/60" : "border-card"
            } flex items-center justify-center" style="background-color: ${agent.color}">
              <span class="text-white text-[10px] font-bold tracking-tight leading-none">${agent.initials}</span>
              <span class="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full ${dot} border-2 border-card"></span>
            </div>
            <div class="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-card -mt-[1px]"></div>
            <div class="mt-0.5 px-2 py-0.5 rounded-md bg-card/95 text-ink border border-line-soft backdrop-blur-md text-center whitespace-nowrap">
              <p class="text-[9px] font-bold leading-none">${agent.safeName}</p>
              <p class="text-[8px] font-medium opacity-80">${agoLabel(agent.recordedAt, now)}</p>
            </div>
          </div>`,
      });
      const marker = L.marker([agent.latitude, agent.longitude], { icon }).addTo(map);
      marker.bindTooltip(
        `<div class="text-[11px]"><strong>${agent.safeName}</strong><br/>` +
          `Visits ${agent.today.completedVisits}/${agent.today.plannedVisits} · Orders ${agent.today.orders} · ` +
          `Collected ₹${agent.today.collectedAmount.toLocaleString("en-IN")}<br/>` +
          `<span class="opacity-70">${agoLabel(agent.recordedAt, now)}${
            agent.batteryPct != null ? ` · 🔋 ${agent.batteryPct}%` : ""
          }</span></div>`,
        { direction: "top", offset: [0, -46] }
      );
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        handleSelect(agent);
      });
      markersRef.current[agent.agentUserId] = marker;
    }

    if (!fittedOnce.current && decorated.length > 0) {
      fittedOnce.current = true;
      const group = L.featureGroup(Object.values(markersRef.current));
      map.fitBounds(group.getBounds().pad(0.3), { maxZoom: 12 });
    }
  }, [decorated, selectedId, mode, now, handleSelect]);

  const handleFitAll = () => {
    setSelectedId(null);
    const map = mapInstanceRef.current;
    if (!map || decorated.length === 0) return;
    const group = L.featureGroup(Object.values(markersRef.current));
    map.fitBounds(group.getBounds().pad(0.2), { duration: 1 });
  };

  const liveCount = decorated.filter((a) => a.freshness === "live").length;
  const recentCount = decorated.filter((a) => a.freshness === "recent").length;
  const selected = decorated.find((a) => a.agentUserId === selectedId);

  const iconBtn =
    "grid h-8 w-8 place-items-center rounded-full border border-line-soft bg-card text-ink-muted shadow-[var(--shadow-sm)] transition-colors hover:bg-card-2 hover:text-ink";

  return (
    <section
      aria-labelledby="dash-field-map"
      className={`sl-tile relative flex flex-col overflow-hidden transition-all duration-300 ${
        isFullscreen ? "fixed inset-3 z-50" : "h-full min-h-0"
      }`}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="z-20 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-5 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-chip text-accent"
          >
            <LuMapPin className="text-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 id="dash-field-map" className="sl-h2 truncate text-[15px] leading-tight">
              Field team map
            </h2>
            <p className="sl-muted mt-0.5 truncate text-xs">
              {liveCount} live · {decorated.length} seen today
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div
            role="group"
            aria-label="Map style"
            className="inline-flex items-center gap-1 rounded-full border border-line-soft bg-card p-1 shadow-[var(--shadow-sm)]"
          >
            {(
              [
                { key: "theme_default", label: "Street" },
                { key: "satellite", label: "Satellite" },
              ] as { key: TileLayerType; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={tileLayerType === key}
                onClick={() => setTileLayerType(key)}
                className={`sl-chip cursor-pointer px-2.5 py-1 text-xs ${
                  tileLayerType === key ? "" : "bg-transparent text-ink-muted hover:bg-card-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh positions"
            title="Refresh positions"
            className={iconBtn}
          >
            <LuRefreshCw
              aria-hidden="true"
              className={loading ? "animate-spin motion-reduce:animate-none" : ""}
            />
          </button>
          <button
            type="button"
            onClick={handleFitAll}
            aria-label="Show every agent"
            title="Show every agent"
            className={iconBtn}
          >
            <LuCrosshair aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsFullscreen(!isFullscreen);
              setTimeout(() => mapInstanceRef.current?.invalidateSize(), 300);
            }}
            aria-label={isFullscreen ? "Exit full screen" : "Full-screen map"}
            title={isFullscreen ? "Exit full screen" : "Full-screen map"}
            className={iconBtn}
          >
            {isFullscreen ? <LuMinimize2 aria-hidden="true" /> : <LuMaximize2 aria-hidden="true" />}
          </button>
        </div>
      </header>

      {/* ── Map canvas and overlays ─────────────────────────────── */}
      <div className="relative mx-3 mb-3 flex min-h-0 flex-1 overflow-hidden rounded-[14px]">
        <div
          ref={mapContainerRef}
          // Only the street tiles are darkened in dark mode (see style.css, "UI v2 — dashboard");
          // markers and labels keep their real colours.
          className={`sl-dash-map z-0 h-full w-full ${
            mode === "dark" && tileLayerType === "theme_default" ? "sl-dash-map-dark" : ""
          }`}
        />

        {/* Empty / error state: never invent positions. */}
        {!loading && (error || decorated.length === 0) && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="sl-tile pointer-events-auto max-w-xs px-5 py-4 text-center">
              <span
                aria-hidden="true"
                className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-chip text-accent"
              >
                <LuMapPin />
              </span>
              <p className="text-sm font-semibold text-ink">
                {error ? "Positions unavailable" : "No field positions yet"}
              </p>
              <p className="sl-muted mt-1 text-xs leading-relaxed">
                {error ??
                  "Agents appear here as soon as the Field app sends GPS. Positions are kept for 90 days by default."}
              </p>
            </div>
          </div>
        )}

        {/* Agent chips */}
        <div className="absolute top-2.5 left-2.5 z-10 flex max-w-[calc(100%-64px)] flex-wrap items-center gap-1.5">
          {decorated.map((agent) => {
            const isSelected = agent.agentUserId === selectedId;
            return (
              <button
                key={agent.agentUserId}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelect(agent)}
                title={`${agent.agentName} · ${agoLabel(agent.recordedAt, now)}`}
                className={`sl-chip cursor-pointer shadow-[var(--shadow-sm)] ${
                  isSelected ? "" : "bg-card text-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    agent.freshness === "live"
                      ? "bg-[color:var(--color-success)]"
                      : agent.freshness === "recent"
                        ? "bg-[color:var(--color-warning)]"
                        : "bg-ink-subtle"
                  }`}
                />
                <span>{agent.agentName}</span>
                <span className="text-[11px] font-normal opacity-75">
                  {agent.today.completedVisits}/{agent.today.plannedVisits} visits
                </span>
              </button>
            );
          })}
        </div>

        {/* Zoom */}
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col gap-1.5">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => mapInstanceRef.current?.zoomIn()}
            className={iconBtn}
          >
            <LuPlus aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => mapInstanceRef.current?.zoomOut()}
            className={iconBtn}
          >
            <LuMinus aria-hidden="true" />
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-2.5 left-2.5 z-10 flex max-w-[calc(100%-20px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-line-soft bg-card px-3.5 py-1.5 text-[11px] text-ink shadow-[var(--shadow-sm)]">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-[color:var(--color-success)]"
            />
            {liveCount} live (≤5 min)
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-[color:var(--color-warning)]"
            />
            {recentCount} recent (≤30 min)
          </span>
          {selected && (
            <span className="border-l border-line-soft pl-3 font-semibold text-accent">
              {selected.agentName}: {selected.today.orders} orders · ₹
              {selected.today.collectedAmount.toLocaleString("en-IN")} collected ·{" "}
              {agoLabel(selected.recordedAt, now)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};
