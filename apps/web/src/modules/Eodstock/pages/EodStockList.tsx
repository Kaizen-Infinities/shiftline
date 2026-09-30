import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";
import DataTable from "../../../components/ui/table/DataTable";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { storeService } from "../../../services/storeService";
import { formatDate, formatDateTime } from "../../../utils/dateUtils";
import { toast } from "react-toastify";
import { useSocket } from "../../../providers/SocketProvider";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchEodStock } from "../../../features/eod-stock/eodStockSlice";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { usePermission } from "../../../hooks/usePermission";
import type { EodCategory, EodStockItem } from "../../../services/eodStockService";
import { CalendarClock, Info, Lock, Radio } from "lucide-react";
import { ActionPill, Chip, PageHeader, Toolbar, type ChipTone } from "../../../components/ui/v2";

const ITEMS_PER_PAGE = 20;
const LIVE_POLL_INTERVAL_MS = 30_000;

const getISTDateString = (d: Date = new Date()): string => {
  const ist = d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const dt = new Date(ist);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

const formatUom = (uom: string | null): string => {
  if (!uom) return "";
  const first = uom.split(",")[0].trim().toLowerCase();
  if (["ea", "each", "piece", "pcs"].includes(first)) return "pcs";
  return uom.split(",")[0].trim();
};

const formatQty = (qty: number | null, uom: string | null): string => {
  if (qty === null || qty === undefined) return "—";
  const u = formatUom(uom);
  return u ? `${qty.toLocaleString("en-IN")} ${u}` : qty.toLocaleString("en-IN");
};

const CATEGORY_LABELS: Record<EodCategory, string> = {
  RAW_MATERIAL: "Raw Material",
  FINISHED_PRODUCT: "Finished Product",
  WASTAGE: "Wastage",
};

const CATEGORY_TONES: Record<EodCategory, ChipTone> = {
  RAW_MATERIAL: "success",
  FINISHED_PRODUCT: "default",
  WASTAGE: "warning",
};

const CategoryBadge: React.FC<{ category: EodCategory }> = ({ category }) => (
  <Chip size="sm" tone={CATEGORY_TONES[category] ?? "muted"} className="whitespace-nowrap">
    {CATEGORY_LABELS[category] ?? category}
  </Chip>
);

type NoticeTone = "info" | "success" | "warning" | "muted";
const NOTICE_TONE: Record<NoticeTone, string> = {
  info: "text-[color:var(--color-info)]",
  success: "text-[color:var(--color-success)]",
  warning: "text-[color:var(--color-warning)]",
  muted: "text-ink-subtle",
};

/** One-line status notice in a tile above the table. */
const Notice: React.FC<{ tone: NoticeTone; icon: React.ReactNode; children: React.ReactNode }> = ({
  tone,
  icon,
  children,
}) => (
  <div role="status" className="sl-tile flex items-center gap-3 px-4 py-3 text-sm text-ink-muted">
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chip ${NOTICE_TONE[tone]}`}
      aria-hidden="true"
    >
      {icon}
    </span>
    <span className="min-w-0">{children}</span>
  </div>
);

const EodStockList: React.FC = () => {
  const { socket } = useSocket();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  // ── Redux state ─────────────────────────────────────────────────────────────
  const { data, loading, error, total, asOf } = useAppSelector((state) => state.eodStock);

  // ── Local UI state ───────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [storeIdFilter, setStoreIdFilter] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => getISTDateString());
  const [currentPage, setCurrentPage] = useState(1);
  const [stores, setStores] = useState<any[]>([]);

  // ── Toast on Redux error ─────────────────────────────────────────────────────
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // ── Load stores once ─────────────────────────────────────────────────────────
  const loadStores = useCallback(async () => {
    try {
      const res: any = await storeService.fetchAll();
      const all = res?.stores || res || [];
      setStores(all.filter((s: any) => s.isActive));
    } catch {
      // silent — store list is non-critical
    }
  }, []);

  useEffect(() => {
    loadStores();
  }, [loadStores]);

  // Socket sync: refresh store dropdown when stores change
  useSocketSync("store", undefined, loadStores);

  // ── Debounce search — 300 ms ─────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // ── Dispatch fetch thunk ─────────────────────────────────────────────────────
  const loadData = useCallback(() => {
    dispatch(
      fetchEodStock({
        date: selectedDate,
        category: categoryFilter || undefined,
        storeId: storeIdFilter || undefined,
        search: debouncedSearch || undefined,
        page: currentPage,
        limit: ITEMS_PER_PAGE,
      })
    );
  }, [dispatch, selectedDate, categoryFilter, storeIdFilter, debouncedSearch, currentPage]);

  // Keep a stable ref so the polling interval always calls the latest version
  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  usePageShortcuts({ onRefresh: () => loadData() });

  // Re-fetch whenever filters / date / page change
  useEffect(() => {
    loadData();
  }, [loadData]);

  const todayStr = getISTDateString();
  const isTodaySelected = selectedDate === todayStr;

  // ── Live polling: refresh every 30 s while viewing today ─────────────────────
  useEffect(() => {
    if (!isTodaySelected) return;
    const timer = setInterval(() => {
      loadDataRef.current();
    }, LIVE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isTodaySelected]);

  // ── Socket.IO: real-time refresh on stock-mutating events ────────────────────
  useEffect(() => {
    if (!socket) return;

    const handleStockUpdate = () => {
      if (isTodaySelected) loadDataRef.current();
    };

    const socketEvents = [
      "inventory:stockUpdated",
      "inventorySnapshot:completed",
      "stockAdjustment:created",
      "stockAdjustment:updated",
      "grn:created",
      "grn:updated",
      "salesInvoice:created",
      "salesInvoice:updated",
      "hourlyProduction:created",
      "hourlyProduction:updated",
      // Direct raw-material-stock mutations also affect live EOD qty
      "rawMaterialStock:created",
      "rawMaterialStock:updated",
      "rawMaterialStock:deleted",
    ];

    socketEvents.forEach((evt) => socket.on(evt, handleStockUpdate));
    return () => {
      socketEvents.forEach((evt) => socket.off(evt, handleStockUpdate));
    };
  }, [socket, isTodaySelected]);

  const getStoreName = useCallback(
    (id: string) => stores.find((s) => s.storeId === id)?.storeName || id || "—",
    [stores]
  );

  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

  // Derived view state
  const isLive = data.some((item) => item.recordedAt === null);
  const isLocked = data.length > 0 && data.every((item) => item.recordedAt !== null);
  const lastLockedAt = data.find((item) => item.recordedAt !== null)?.recordedAt ?? null;
  const isFuture = selectedDate > todayStr;

  // ── Empty state message ───────────────────────────────────────────────────────
  const emptyMessage = useMemo(() => {
    if (isFuture) return "Future date — no EOD data available yet.";
    const catLabels: Record<string, string> = {
      RAW_MATERIAL: "Raw Material",
      FINISHED_PRODUCT: "Finished Product",
      WASTAGE: "Wastage",
    };
    const parts: string[] = [];
    if (categoryFilter) parts.push(catLabels[categoryFilter] || categoryFilter);
    if (storeIdFilter) parts.push(`in ${getStoreName(storeIdFilter)}`);
    if (!isTodaySelected) {
      return parts.length
        ? `No ${parts.join(" ")} data recorded for ${formatDate(selectedDate)}.`
        : `No EOD data recorded for ${formatDate(selectedDate)}. The stock snapshot for this date was not captured.`;
    }
    return parts.length ? `No ${parts.join(" ")} stock data found.` : "Loading live stock data…";
  }, [categoryFilter, storeIdFilter, selectedDate, isFuture, isTodaySelected, getStoreName]);

  const csvColumns = [
    { header: "Item Code", accessor: (r: EodStockItem) => r.itemCode },
    { header: "Item Name", accessor: (r: EodStockItem) => r.itemName },
    {
      header: "Category",
      accessor: (r: EodStockItem) =>
        r.category === "RAW_MATERIAL"
          ? "Raw Material"
          : r.category === "FINISHED_PRODUCT"
            ? "Finished Product"
            : "Wastage",
    },
    { header: "Store", accessor: (r: EodStockItem) => getStoreName(r.storeId) },
    { header: "UOM", accessor: (r: EodStockItem) => formatUom(r.uom) },
    { header: "Start Qty", accessor: (r: EodStockItem) => r.startQty },
    {
      header: isTodaySelected && isLive ? "Current Qty (Live)" : "EOD Qty",
      accessor: (r: EodStockItem) => r.eodQty ?? "",
    },
  ];

  // ── Info banner ───────────────────────────────────────────────────────────────
  const renderBanner = () => {
    if (isTodaySelected && isLive) {
      return (
        <Notice tone="info" icon={<Radio size={15} />}>
          <span className="font-semibold text-ink">Live view</span> — Start qty = day opening
          balance · Current qty = current live stock{" "}
          <span className="text-xs text-ink-subtle">(auto-refreshes every 30 s)</span>
        </Notice>
      );
    }
    if (isTodaySelected && isLocked) {
      return (
        <Notice tone="success" icon={<Lock size={14} />}>
          Today's stock locked as of{" "}
          <span className="font-semibold text-ink">{formatDateTime(lastLockedAt!)}</span>
        </Notice>
      );
    }
    if (!isTodaySelected && isLocked) {
      return (
        <Notice tone="muted" icon={<Lock size={14} />}>
          Stock locked as of{" "}
          <span className="font-semibold text-ink">{formatDateTime(lastLockedAt!)}</span>
        </Notice>
      );
    }
    if (!isTodaySelected && !isLocked && data.length === 0 && !loading) {
      return (
        <Notice tone="warning" icon={<Info size={15} />}>
          No EOD snapshot recorded for{" "}
          <span className="font-semibold text-ink">{formatDate(selectedDate)}</span>.
        </Notice>
      );
    }
    if (isFuture) {
      return (
        <Notice tone="muted" icon={<Info size={15} />}>
          Future date — no EOD data available yet.
        </Notice>
      );
    }
    return (
      <Notice tone="info" icon={<Info size={15} />}>
        Showing stock for{" "}
        <span className="font-semibold text-ink">
          {asOf ? formatDate(asOf) : formatDate(selectedDate)}
        </span>
      </Notice>
    );
  };

  return (
    <div className="sl-page min-w-0">
      <PageHeader
        title="EOD Stock"
        subtitle="Opening and end-of-day balance of every item, per store and day"
        icon={<CalendarClock size={22} />}
        meta={
          isTodaySelected && isLive ? (
            <Chip size="sm" tone="success" dot>
              Live
            </Chip>
          ) : isLocked ? (
            <Chip size="sm" tone="muted" icon={<Lock size={11} />}>
              Locked
            </Chip>
          ) : undefined
        }
        actions={
          can("eod-stock.export") || can("inventory.export") ? (
            <ExportCSVButton
              data={data}
              columns={csvColumns}
              filename={`eod-stock-${selectedDate}.csv`}
              text="Export"
            />
          ) : null
        }
      />

      <Toolbar
        searchValue={searchTerm}
        onSearchChange={(value) => {
          setSearchTerm(value);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search item code or name…"
        searchLabel="Search items"
        filters={[
          { key: "", label: "All" },
          { key: "RAW_MATERIAL", label: "Raw Material" },
          { key: "FINISHED_PRODUCT", label: "Finished Product" },
          { key: "WASTAGE", label: "Wastage" },
        ]}
        filterValue={categoryFilter}
        onFilterChange={(key) => {
          setCategoryFilter(key);
          setCurrentPage(1);
        }}
        filtersLabel="Category"
        right={
          <>
            <div className="w-full sm:w-48">
              <SelectInput
                value={storeIdFilter}
                defaultOptionLabel="All Stores"
                options={stores.map((s) => ({ label: s.storeName, value: s.storeId }))}
                hideLabel
                ariaLabel="Store filter"
                noMargin
                onChange={(e) => {
                  setStoreIdFilter(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            <div className="w-full sm:w-44">
              <DatePickerCalendar
                value={selectedDate}
                maxDate={todayStr}
                placeholder="Select date"
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            {!isTodaySelected && (
              <ActionPill
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectedDate(todayStr);
                  setCurrentPage(1);
                }}
              >
                Today
              </ActionPill>
            )}
          </>
        }
      />

      {renderBanner()}

      <DataTable
        data={data}
        loading={loading}
        rowKey={(item) => item.id}
        density="compact"
        ariaLabel="EOD stock"
        emptyMessage={emptyMessage}
        columns={[
          {
            header: "Item",
            render: (item) => (
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold text-ink">{item.itemName}</span>
                <span className="font-mono text-xs text-ink-subtle">{item.itemCode}</span>
              </div>
            ),
          },
          {
            header: "Category",
            render: (item) => <CategoryBadge category={item.category} />,
          },
          {
            header: "Store",
            render: (item) => <span className="text-ink-muted">{getStoreName(item.storeId)}</span>,
          },
          {
            header: "Start qty",
            align: "right",
            render: (item) => (
              <span className="tabular-nums text-ink-muted">
                {formatQty(item.startQty, item.uom)}
              </span>
            ),
          },
          {
            header: isTodaySelected && isLive ? "Current qty" : "EOD qty",
            align: "right",
            render: (item) => (
              <span className="flex items-center justify-end gap-1.5 font-semibold tabular-nums text-ink">
                {formatQty(item.eodQty, item.uom)}
                {item.recordedAt !== null && (
                  <span title={`Locked at ${formatDateTime(item.recordedAt)}`}>
                    <Lock size={11} className="text-ink-subtle" aria-label="Locked" />
                  </span>
                )}
              </span>
            ),
          },
        ]}
        pagination={
          totalPages > 1
            ? {
                currentPage,
                totalPages,
                onPageChange: (p) => setCurrentPage(p),
              }
            : undefined
        }
      />
    </div>
  );
};

export default EodStockList;
