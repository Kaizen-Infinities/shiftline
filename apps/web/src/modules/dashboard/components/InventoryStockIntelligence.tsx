import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  LuChartArea,
  LuChartColumn,
  LuChartPie,
  LuChevronLeft,
  LuChevronRight,
  LuCircleCheck,
  LuLayers,
  LuList,
  LuPackage,
  LuPackageCheck,
  LuPause,
  LuPlay,
  LuRecycle,
  LuRefreshCw,
  LuShoppingBag,
  LuTriangleAlert,
  LuWarehouse,
} from "react-icons/lu";
import { rawMaterialStockService } from "../../../services/rawMaterialStockService";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { finishedGoodsStockService } from "../../../services/finishedGoodsStockService";
import { productService } from "../../../services/productService";
import { usePageSocketSync } from "../../../hooks/usePageSocketSync";
import { DashTile, TileHeader, EmptyState, ChipToggle } from "./DashboardPrimitives";

interface InventoryStockIntelligenceProps {
  rawMaterials?: any[];
  rawMaterialStocks?: any[];
  finishedGoodsStocks?: any[];
  allProducts?: any[];
}

type InventoryTab = "raw" | "finished" | "wastage";

/* Each store keeps one identity colour from the validated chart palette:
   the bars of a store are one measure, so they share it. The share view
   folds everything past the top three into "Other". */
const TAB_COLOR: Record<InventoryTab, string> = {
  raw: "var(--chart-series-1)",
  finished: "var(--chart-series-3)",
  wastage: "var(--chart-series-2)",
};
const SHARE_COLORS = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
];
const ITEMS_PER_PAGE = 7; // Optimal item count for clean, readable charts

// Helper to extract only the single primary UOM and normalize EA -> PCS
const getPrimaryUom = (uomInput: any, defaultUom = "KG"): string => {
  if (!uomInput) return defaultUom;
  if (typeof uomInput === "object") {
    const val = uomInput.code || uomInput.uomCode || uomInput.name || uomInput.uomName;
    return val ? getPrimaryUom(val, defaultUom) : defaultUom;
  }
  let str = String(uomInput).trim();
  if (str.includes(",")) {
    str = str.split(",")[0].trim();
  }
  str = str.toUpperCase();
  if (str === "EA" || str === "EACH") {
    return "PCS";
  }
  return str || defaultUom;
};

// Helper to identify whether an item belongs to Wastage Store
const isWastageItem = (rm: any, name: string): boolean => {
  const nm = (name || "").toLowerCase();
  return (
    rm.itemType === "WASTAGE" ||
    rm.category?.type === "WASTAGE" ||
    rm.category?.name?.toUpperCase() === "WASTAGE" ||
    rm.store?.storeCategory === "WASTAGE" ||
    nm.startsWith("wastage") ||
    nm.includes("wastage") ||
    nm.includes("scrap")
  );
};

// Helper to extract clean category for Raw Materials
const extractRawCategory = (rm: any, name: string): string => {
  if (rm.category?.name) return rm.category.name;
  if (rm.categoryName) return rm.categoryName;
  if (typeof rm.category === "string" && rm.category.trim()) return rm.category;
  if (rm.rawMaterialCategory?.name) return rm.rawMaterialCategory.name;

  const nm = (name || "").toLowerCase();
  if (
    nm.includes("granule") ||
    nm.includes("virgin") ||
    nm.includes("pp") ||
    nm.includes("hd") ||
    nm.includes("lld") ||
    nm.includes("npp")
  ) {
    return "Polymer";
  }
  if (
    nm.includes("masterbatch") ||
    nm.includes("color") ||
    nm.includes("red") ||
    nm.includes("oxide") ||
    nm.includes("titanium")
  ) {
    return "Masterbatch";
  }
  if (
    nm.includes("thread") ||
    nm.includes("yarn") ||
    nm.includes("handle") ||
    nm.includes("wire")
  ) {
    return "Accessory";
  }
  return "Raw Material";
};

// Helper to extract clean category for Finished Products (e.g. Bucket, Container, Lid, Mug)
const extractProductCategory = (p: any, name: string): string => {
  if (p.category?.name) return p.category.name;
  if (p.categoryName) return p.categoryName;
  if (typeof p.category === "string" && p.category.trim()) return p.category;
  if (p.productCategory?.name) return p.productCategory.name;

  const nm = (name || "").toLowerCase();
  if (nm.includes("bucket")) return "Bucket";
  if (nm.includes("container") || nm.includes("box")) return "Container";
  if (nm.includes("lid") || nm.includes("cap")) return "Lid & Cap";
  if (nm.includes("mug") || nm.includes("cup")) return "Mug";
  if (nm.includes("handle")) return "Handle";
  if (nm.includes("basin") || nm.includes("tub")) return "Basin / Tub";
  return "Moulded Product";
};

/** Chart tooltip in theme tokens: item name, then quantity and unit. */
const StockTooltip = ({ active, payload }: any) =>
  active && payload?.length ? (
    <div className="rounded-[12px] border border-line-soft bg-card px-3 py-2 text-xs text-ink shadow-[var(--shadow-md)]">
      <p className="max-w-[200px] truncate font-semibold">
        {payload[0].payload.fullName || payload[0].payload.name}
      </p>
      <p className="text-ink-muted tabular-nums">
        {Number(payload[0].value).toLocaleString("en-IN")} {payload[0].payload.uom || "units"}
      </p>
    </div>
  ) : null;

export const InventoryStockIntelligence: React.FC<InventoryStockIntelligenceProps> = ({
  rawMaterials: initialRawMaterials = [],
  rawMaterialStocks: initialRawStocks = [],
  finishedGoodsStocks: initialFgStocks = [],
  allProducts: initialProducts = [],
}) => {
  const navigate = useNavigate();

  // Load persisted preferences from localStorage
  const [chartType, setChartType] = useState<"bar" | "pie" | "area" | "list">(() => {
    try {
      return (localStorage.getItem("dash_inventory_chart_type") as any) || "bar";
    } catch {
      return "bar";
    }
  });

  const [activeTab, setActiveTab] = useState<InventoryTab>(() => {
    try {
      const saved = localStorage.getItem("dash_inventory_active_tab");
      if (saved === "finished" || saved === "wastage" || saved === "raw") {
        return saved;
      }
      return "raw";
    } catch {
      return "raw";
    }
  });

  // Carousel Batching & Auto-Rotation State
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [isAutoRotating, setIsAutoRotating] = useState<boolean>(true);

  const handleTabChange = (tab: InventoryTab) => {
    setActiveTab(tab);
    setCurrentPage(0);
    try {
      localStorage.setItem("dash_inventory_active_tab", tab);
    } catch {
      // silent
    }
  };

  const handleChartTypeChange = (type: "bar" | "pie" | "area" | "list") => {
    setChartType(type);
    try {
      localStorage.setItem("dash_inventory_chart_type", type);
    } catch {
      // silent
    }
  };

  // Live data states
  const [liveRawMaterials, setLiveRawMaterials] = useState<any[]>(initialRawMaterials);
  const [liveRawStocks, setLiveRawStocks] = useState<any[]>(initialRawStocks);
  const [liveFgStocks, setLiveFgStocks] = useState<any[]>(initialFgStocks);
  const [liveProducts, setLiveProducts] = useState<any[]>(initialProducts);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Prevent concurrent fetches: if a socket event fires while a fetch is
  // in-flight, skip it — the in-flight response is already the freshest data.
  const fetchingRef = useRef(false);

  // Fetch 100% Real Live Data from Backend APIs
  const fetchLiveInventoryData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setIsLoading(true);
      const [rmRes, rmStockRes, fgStockRes, prodRes] = await Promise.allSettled([
        rawMaterialService.fetchAll
          ? rawMaterialService.fetchAll({ limit: 100 })
          : Promise.resolve([]),
        rawMaterialStockService.fetchAll
          ? rawMaterialStockService.fetchAll({ limit: 100 })
          : Promise.resolve([]),
        finishedGoodsStockService.fetchAll
          ? finishedGoodsStockService.fetchAll({ limit: 100 })
          : Promise.resolve([]),
        productService.fetchAll ? productService.fetchAll() : Promise.resolve([]),
      ]);

      if (rmRes.status === "fulfilled" && rmRes.value) {
        const val: any = rmRes.value;
        const data = Array.isArray(val) ? val : val?.rawMaterials || val?.data || [];
        if (data.length > 0) setLiveRawMaterials(data);
      }

      if (rmStockRes.status === "fulfilled" && rmStockRes.value) {
        const val: any = rmStockRes.value;
        const data = Array.isArray(val) ? val : val?.data || val?.stocks || [];
        if (data.length > 0) setLiveRawStocks(data);
      }

      if (fgStockRes.status === "fulfilled" && fgStockRes.value) {
        const val: any = fgStockRes.value;
        const data = Array.isArray(val) ? val : val?.data || val?.finishedGoodsStocks || [];
        if (data.length > 0) setLiveFgStocks(data);
      }

      if (prodRes.status === "fulfilled" && prodRes.value) {
        const val: any = prodRes.value;
        const data = Array.isArray(val) ? val : val?.products || val?.data || [];
        if (data.length > 0) setLiveProducts(data);
      }
    } catch (err) {
      console.warn("Live inventory fetch fallback to props:", err);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchLiveInventoryData();
  }, [fetchLiveInventoryData]);

  // Real-time socket sync — ONE shared 300ms debounce across all 4 modules.
  // Previously 4 separate useSocketSync calls each had their own 50ms timer,
  // so a bulk update could trigger 4 independent refetches. Now they all
  // share one timer: any event resets the window → single fetch at the end.
  usePageSocketSync(
    ["rawMaterialStock", "finishedGoodsStock", "rawMaterial", "product"],
    fetchLiveInventoryData
  );

  // Sync props if parent updates
  useEffect(() => {
    if (initialRawMaterials?.length > 0) setLiveRawMaterials(initialRawMaterials);
  }, [initialRawMaterials]);

  useEffect(() => {
    if (initialProducts?.length > 0) setLiveProducts(initialProducts);
  }, [initialProducts]);

  // 1. Process All Raw Stock Entries (Separating Standard Raw Materials from Wastage Store)
  const { rawStockItems, wastageStockItems } = useMemo(() => {
    const list = liveRawMaterials.length > 0 ? liveRawMaterials : initialRawMaterials;
    if (!Array.isArray(list) || list.length === 0) {
      return { rawStockItems: [], wastageStockItems: [] };
    }

    const rawList: any[] = [];
    const wastageList: any[] = [];

    list.forEach((rm: any, idx: number) => {
      const name =
        rm.materialName ||
        rm.name ||
        rm.itemName ||
        `Item #${rm.rawMaterialId || rm.id || idx + 1}`;
      const rmId = String(rm.rawMaterialId || rm.id || "");
      const isWastage = isWastageItem(rm, name);

      // Sum all store stock entries for this item
      const matchingStocks = liveRawStocks.filter(
        (s: any) =>
          String(s.rawMaterialId) === rmId ||
          String(s.rawMaterial?.rawMaterialId) === rmId ||
          String(s.rawMaterial?.id) === rmId
      );

      let totalStockQty = matchingStocks.reduce(
        (sum: number, s: any) =>
          sum + (Number(s.onHandQty ?? s.currentStock ?? s.quantity ?? 0) || 0),
        0
      );

      if (totalStockQty === 0) {
        totalStockQty =
          Number(rm.onHandQty ?? rm.currentStock ?? rm.totalQuantity ?? rm.quantity ?? 0) || 0;
      }

      const minLevel = Number(
        rm.minimumStock || rm.reorderLevel || rm.minStock || (isWastage ? 100 : 600)
      );
      const unitPrice = Number(
        rm.rate || rm.price || rm.unitPrice || rm.standardCost || (isWastage ? 25 : 85)
      );
      const uom = getPrimaryUom(rm.baseUom || rm.uom || "KG", "KG");
      const isLow = totalStockQty <= minLevel;
      const isCritical = totalStockQty <= minLevel * 0.4;
      const value = totalStockQty * unitPrice;
      const category = isWastage
        ? rm.category?.name || "Plastic Scrap"
        : extractRawCategory(rm, name);

      const processed = {
        id: rmId || idx,
        name,
        type: isWastage ? "Wastage Store" : "Raw Material",
        category,
        isWastage,
        qty: totalStockQty,
        minLevel,
        uom,
        unitPrice,
        value,
        isLow,
        isCritical,
        status: isCritical ? "CRITICAL" : isLow ? "LOW STOCK" : "OPTIMAL",
      };

      if (isWastage) {
        wastageList.push(processed);
      } else {
        rawList.push(processed);
      }
    });

    return { rawStockItems: rawList, wastageStockItems: wastageList };
  }, [liveRawMaterials, initialRawMaterials, liveRawStocks]);

  // 2. Process Finished Goods
  const finishedStockItems = useMemo(() => {
    const list = liveProducts.length > 0 ? liveProducts : initialProducts;
    if (!Array.isArray(list) || list.length === 0) return [];

    return list.map((p: any, idx: number) => {
      const name = p.productName || p.name || `Product #${p.id || idx + 1}`;
      const pId = String(p.id || p.productId || "");

      // Sum all store stock entries for this product
      const matchingFg = liveFgStocks.filter(
        (fg: any) =>
          String(fg.productItemId) === pId ||
          String(fg.productId) === pId ||
          String(fg.product?.id) === pId
      );

      let totalFgQty = matchingFg.reduce(
        (sum: number, fg: any) =>
          sum + (Number(fg.onHandQty ?? fg.currentStock ?? fg.quantity ?? 0) || 0),
        0
      );

      if (totalFgQty === 0) {
        totalFgQty = Number(p.onHandQty ?? p.currentStock ?? p.stock ?? p.quantity ?? 0) || 0;
      }

      const minLevel = Number(p.minimumQty || p.minStock || p.reorderLevel || 1500);
      const unitPrice = Number(p.rate || p.price || p.b2b || p.mrp || 15);
      const dynamicUom =
        matchingFg[0]?.product?.uom?.uomCode ||
        matchingFg[0]?.product?.uom?.name ||
        p.uom?.uomCode ||
        p.uom?.name ||
        p.uomCode ||
        p.baseUom ||
        p.uom ||
        "PCS";
      const uom = getPrimaryUom(dynamicUom, "PCS");
      const isLow = totalFgQty <= minLevel;
      const isCritical = totalFgQty <= minLevel * 0.4;
      const value = totalFgQty * unitPrice;
      const category = extractProductCategory(p, name);

      return {
        id: pId || idx,
        name,
        type: "Finished Goods",
        category,
        isWastage: false,
        qty: totalFgQty,
        minLevel,
        uom,
        unitPrice,
        value,
        isLow,
        isCritical,
        status: isCritical ? "CRITICAL" : isLow ? "LOW STOCK" : "OPTIMAL",
      };
    });
  }, [liveProducts, initialProducts, liveFgStocks]);

  // 3. System-Wide Reorder & Action Alerts (Monitors All 3 Stores: Raw Materials, Finished Goods, Wastage Store)
  const lowStockAlerts = useMemo(() => {
    // Unifies all 3 inventory streams so alerts always reflect total factory health independently of left filter tabs
    const allCombined = [...rawStockItems, ...finishedStockItems, ...wastageStockItems];
    return allCombined
      .filter((item) => {
        if (item.isWastage) {
          // Wastage store triggers alert when accumulation requires clearance/recycling action (>= 100 KG) or is low
          return item.isLow || item.isCritical || item.qty >= 100;
        }
        return item.isLow || item.isCritical;
      })
      .sort((a, b) => {
        if (a.isCritical && !b.isCritical) return -1;
        if (!a.isCritical && b.isCritical) return 1;
        return a.qty / (a.minLevel || 1) - b.qty / (b.minLevel || 1);
      })
      .slice(0, 10);
  }, [rawStockItems, finishedStockItems, wastageStockItems]);

  // 4. Aggregated Total Stock Counts
  const totalRawQty = useMemo(
    () => rawStockItems.reduce((sum, item) => sum + item.qty, 0),
    [rawStockItems]
  );
  const totalFgQty = useMemo(
    () => finishedStockItems.reduce((sum, item) => sum + item.qty, 0),
    [finishedStockItems]
  );
  const totalWastageQty = useMemo(
    () => wastageStockItems.reduce((sum, item) => sum + item.qty, 0),
    [wastageStockItems]
  );
  const totalTrackedSKUs =
    rawStockItems.length + finishedStockItems.length + wastageStockItems.length;

  // 5. Active Tab Full Item List
  const currentTabItems = useMemo(() => {
    if (activeTab === "raw") return rawStockItems;
    if (activeTab === "finished") return finishedStockItems;
    if (activeTab === "wastage") return wastageStockItems;
    return rawStockItems;
  }, [activeTab, rawStockItems, finishedStockItems, wastageStockItems]);

  const totalPages = Math.max(1, Math.ceil(currentTabItems.length / ITEMS_PER_PAGE));

  // Reset page if out of bounds
  useEffect(() => {
    if (currentPage >= totalPages) {
      setCurrentPage(0);
    }
  }, [currentPage, totalPages]);

  // Auto-slide to next batch every 5.5 seconds if multiple pages exist
  useEffect(() => {
    if (!isAutoRotating || totalPages <= 1) return;
    const interval = setInterval(() => {
      setCurrentPage((prev) => (prev + 1) % totalPages);
    }, 5500);
    return () => clearInterval(interval);
  }, [isAutoRotating, totalPages]);

  const handleNextPage = () => {
    setCurrentPage((prev) => (prev + 1) % totalPages);
  };

  const handlePrevPage = () => {
    setCurrentPage((prev) => (prev - 1 + totalPages) % totalPages);
  };

  // 6. Paginated Batch of Items for Clean Visual Chart
  const chartData = useMemo(() => {
    const startIdx = currentPage * ITEMS_PER_PAGE;
    const batch = currentTabItems.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    return batch.map((item) => ({
      name: item.name.length > 13 ? item.name.substring(0, 12) + "…" : item.name,
      fullName: item.name,
      quantity: item.qty,
      value: item.value,
      uom: item.uom,
      type: item.type,
      category: item.category,
      minLevel: item.minLevel,
      isLow: item.isLow,
      isCritical: item.isCritical,
      status: item.status,
    }));
  }, [currentTabItems, currentPage]);

  const currentTabUom = activeTab === "raw" ? "KG" : activeTab === "finished" ? "PCS" : "KG";
  const currentBatchTotal = useMemo(
    () => chartData.reduce((sum, item) => sum + item.quantity, 0),
    [chartData]
  );
  const currentTabTitle =
    activeTab === "raw"
      ? "Raw Materials"
      : activeTab === "finished"
        ? "Finished Goods"
        : "Wastage Store";

  const shareData = useMemo(() => {
    const sorted = [...chartData].sort((a, b) => b.quantity - a.quantity);
    const top = sorted.slice(0, 3).map((d, i) => ({ ...d, color: SHARE_COLORS[i] }));
    const rest = sorted.slice(3);
    if (rest.length === 0) return top;
    return [
      ...top,
      {
        ...rest[0],
        name: "Other",
        fullName: `Other (${rest.length})`,
        quantity: rest.reduce((sum, d) => sum + d.quantity, 0),
        color: SHARE_COLORS[3],
      },
    ];
  }, [chartData]);

  const tabColor = TAB_COLOR[activeTab];

  const snapshot = [
    {
      key: "skus",
      label: "Items tracked",
      value: totalTrackedSKUs.toLocaleString("en-IN"),
      unit: "SKUs",
      note: "Stock ledger",
      icon: LuPackageCheck,
      to: "/stock",
      title: "Open the stock ledger",
    },
    {
      key: "raw",
      label: "Raw materials",
      value: totalRawQty.toLocaleString("en-IN"),
      unit: "KG",
      note: `${rawStockItems.length} materials`,
      icon: LuLayers,
      to: "/stock",
      title: "Open raw material stock",
    },
    {
      key: "fg",
      label: "Finished goods",
      value: totalFgQty.toLocaleString("en-IN"),
      unit: "PCS",
      note: `${finishedStockItems.length} products`,
      icon: LuShoppingBag,
      to: "/finished-stock",
      title: "Open finished goods stock",
    },
    {
      key: "wastage",
      label: "Wastage store",
      value: totalWastageQty.toLocaleString("en-IN"),
      unit: "KG",
      note: `${wastageStockItems.length} scrap items`,
      icon: LuRecycle,
      to: "/wastage-stock",
      title: "Open wastage and scrap stock",
    },
  ];

  return (
    <DashTile labelledBy="dash-stock">
      <TileHeader
        id="dash-stock"
        icon={LuWarehouse}
        title="Inventory and stock"
        subtitle={
          <>
            Live stock across raw materials, finished goods and wastage
            {isLoading && (
              <LuRefreshCw
                aria-label="Refreshing"
                className="ml-1.5 inline animate-spin align-[-2px] motion-reduce:animate-none"
              />
            )}
          </>
        }
        actions={
          <>
            <ChipToggle
              label="Stock store"
              size="sm"
              value={activeTab}
              onChange={handleTabChange}
              options={[
                { value: "raw", label: "Raw material" },
                { value: "finished", label: "Finished goods" },
                { value: "wastage", label: "Wastage" },
              ]}
            />
            <ChipToggle
              label="Chart type"
              size="sm"
              value={chartType}
              onChange={handleChartTypeChange}
              options={[
                { value: "bar", label: <LuChartColumn aria-hidden="true" />, title: "Columns" },
                { value: "pie", label: <LuChartPie aria-hidden="true" />, title: "Share" },
                { value: "area", label: <LuChartArea aria-hidden="true" />, title: "Area" },
                { value: "list", label: <LuList aria-hidden="true" />, title: "Table" },
              ]}
            />
          </>
        }
      />

      {/* ── Snapshot tiles ── */}
      <div className="grid grid-cols-1 gap-3 px-5 pb-4 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {snapshot.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(s.to)}
            title={s.title}
            className="flex min-w-0 items-center gap-3 rounded-[14px] bg-card-2 p-3.5 text-left transition-colors hover:bg-nav-active"
          >
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-card text-accent"
            >
              <s.icon className="text-lg" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-ink-muted">{s.label}</span>
              <span className="block truncate text-lg leading-tight font-bold text-ink tabular-nums">
                {s.value} <span className="text-xs font-medium text-ink-subtle">{s.unit}</span>
              </span>
              <span className="block truncate text-[11px] text-ink-subtle">{s.note} →</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Chart (2/3) + reorder alerts (1/3) ── */}
      <div className="grid grid-cols-1 border-t border-line-soft lg:grid-cols-3">
        <div
          className="flex min-h-[340px] flex-col p-5 lg:col-span-2"
          onMouseEnter={() => setIsAutoRotating(false)}
          onMouseLeave={() => setIsAutoRotating(true)}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: tabColor }}
              />
              {currentTabTitle}
              {totalPages > 1 && (
                <span className="text-xs font-normal text-ink-subtle tabular-nums">
                  {currentPage * ITEMS_PER_PAGE + 1}–
                  {Math.min((currentPage + 1) * ITEMS_PER_PAGE, currentTabItems.length)} of{" "}
                  {currentTabItems.length}
                </span>
              )}
            </span>

            {totalPages > 1 && (
              <div className="flex items-center gap-1 rounded-full border border-line-soft bg-card p-1 shadow-[var(--shadow-sm)]">
                <button
                  type="button"
                  onClick={handlePrevPage}
                  aria-label="Previous items"
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-muted hover:bg-card-2 hover:text-ink"
                >
                  <LuChevronLeft aria-hidden="true" />
                </button>
                {Array.from({ length: totalPages }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setCurrentPage(i)}
                    aria-label={`Items page ${i + 1}`}
                    aria-current={i === currentPage ? "true" : undefined}
                    className={`h-2 rounded-full transition-all ${
                      i === currentPage ? "w-4 bg-accent" : "w-2 bg-line hover:bg-ink-subtle"
                    }`}
                  />
                ))}
                <button
                  type="button"
                  onClick={handleNextPage}
                  aria-label="Next items"
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-muted hover:bg-card-2 hover:text-ink"
                >
                  <LuChevronRight aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAutoRotating((prev) => !prev)}
                  aria-label={isAutoRotating ? "Pause auto-advance" : "Resume auto-advance"}
                  aria-pressed={isAutoRotating}
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-muted hover:bg-card-2 hover:text-ink"
                >
                  {isAutoRotating ? <LuPause aria-hidden="true" /> : <LuPlay aria-hidden="true" />}
                </button>
              </div>
            )}
          </div>

          {chartData.length === 0 ? (
            <EmptyState
              icon={activeTab === "wastage" ? LuRecycle : LuPackage}
              title={
                activeTab === "wastage"
                  ? "No scrap in the wastage store"
                  : `No ${currentTabTitle.toLowerCase()} set up yet`
              }
              hint={
                activeTab === "wastage"
                  ? "Scrap and rejects land here when production logs wastage."
                  : "Add items to the master and receive stock to see levels here."
              }
              action={
                activeTab === "finished"
                  ? { label: "Open finished stock", to: "/finished-stock" }
                  : activeTab === "raw"
                    ? { label: "Open stock ledger", to: "/stock" }
                    : null
              }
            />
          ) : chartType === "bar" ? (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                  />
                  <Tooltip cursor={{ fill: "var(--color-card-2)" }} content={<StockTooltip />} />
                  <Bar dataKey="quantity" fill={tabColor} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : chartType === "pie" ? (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
              <div className="relative h-[230px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<StockTooltip />} />
                    <Pie
                      data={shareData}
                      dataKey="quantity"
                      innerRadius={62}
                      outerRadius={90}
                      paddingAngle={2}
                      stroke="var(--color-card)"
                      strokeWidth={2}
                    >
                      {shareData.map((entry) => (
                        <Cell key={entry.fullName} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[11px] text-ink-subtle">{currentTabTitle}</span>
                  <span className="text-base font-bold text-ink tabular-nums">
                    {currentBatchTotal.toLocaleString("en-IN")}{" "}
                    <span className="text-xs font-medium text-ink-subtle">{currentTabUom}</span>
                  </span>
                </div>
              </div>
              <ul className="flex flex-col gap-2">
                {shareData.map((item) => {
                  const pct =
                    currentBatchTotal > 0
                      ? ((item.quantity / currentBatchTotal) * 100).toFixed(1)
                      : "0";
                  return (
                    <li
                      key={item.fullName}
                      className="flex items-center justify-between gap-3 rounded-[12px] bg-card-2 px-3 py-2 text-sm"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate text-ink" title={item.fullName}>
                          {item.fullName}
                        </span>
                      </span>
                      <span className="shrink-0 text-ink tabular-nums">
                        {item.quantity.toLocaleString("en-IN")} {item.uom}
                        <span className="ml-1.5 text-xs text-ink-subtle">{pct}%</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : chartType === "area" ? (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 8 }}>
                  <defs>
                    <linearGradient id="dashStockArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={tabColor} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={tabColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "var(--color-ink-subtle)" }}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--color-line)", strokeWidth: 1 }}
                    content={<StockTooltip />}
                  />
                  <Area
                    type="monotone"
                    dataKey="quantity"
                    stroke={tabColor}
                    strokeWidth={2}
                    fill="url(#dashStockArea)"
                    dot={{ r: 4, fill: tabColor, stroke: "var(--color-card)", strokeWidth: 2 }}
                    activeDot={{
                      r: 6,
                      fill: tabColor,
                      stroke: "var(--color-card)",
                      strokeWidth: 2,
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="max-h-[280px] overflow-auto rounded-[14px] border border-line-soft">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-card-2 text-xs text-ink-subtle">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Item
                    </th>
                    <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">
                      Category
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">
                      In stock
                    </th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((item) => (
                    <tr key={item.fullName} className="border-b border-line-soft last:border-b-0">
                      <td
                        className="h-[48px] max-w-[180px] truncate px-4 font-medium text-ink"
                        title={item.fullName}
                      >
                        {item.fullName}
                      </td>
                      <td className="hidden px-3 sm:table-cell">
                        <span className="sl-chip sl-chip-muted px-2.5 py-0 text-[11px]">
                          {item.category || item.type}
                        </span>
                      </td>
                      <td className="px-3 text-right text-ink tabular-nums">
                        {item.quantity.toLocaleString("en-IN")} {item.uom}
                      </td>
                      <td className="px-4 text-right">
                        <span
                          className={`sl-chip px-2.5 py-0 text-[11px] ${
                            item.status === "CRITICAL"
                              ? "sl-chip-danger"
                              : item.status === "LOW STOCK"
                                ? "sl-chip-warning"
                                : "sl-chip-success"
                          }`}
                          title={`Minimum ${item.minLevel} ${item.uom}`}
                        >
                          {item.status === "CRITICAL"
                            ? "Critical"
                            : item.status === "LOW STOCK"
                              ? "Low"
                              : "Healthy"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Reorder alerts across all three stores ── */}
        <div className="flex flex-col border-t border-line-soft p-5 lg:border-t-0 lg:border-l">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-ink">
              <LuTriangleAlert aria-hidden="true" className="text-[color:var(--color-warning)]" />
              Reorder alerts
            </span>
            <span
              className={`sl-chip px-2.5 py-0.5 text-xs ${
                lowStockAlerts.length > 0 ? "sl-chip-warning" : "sl-chip-success"
              }`}
            >
              {lowStockAlerts.length > 0 ? `${lowStockAlerts.length} to act on` : "All healthy"}
            </span>
          </div>

          {lowStockAlerts.length === 0 ? (
            <EmptyState
              icon={LuCircleCheck}
              tone="success"
              title="Every store is within limits"
              hint="Items that fall below their minimum level appear here."
            />
          ) : (
            <ul className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
              {lowStockAlerts.map((item) => {
                const pct = Math.min((item.qty / (item.minLevel || 1)) * 100, 100);
                const isCritical = item.isCritical;
                const isWastage = item.isWastage;
                const targetRoute = isWastage
                  ? "/wastage-stock"
                  : item.type === "Finished Goods"
                    ? "/finished-stock"
                    : "/stock";
                const store = isWastage
                  ? { label: "Wastage", color: TAB_COLOR.wastage }
                  : item.type === "Finished Goods"
                    ? { label: "FG", color: TAB_COLOR.finished }
                    : { label: "Raw", color: TAB_COLOR.raw };
                return (
                  <li key={`${item.type}-${item.id}`}>
                    <button
                      type="button"
                      onClick={() => navigate(targetRoute)}
                      title={`View ${item.name} in ${item.type}`}
                      className="flex w-full flex-col gap-2 rounded-[14px] bg-card-2 p-3 text-left transition-colors hover:bg-nav-active"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink" title={item.name}>
                          {item.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="sl-chip sl-chip-muted gap-1 px-2 py-0 text-[11px]">
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: store.color }}
                            />
                            {store.label}
                          </span>
                          <span
                            className={`sl-chip px-2 py-0 text-[11px] ${
                              isCritical ? "sl-chip-danger" : "sl-chip-warning"
                            }`}
                          >
                            {isWastage && item.qty >= 100
                              ? "Clear"
                              : isCritical
                                ? "Critical"
                                : "Low"}
                          </span>
                        </span>
                      </span>
                      <span className="flex items-center justify-between text-xs text-ink-subtle tabular-nums">
                        <span>
                          <strong className="font-semibold text-ink">
                            {item.qty.toLocaleString("en-IN")}
                          </strong>{" "}
                          {item.uom} on hand
                        </span>
                        <span>
                          {isWastage ? "Limit" : "Min"} {item.minLevel.toLocaleString("en-IN")}
                        </span>
                      </span>
                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
                        <span
                          className={`block h-full rounded-full ${
                            isCritical
                              ? "bg-[color:var(--color-danger)]"
                              : "bg-[color:var(--color-warning)]"
                          }`}
                          style={{ width: `${Math.max(pct, 6)}%` }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </DashTile>
  );
};
