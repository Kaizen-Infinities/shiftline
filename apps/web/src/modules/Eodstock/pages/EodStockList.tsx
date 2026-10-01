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
import { useT } from "../../../i18n/I18nProvider";
import type { MessageKey } from "../../../i18n/en";

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

const CATEGORY_KEYS: Record<EodCategory, MessageKey> = {
  RAW_MATERIAL: "eod.cat.raw",
  FINISHED_PRODUCT: "eod.cat.finished",
  WASTAGE: "eod.cat.wastage",
};

const CATEGORY_TONES: Record<EodCategory, ChipTone> = {
  RAW_MATERIAL: "success",
  FINISHED_PRODUCT: "default",
  WASTAGE: "warning",
};

const CategoryBadge: React.FC<{ category: EodCategory }> = ({ category }) => {
  const { t } = useT();
  return (
    <Chip size="sm" tone={CATEGORY_TONES[category] ?? "muted"} className="whitespace-nowrap">
      {CATEGORY_KEYS[category] ? t(CATEGORY_KEYS[category]) : category}
    </Chip>
  );
};

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
  <div
    role="status"
    className="sl-tile mb-4 flex items-center gap-3 px-4 py-3 text-sm text-ink-muted"
  >
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
  const { t } = useT();
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
    if (isFuture) return t("eod.future");
    const date = formatDate(selectedDate);
    const filteredOut = Boolean(categoryFilter || storeIdFilter);
    if (!isTodaySelected) {
      return filteredOut ? t("eod.emptyFilteredOn", { date }) : t("eod.emptyOn", { date });
    }
    return filteredOut ? t("eod.emptyFiltered") : t("eod.loadingLive");
  }, [categoryFilter, storeIdFilter, selectedDate, isFuture, isTodaySelected, t]);

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
          <span className="font-semibold text-ink">{t("eod.liveView")}</span> — {t("eod.liveHelp")}{" "}
          <span className="text-xs text-ink-subtle">{t("eod.autoRefresh")}</span>
        </Notice>
      );
    }
    if (isTodaySelected && isLocked) {
      return (
        <Notice tone="success" icon={<Lock size={14} />}>
          {t("eod.todayLockedAt")}{" "}
          <span className="font-semibold text-ink">{formatDateTime(lastLockedAt!)}</span>
        </Notice>
      );
    }
    if (!isTodaySelected && isLocked) {
      return (
        <Notice tone="muted" icon={<Lock size={14} />}>
          {t("eod.lockedAt")}{" "}
          <span className="font-semibold text-ink">{formatDateTime(lastLockedAt!)}</span>
        </Notice>
      );
    }
    if (!isTodaySelected && !isLocked && data.length === 0 && !loading) {
      return (
        <Notice tone="warning" icon={<Info size={15} />}>
          {t("eod.noSnapshot")}{" "}
          <span className="font-semibold text-ink">{formatDate(selectedDate)}</span>
        </Notice>
      );
    }
    if (isFuture) {
      return (
        <Notice tone="muted" icon={<Info size={15} />}>
          {t("eod.future")}
        </Notice>
      );
    }
    return (
      <Notice tone="info" icon={<Info size={15} />}>
        {t("eod.showingFor")}{" "}
        <span className="font-semibold text-ink">
          {asOf ? formatDate(asOf) : formatDate(selectedDate)}
        </span>
      </Notice>
    );
  };

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={t("eod.title")}
        subtitle={t("eod.subtitle")}
        icon={<CalendarClock size={22} />}
        meta={
          isTodaySelected && isLive ? (
            <Chip size="sm" tone="success" dot>
              {t("shell.live")}
            </Chip>
          ) : isLocked ? (
            <Chip size="sm" tone="muted" icon={<Lock size={11} />}>
              {t("eod.locked")}
            </Chip>
          ) : undefined
        }
        actions={
          can("eod-stock.export") || can("inventory.export") ? (
            <ExportCSVButton
              data={data}
              columns={csvColumns}
              filename={`eod-stock-${selectedDate}.csv`}
              text={t("common.export")}
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
        searchPlaceholder={t("eod.searchPlaceholder")}
        searchLabel={t("eod.searchLabel")}
        filters={[
          { key: "", label: t("common.all") },
          { key: "RAW_MATERIAL", label: t("eod.cat.raw") },
          { key: "FINISHED_PRODUCT", label: t("eod.cat.finished") },
          { key: "WASTAGE", label: t("eod.cat.wastage") },
        ]}
        filterValue={categoryFilter}
        onFilterChange={(key) => {
          setCategoryFilter(key);
          setCurrentPage(1);
        }}
        filtersLabel={t("stock.category")}
        right={
          <>
            <div className="w-full sm:w-48">
              <SelectInput
                value={storeIdFilter}
                defaultOptionLabel={t("eod.allStores")}
                options={stores.map((s) => ({ label: s.storeName, value: s.storeId }))}
                hideLabel
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
                placeholder={t("dispatch.selectDate")}
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
                {t("eod.today")}
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
        ariaLabel={t("eod.title")}
        emptyMessage={emptyMessage}
        columns={[
          {
            header: t("eod.item"),
            render: (item) => (
              <div className="flex min-w-0 flex-col">
                <span className="font-semibold text-ink">{item.itemName}</span>
                <span className="font-mono text-xs text-ink-subtle">{item.itemCode}</span>
              </div>
            ),
          },
          {
            header: t("stock.category"),
            render: (item) => <CategoryBadge category={item.category} />,
          },
          {
            header: t("common.store"),
            render: (item) => <span className="text-ink-muted">{getStoreName(item.storeId)}</span>,
          },
          {
            header: t("eod.startQty"),
            align: "right",
            render: (item) => (
              <span className="tabular-nums text-ink-muted">
                {formatQty(item.startQty, item.uom)}
              </span>
            ),
          },
          {
            header: isTodaySelected && isLive ? t("eod.currentQty") : t("eod.eodQty"),
            align: "right",
            render: (item) => (
              <span className="flex items-center justify-end gap-1.5 font-semibold tabular-nums text-ink">
                {formatQty(item.eodQty, item.uom)}
                {item.recordedAt !== null && (
                  <span title={t("eod.lockedAtTime", { time: formatDateTime(item.recordedAt) })}>
                    <Lock size={11} className="text-ink-subtle" aria-label={t("eod.locked")} />
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
