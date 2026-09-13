import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FaMapMarkerAlt, FaCrosshairs, FaCompress, FaExpand, FaSyncAlt } from "react-icons/fa";
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

/** Socket payload for agentPosition:updated (see mobile.position.service.ts). */
interface PositionEvent {
  agentUserId: string;
  deviceId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  batteryPct: number | null;
  recordedAt: string;
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
    const onPosition = (p: PositionEvent) => {
      setAgents((prev) => {
        const idx = prev.findIndex((a) => a.agentUserId === p.agentUserId);
        if (idx === -1) {
          // New agent: fetch the full row (name, counters) instead of guessing.
          void load();
          return prev;
        }
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          deviceId: p.deviceId,
          latitude: p.latitude,
          longitude: p.longitude,
          speedKmh: p.speedKmh,
          batteryPct: p.batteryPct,
          recordedAt: p.recordedAt,
          receivedAt: new Date().toISOString(),
        };
        return next;
      });
    };
    socket.on("agentPosition:updated", onPosition);
    return () => {
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
        initials: initialsOf(a.agentName),
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
              <p class="text-[9px] font-bold leading-none">${agent.agentName}</p>
              <p class="text-[8px] font-medium opacity-80">${agoLabel(agent.recordedAt, now)}</p>
            </div>
          </div>`,
      });
      const marker = L.marker([agent.latitude, agent.longitude], { icon }).addTo(map);
      marker.bindTooltip(
        `<div class="text-[11px]"><strong>${agent.agentName}</strong><br/>` +
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

  return (
    <div
      className={`bg-card border border-line-soft rounded-lg flex flex-col overflow-hidden relative transition-all duration-300 ${
        isFullscreen ? "fixed inset-3 z-50" : "h-full min-h-0"
      }`}
    >
      {/* ── CARD HEADER ────────────────────────────────────── */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-line-soft bg-card-2/60 flex items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-sm border border-line text-ink-subtle shrink-0">
            <FaMapMarkerAlt className="text-xs" />
          </div>
          <div className="text-[12px] uppercase tracking-wider font-extrabold text-ink truncate">
            Field Team Map
          </div>
          <span className="inline-flex items-center gap-1 text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-card-2 text-ink-subtle border border-line-soft uppercase tracking-wider shrink-0">
            {liveCount} Live · {decorated.length} Seen today
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => void load()}
            title="Refresh positions"
            className="p-1.5 rounded-lg bg-card-2 hover:bg-card text-ink-muted hover:text-ink border border-line-soft transition-colors cursor-pointer"
          >
            <FaSyncAlt className={`text-xs ${loading ? "animate-spin" : ""}`} />
          </button>
          <div className="flex items-center bg-card-2 p-0.5 rounded-lg border border-line-soft gap-0.5">
            {(
              [
                { key: "theme_default", label: "Street Map" },
                { key: "satellite", label: "Satellite" },
              ] as { key: TileLayerType; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTileLayerType(key)}
                className={`px-2 py-0.5 rounded-sm text-[9.5px] font-bold transition-all cursor-pointer ${
                  tileLayerType === key
                    ? "bg-accent text-white"
                    : "text-ink-muted hover:text-ink hover:bg-card"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleFitAll}
            title="Show every agent"
            className="p-1.5 rounded-lg bg-card-2 hover:bg-card text-ink-muted hover:text-ink border border-line-soft transition-colors cursor-pointer"
          >
            <FaCrosshairs className="text-xs" />
          </button>
          <button
            type="button"
            onClick={() => {
              setIsFullscreen(!isFullscreen);
              setTimeout(() => mapInstanceRef.current?.invalidateSize(), 300);
            }}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Map"}
            className="p-1.5 rounded-lg bg-card-2 hover:bg-card text-ink-muted hover:text-ink border border-line-soft transition-colors cursor-pointer"
          >
            {isFullscreen ? <FaCompress className="text-xs" /> : <FaExpand className="text-xs" />}
          </button>
        </div>
      </div>

      {/* ── MAP CANVAS & OVERLAYS ────────────────────────────── */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden flex">
        <div
          ref={mapContainerRef}
          className={`w-full h-full z-0 bg-page ${
            mode === "dark" && tileLayerType === "theme_default" ? "map-tiles-dark" : ""
          }`}
          style={
            mode === "dark" && tileLayerType === "theme_default"
              ? { filter: "brightness(0.82) invert(92%) hue-rotate(180deg) contrast(1.15)" }
              : {}
          }
        />

        {/* Empty / error state: never invent positions. */}
        {!loading && (error || decorated.length === 0) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto max-w-xs text-center bg-card/95 backdrop-blur-md border border-line-soft rounded-lg px-4 py-3">
              <p className="text-[12px] font-bold text-ink">
                {error ? "Positions unavailable" : "No field positions yet"}
              </p>
              <p className="text-[10.5px] text-ink-muted mt-1">
                {error ??
                  "Agents appear here as soon as the Field app sends GPS. Positions are kept for 90 days by default."}
              </p>
            </div>
          </div>
        )}

        {/* Agent chips */}
        <div className="absolute top-2.5 left-2.5 z-10 flex flex-wrap items-center gap-1.5 max-w-[calc(100%-120px)]">
          {decorated.map((agent) => {
            const isSelected = agent.agentUserId === selectedId;
            return (
              <button
                key={agent.agentUserId}
                type="button"
                onClick={() => handleSelect(agent)}
                title={`${agent.agentName} · ${agoLabel(agent.recordedAt, now)}`}
                className={`px-2.5 py-1 rounded-lg backdrop-blur-md text-[10px] font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? "bg-accent text-white border-accent"
                    : "bg-card/90 text-ink border-line-soft hover:bg-card hover:border-accent/40"
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    agent.freshness === "live"
                      ? "bg-[color:var(--color-success)]"
                      : agent.freshness === "recent"
                        ? "bg-[color:var(--color-warning)]"
                        : "bg-ink-subtle"
                  }`}
                />
                <span>{agent.agentName}</span>
                <span className="text-[9px] opacity-75 font-normal">
                  {agent.today.completedVisits}/{agent.today.plannedVisits} visits
                </span>
              </button>
            );
          })}
        </div>

        {/* Zoom */}
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => mapInstanceRef.current?.zoomIn()}
            className="w-7 h-7 rounded-lg bg-card/90 hover:bg-card text-ink border border-line-soft flex items-center justify-center text-sm font-bold backdrop-blur-md cursor-pointer transition-colors"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => mapInstanceRef.current?.zoomOut()}
            className="w-7 h-7 rounded-lg bg-card/90 hover:bg-card text-ink border border-line-soft flex items-center justify-center text-sm font-bold backdrop-blur-md cursor-pointer transition-colors"
          >
            −
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-2.5 left-2.5 bg-card/90 backdrop-blur-md rounded-lg px-3 py-1.5 border border-line-soft flex items-center gap-3 text-[10px] text-ink z-10">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-success)] animate-pulse" />
            <span>{liveCount} Live (≤5 min)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[color:var(--color-warning)]" />
            <span>{recentCount} Recent (≤30 min)</span>
          </div>
          {selected && (
            <span className="text-[10px] text-accent font-semibold border-l border-line-soft pl-2.5">
              📍 {selected.agentName}: {selected.today.orders} orders · ₹
              {selected.today.collectedAmount.toLocaleString("en-IN")} collected ·{" "}
              {agoLabel(selected.recordedAt, now)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
