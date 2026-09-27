import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { useLocation, useParams } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import {
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SectionLabel,
  SkeletonTile,
  Tile,
} from "../../../components/ui/v2";
import { Figure, InfoItem, PageBody, formatQty } from "../../production/ui";
import { productionOrderService } from "../../../services/productionOrderService";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { stockAdjustmentService } from "../../../services/stockAdjustmentService";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { useSocketSync } from "../../../hooks/useSocketSync";

const PRODUCTION_STARTED_STATUSES = [
  "WEEKLY_SCHEDULED",
  "DAILY_PLANNED",
  "IN_PROGRESS",
  "IN_PRODUCTION",
  "POST_PRODUCTION",
  "READY_FOR_DISPATCH",
  "PARTIAL_COMPLETED",
  "COMPLETED_WITH_SHORTFALL",
  "DISPATCHED",
  "CLOSED",
  "CANCELLED",
];

const formatDate = (dateString?: string) => {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const formatDateTime = (dateString?: string) => {
  if (!dateString) return "-";
  return new Date(dateString).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const normalizeUom = (uom?: string) => {
  const u = (uom || "").toLowerCase();
  return u === "ea" || u === "each" ? "pcs" : uom || "KG";
};

// ── Raw Materials sub-section ─────────────────────────────────────────────────

interface RmTableProps {
  rawMaterials: any[];
  rawMaterialsMap: Map<string, any>;
  orderStatus: string;
  productionHasStarted: boolean;
}

const RawMaterialsTable: React.FC<RmTableProps> = ({
  rawMaterials,
  rawMaterialsMap,
  orderStatus,
  productionHasStarted,
}) => {
  const isReservedStatus = [
    "RM_AVAILABLE",
    "READY_FOR_PLANNING",
    "SCHEDULED",
    "IN_PROGRESS",
    "IN PROGRESS",
  ].includes(orderStatus);

  const columns: DataTableColumn<any>[] = useMemo(
    () => [
      {
        header: "RAW MATERIAL CODE",
        width: "160px",
        render: (rm) => <span className="font-semibold text-ink">{rm.rawMaterialId}</span>,
      },
      {
        header: "RAW MATERIAL NAME",
        render: (rm) => {
          const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
          return (
            <span className="text-ink-muted">
              {rm.materialName || stockRm?.materialName || rm.rawMaterialId}
            </span>
          );
        },
      },
      {
        header: "REQUIRED QTY",
        align: "right",
        width: "140px",
        render: (rm) => {
          const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
          const required = Number(rm.requiredQty || 0);
          let displayUom = stockRm?.baseUom?.split(",")[0] || rm.uom || "KG";
          displayUom = normalizeUom(displayUom);
          return (
            <span className="font-medium text-ink">
              {required.toFixed(2)} {displayUom}
            </span>
          );
        },
      },
      {
        header: "AVAILABLE STOCK",
        align: "right",
        width: "150px",
        render: (rm) => {
          const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
          const required = Number(rm.requiredQty || 0);
          let available = stockRm
            ? Number(stockRm.onHandQty || 0) - Number(stockRm.reservedQty || 0)
            : Number(rm.availableStock || 0);
          if (isReservedStatus && stockRm) available += required;
          let displayUom = stockRm?.baseUom?.split(",")[0] || rm.uom || "KG";
          displayUom = normalizeUom(displayUom);
          return (
            <span className="text-ink-muted">
              {available.toFixed(2)} {displayUom}
            </span>
          );
        },
      },
      {
        header: "STOCK STATUS",
        align: "center",
        width: "130px",
        render: (rm) => {
          const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
          const required = Number(rm.requiredQty || 0);
          let available = stockRm
            ? Number(stockRm.onHandQty || 0) - Number(stockRm.reservedQty || 0)
            : Number(rm.availableStock || 0);
          if (isReservedStatus && stockRm) available += required;
          const isAvailable =
            productionHasStarted || (rm.status ? rm.status === "AVAILABLE" : available >= required);
          return <StatusBadge status={isAvailable ? "AVAILABLE" : "INSUFFICIENT"} />;
        },
      },
    ],
    [rawMaterialsMap, isReservedStatus, productionHasStarted]
  );

  return (
    <DataTable
      columns={columns}
      data={rawMaterials}
      rowKey={(rm) => rm.rawMaterialId}
      emptyMessage="No raw materials defined for this product."
      minHeightClassName="min-h-0"
      density="compact"
    />
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const ProductionOrderHistoryView: React.FC = () => {
  const [activeTab, setActiveTab] = useState("products");
  const location = useLocation();
  const { id } = useParams<{ id: string }>();

  const [passedOrder] = useState<any>(location.state?.order || null);
  const [fullOrder, setFullOrder] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [rawMaterialsMap, setRawMaterialsMap] = useState<Map<string, any>>(new Map());
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [rmIssues, setRmIssues] = useState<any[]>([]);

  // ── Load raw materials map ────────────────────────────────────────────────
  useEffect(() => {
    rawMaterialService
      .fetchAll()
      .then((data) => {
        const arr = Array.isArray(data) ? data : ((data as any)?.rawMaterials ?? []);
        const map = new Map<string, any>();
        arr.forEach((rm: any) => map.set(rm.rawMaterialId?.toString(), rm));
        setRawMaterialsMap(map);
      })
      .catch(() => {});
  }, []);

  // ── Fetch history ─────────────────────────────────────────────────────────
  const fetchHistory = useCallback(() => {
    if (!id) return;
    productionOrderService
      .getHistory(id)
      .then((data: any) => setHistoryRecords(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [id]);

  // ── Fetch RM issues (stock adjustments) for this PO ──────────────────────
  const fetchRmIssues = useCallback(() => {
    if (!id) return;
    stockAdjustmentService
      .fetchAll({ productionOrderId: id, pageSize: 200 })
      .then((res: any) => {
        const list: any[] = Array.isArray(res) ? res : (res?.data ?? res?.adjustments ?? []);
        // Group by adjustment — each entry is one adjustment with its items
        const groups = list.map((adj: any) => ({
          adjId: adj.id,
          adjustmentNumber: adj.adjustmentNumber,
          date: adj.adjustmentDate,
          reason: adj.reason || "-",
          items: (adj.items || []).map((item: any) => ({
            rawMaterialName: item.rawMaterial?.materialName || item.product?.productName || "-",
            rawMaterialCode: item.rawMaterial?.rawMaterialId || item.product?.productCode || "-",
            store: item.store?.storeName || "-",
            currentQty: Number(item.currentQty ?? 0),
            adjustedQty: Number(item.adjustedQty ?? 0),
            difference: Number(item.difference ?? 0),
            uom: normalizeUom(item.rawMaterial?.baseUom?.split(",")[0] || item.uom || "KG"),
            remarks: item.remarks || "-",
          })),
        }));
        setRmIssues(groups);
      })
      .catch(() => {});
  }, [id]);

  // ── Fetch order details ───────────────────────────────────────────────────
  const fetchOrderDetails = useCallback(
    (orderToFetch: any) => {
      setLoading(true);
      const fetchIds: string[] =
        orderToFetch.items?.length > 0
          ? orderToFetch.items.map((i: any) => i.productionOrderId || i.id)
          : [orderToFetch.productionOrderId || orderToFetch.id || id];

      Promise.all(fetchIds.map((fid: string) => productionOrderService.getById(fid)))
        .then((dataArray) => {
          if (dataArray.length === 0) {
            setFullOrder(null);
            return;
          }
          const merged: any = { ...dataArray[0] };
          merged.products = dataArray.map((d: any) => ({
            productName: d.productItem?.productName || "Unknown",
            productCode: d.productItem?.productCode || "Unknown",
            quantity: d.targetQty || 0,
            uom: d.uom || d.productItem?.uom || "pcs",
            weightPerPieceUsed: d.productItem?.weightPerPiece || 0,
            rawMaterials: d.draftRawMaterials || d.rawMaterials || [],
            productionOrderId: d.productionOrderId,
            status: d.status,
          }));
          merged.productionOrderId = orderToFetch.productionOrderId || orderToFetch.id || id;
          setFullOrder(merged);
        })
        .catch(() => toast.error("Failed to load production order details"))
        .finally(() => setLoading(false));
    },
    [id]
  );

  useEffect(() => {
    if (passedOrder) fetchOrderDetails(passedOrder);
    else if (id) fetchOrderDetails({ id });
  }, [passedOrder, id, fetchOrderDetails]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);
  useEffect(() => {
    fetchRmIssues();
  }, [fetchRmIssues]);

  useSocketSync("productionOrder", undefined, () => {
    if (passedOrder) fetchOrderDetails(passedOrder);
    else if (id) fetchOrderDetails({ id });
    fetchHistory();
  });

  // ── Derived values ────────────────────────────────────────────────────────
  const displayOrder = fullOrder || passedOrder || {};
  const productionHasStarted = PRODUCTION_STARTED_STATUSES.includes(fullOrder?.status);

  const hasInsufficientStock =
    !productionHasStarted &&
    fullOrder?.products?.some((p: any) =>
      p.rawMaterials?.some((rm: any) => {
        const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
        const required = Number(rm.requiredQty || 0);
        let available = stockRm
          ? Number(stockRm.onHandQty || 0) - Number(stockRm.reservedQty || 0)
          : Number(rm.availableStock || 0);
        if (
          ["RM_AVAILABLE", "READY_FOR_PLANNING", "SCHEDULED"].includes(fullOrder?.status) &&
          stockRm
        ) {
          available += required;
        }
        return rm.status ? rm.status === "INSUFFICIENT" : available < required;
      })
    );

  // ── Plans (shift-wise) ────────────────────────────────────────────────────
  const plans: any[] = useMemo(() => {
    if (!fullOrder?.dailyProductionPlans?.length) return [];
    return [...fullOrder.dailyProductionPlans]
      .sort((a: any, b: any) => {
        const dA = new Date(a.productionDate || 0).getTime();
        const dB = new Date(b.productionDate || 0).getTime();
        if (dA !== dB) return dA - dB;
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      })
      .map((plan: any) => {
        const hourlySum =
          plan.hourlyProductions?.reduce(
            (acc: number, h: any) =>
              acc +
              Math.max(
                0,
                Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
              ),
            0
          ) || 0;
        const isPermanentStop =
          fullOrder?.status === "COMPLETED_WITH_SHORTFALL" ||
          plan.productionOrder?.status === "COMPLETED_WITH_SHORTFALL";
        // Extract stop reason from remarks (format: "Short Closed: reason | Stopped: reason")
        const rawRemarks = plan.remarks || "";
        let stopReason: string | null = null;
        if (rawRemarks) {
          const parts = rawRemarks.split("|");
          const reasonPart = parts[parts.length - 1] || "";
          const cleaned = reasonPart
            .replace(/Permanently Stopped:/i, "")
            .replace(/Short Closed:/i, "")
            .replace(/Stopped:/i, "")
            .replace(/Cancelled:/i, "")
            .trim();
          if (cleaned) stopReason = cleaned;
        }
        const plannedQty = Number(plan.plannedQty || 0);
        // If hourlySum = 0 and status is COMPLETED (not a permanent stop), assume full production
        const producedQty =
          hourlySum > 0
            ? hourlySum
            : plan.status === "COMPLETED" && !isPermanentStop
              ? plannedQty
              : 0;
        // A COMPLETED plan that produced less than planned was stopped early → show shortfall status
        let displayStatus = plan.status || "PLANNED";
        if (
          displayStatus === "COMPLETED" &&
          plannedQty > 0 &&
          producedQty > 0 &&
          producedQty < plannedQty
        ) {
          displayStatus = "COMPLETED_WITH_SHORTFALL";
        }
        return {
          id: plan.dailyPlanId,
          date: plan.productionDate
            ? new Date(plan.productionDate).toLocaleDateString("en-IN")
            : "-",
          shiftName: plan.shift?.shiftName || plan.shiftId || "-",
          machineName:
            plan.machine?.machineName || plan.machineId || fullOrder?.Machine?.machineName || "-",
          plannedQty,
          producedQty,
          status: displayStatus,
          stopReason,
        };
      });
  }, [fullOrder]);

  const totalDispatchedQty = useMemo(
    () =>
      fullOrder?.goodsDispatchItems?.reduce(
        (sum: number, item: any) => sum + Number(item.dispatchQty || 0),
        0
      ) ?? 0,
    [fullOrder]
  );

  // Pre-compute dispatch status per shift in a single pass (fixes mutable closure bug)
  const plansWithDispatch = useMemo(() => {
    let cumulative = 0;
    return plans.map((plan) => {
      const hasProduction = plan.producedQty > 0;
      const isFinalized =
        (plan.status === "COMPLETED" || plan.status === "COMPLETED_WITH_SHORTFALL") &&
        hasProduction;
      if (isFinalized) cumulative += plan.producedQty;

      let dispatchStatus: string;
      if (!hasProduction) {
        dispatchStatus = "no_production";
      } else if (
        isFinalized &&
        totalDispatchedQty > 0 &&
        cumulative <= totalDispatchedQty + 0.001
      ) {
        dispatchStatus = "dispatched";
      } else if (isFinalized) {
        dispatchStatus = "ready";
      } else {
        dispatchStatus = "not_dispatched";
      }

      return { ...plan, dispatchStatus };
    });
  }, [plans, totalDispatchedQty]);

  const targetVal = Number(fullOrder?.targetQty || displayOrder?.targetQty || 0);
  const producedVal = useMemo(() => {
    if (fullOrder?.dailyProductionPlans?.length > 0) {
      return fullOrder.dailyProductionPlans.reduce(
        (total: number, plan: any) =>
          total +
          (plan.hourlyProductions?.reduce(
            (acc: number, h: any) =>
              acc +
              Math.max(
                0,
                Number(h.qtyProduced || 0) - Number(h.rejectQty || 0) - Number(h.scrapQty || 0)
              ),
            0
          ) || 0),
        0
      );
    }
    return Number(fullOrder?.producedQty || displayOrder?.producedQty || 0);
  }, [fullOrder, displayOrder]);

  // ── Shift table columns ───────────────────────────────────────────────────
  const shiftColumns: DataTableColumn<any>[] = useMemo(() => {
    return [
      {
        header: "DATE",
        width: "110px",
        render: (plan) => <span className="font-medium text-ink">{plan.date}</span>,
      },
      {
        header: "SHIFT",
        width: "120px",
        render: (plan) => <span className="text-ink-muted">{plan.shiftName}</span>,
      },
      {
        header: "MACHINE",
        render: (plan) => <span className="text-ink-muted">{plan.machineName}</span>,
      },
      {
        header: "PLANNED QTY",
        align: "right",
        width: "110px",
        render: (plan) => <span className="font-semibold text-ink-muted">{plan.plannedQty}</span>,
      },
      {
        header: "PRODUCED QTY",
        align: "right",
        width: "120px",
        render: (plan) => (
          <span className="font-bold text-[color:var(--color-success)]">{plan.producedQty}</span>
        ),
      },
      {
        header: "PRODUCTION STATUS",
        width: "180px",
        render: (plan) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={plan.status} />
            {plan.stopReason && plan.status !== "COMPLETED" && (
              <div className="group relative flex items-center cursor-pointer">
                <FaInfoCircle className="text-[color:var(--color-danger)] text-[13px]" />
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2.5 bg-card border border-line text-ink text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20 shadow-md pointer-events-none">
                  <span className="font-bold text-[color:var(--color-warning)] block mb-1">
                    Stop Reason:
                  </span>
                  <div className="leading-relaxed">{plan.stopReason}</div>
                </div>
              </div>
            )}
          </div>
        ),
      },
      {
        header: "DISPATCH STATUS",
        align: "center",
        width: "150px",
        render: (plan) => {
          if (plan.dispatchStatus === "no_production") {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm border border-line bg-card-2 text-ink-muted text-[11px] font-semibold">
                No Production
              </span>
            );
          }
          if (plan.dispatchStatus === "dispatched") {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm border border-line bg-card-2 text-ink-muted text-[11px] font-semibold">
                Dispatched
              </span>
            );
          }
          if (plan.dispatchStatus === "ready") {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm border border-line bg-card-2 text-ink-muted text-[11px] font-semibold">
                Ready for Dispatch
              </span>
            );
          }
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm border border-line bg-card-2 text-ink-muted text-[11px] font-semibold">
              Not Dispatched
            </span>
          );
        },
      },
    ];
  }, []);

  // Fallback single-row for when no shift plans exist yet
  const fallbackShiftData = useMemo(() => {
    if (plans.length > 0) return [];
    const dispatchStatus =
      displayOrder?.status === "DISPATCHED"
        ? "dispatched"
        : displayOrder?.status === "READY_FOR_DISPATCH" || displayOrder?.status === "COMPLETED"
          ? "ready"
          : "none";
    return [
      {
        id: "fallback",
        date: displayOrder?.orderDate
          ? new Date(displayOrder.orderDate).toLocaleDateString("en-IN")
          : "-",
        shiftName: "General Shift",
        machineName: fullOrder?.Machine?.machineName || fullOrder?.machineMachineId || "-",
        plannedQty: Number(displayOrder?.targetQty || 0),
        producedQty: Number(displayOrder?.producedQty || 0),
        status: displayOrder?.status || "-",
        _dispatchStatus: dispatchStatus,
      },
    ];
  }, [plans, displayOrder, fullOrder]);

  const fallbackShiftColumns: DataTableColumn<any>[] = useMemo(
    () => [
      {
        header: "DATE",
        width: "110px",
        render: (r) => <span className="font-medium text-ink">{r.date}</span>,
      },
      {
        header: "SHIFT",
        width: "120px",
        render: (r) => <span className="text-ink-muted">{r.shiftName}</span>,
      },
      { header: "MACHINE", render: (r) => <span className="text-ink-muted">{r.machineName}</span> },
      {
        header: "PLANNED QTY",
        align: "right",
        width: "110px",
        render: (r) => <span className="font-semibold text-ink-muted">{r.plannedQty}</span>,
      },
      {
        header: "PRODUCED QTY",
        align: "right",
        width: "120px",
        render: (r) => (
          <span className="font-bold text-[color:var(--color-success)]">{r.producedQty}</span>
        ),
      },
      {
        header: "PRODUCTION STATUS",
        width: "160px",
        render: (r) => <StatusBadge status={r.status} />,
      },
      {
        header: "DISPATCH STATUS",
        align: "center",
        width: "150px",
        render: (r) => {
          if (r._dispatchStatus === "dispatched")
            return (
              <Chip size="sm" tone="success" dot>
                Dispatched
              </Chip>
            );
          if (r._dispatchStatus === "ready")
            return (
              <Chip size="sm" tone="info" dot>
                Ready for Dispatch
              </Chip>
            );
          return (
            <Chip size="sm" tone="muted" dot>
              Not Dispatched
            </Chip>
          );
        },
      },
    ],
    []
  );

  // ── Dispatch history columns ──────────────────────────────────────────────
  const dispatchColumns: DataTableColumn<any>[] = useMemo(
    () => [
      {
        header: "DISPATCH NO",
        width: "140px",
        render: (item) => (
          <span className="font-semibold text-ink">{item.dispatch?.dispatchNumber || "-"}</span>
        ),
      },
      {
        header: "DATE",
        width: "110px",
        render: (item) => (
          <span className="text-ink-muted">
            {item.dispatch?.dispatchDate ? formatDate(item.dispatch.dispatchDate) : "-"}
          </span>
        ),
      },
      {
        header: "VEHICLE",
        render: (item) => (
          <span className="text-ink-muted">{item.dispatch?.vehicleNumber || "-"}</span>
        ),
      },
      {
        header: "DRIVER",
        render: (item) => (
          <span className="text-ink-muted">{item.dispatch?.driverName || "-"}</span>
        ),
      },
      {
        header: "DISPATCH QTY",
        align: "right",
        width: "120px",
        render: (item) => (
          <span className="font-semibold text-ink-muted">
            {Number(item.dispatchQty || 0).toFixed(2)}
          </span>
        ),
      },
      {
        header: "RECEIVED QTY",
        align: "right",
        width: "120px",
        render: (item) => (
          <span className="font-semibold text-[color:var(--color-info)]">
            {item.receivedQty != null ? Number(item.receivedQty).toFixed(2) : "-"}
          </span>
        ),
      },
      {
        header: "STATUS",
        width: "150px",
        render: (item) => <StatusBadge status={item.dispatch?.status || "PENDING_GATE_APPROVAL"} />,
      },
    ],
    []
  );

  // ── Render ────────────────────────────────────────────────────────────────
  const rawStatus = displayOrder?.status || fullOrder?.status;
  const targetForStatus = Number(fullOrder?.targetQty || displayOrder?.targetQty || 0);
  const producedForStatus = Number(fullOrder?.producedQty || displayOrder?.producedQty || 0);
  // If DB has COMPLETED_WITH_SHORTFALL but produced >= target, it was set incorrectly — show correct status
  const resolvedStatus =
    rawStatus === "COMPLETED_WITH_SHORTFALL" &&
    targetForStatus > 0 &&
    producedForStatus >= targetForStatus
      ? "READY_FOR_DISPATCH"
      : rawStatus;
  const statusShortfall = targetForStatus - producedForStatus;

  const tabs = [
    { key: "products", label: "Products & materials", count: fullOrder?.products?.length },
    { key: "shifts", label: "Shifts & dispatch" },
    ...(rmIssues.length > 0
      ? [{ key: "issues", label: "Material issues", count: rmIssues.length }]
      : []),
    ...(historyRecords.length > 0
      ? [{ key: "activity", label: "Activity", count: historyRecords.length }]
      : []),
  ];
  const tab = tabs.some((t) => t.key === activeTab) ? activeTab : "products";

  return (
    <PageBody>
      <PageHeader
        title="Production Order Details"
        meta={
          <>
            <Chip size="sm" tone="muted" className="font-mono">
              {id}
            </Chip>
            {!loading && resolvedStatus && <StatusBadge status={resolvedStatus} />}
          </>
        }
        subtitle="Products, raw materials, shift output, dispatches and every status change."
        back="/production-orders"
        backLabel="Back to List"
        breadcrumbs={[
          { label: "Production orders", to: "/production-orders" },
          { label: "History", to: "/allproduction-orders" },
          { label: String(id ?? "") },
        ]}
      />

      {hasInsufficientStock && (
        <div
          role="alert"
          className="sl-tile flex items-start gap-3 p-4 text-sm font-medium text-[color:var(--color-danger)]"
          style={{ boxShadow: "inset 4px 0 0 var(--color-danger)" }}
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          One or more required raw materials have insufficient stock. Please create a Raw Material
          Order before proceeding to Weekly Machine Assignment.
        </div>
      )}

      {loading ? (
        <>
          <SkeletonTile lines={3} label="Loading order details..." />
          <SkeletonTile lines={5} />
        </>
      ) : (
        <>
          {/* ── Summary ──────────────────────────────── */}
          <Tile>
            <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
              <InfoItem label="Order No" value={displayOrder?.productionOrderId} mono />
              <InfoItem label="Order Date" value={formatDate(displayOrder?.orderDate)} />
              <InfoItem label="Due Date" value={formatDate(displayOrder?.dueDate)} />
              <div>
                <InfoItem label="Status" value={<StatusBadge status={resolvedStatus} />} />
                {resolvedStatus === "COMPLETED_WITH_SHORTFALL" && statusShortfall > 0 && (
                  <Chip size="sm" tone="danger" className="mt-1">
                    Shortfall: {formatQty(statusShortfall)} pcs
                  </Chip>
                )}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 rounded-[16px] bg-card-2 p-4">
              <Figure size="lg" label="Target" value={formatQty(targetVal)} />
              <Figure size="lg" label="Produced" tone="success" value={formatQty(producedVal)} />
              <Figure
                size="lg"
                label="Dispatched"
                tone="accent"
                value={formatQty(totalDispatchedQty)}
              />
            </div>
          </Tile>

          <ChipTabs
            items={tabs}
            value={tab}
            onChange={setActiveTab}
            ariaLabel="Order sections"
            idPrefix="po-history"
          />

          <div
            role="tabpanel"
            id={`po-history-panel-${tab}`}
            aria-labelledby={`po-history-tab-${tab}`}
            className="flex flex-col gap-5"
          >
            {/* ── Products & Raw Materials ──────────────────── */}
            {tab === "products" &&
              (fullOrder?.products?.length ? (
                fullOrder.products.map((prod: any, idx: number) => (
                  <Tile
                    key={idx}
                    title={
                      <>
                        Product {idx + 1}: {prod.productName}{" "}
                        <span className="text-[13px] font-normal text-ink-subtle">
                          ({prod.productCode})
                        </span>
                      </>
                    }
                  >
                    <div className="mb-4 grid grid-cols-3 gap-3 rounded-[16px] bg-card-2 p-4">
                      <Figure
                        label="Production Qty"
                        value={formatQty(prod.quantity)}
                        hint={normalizeUom(prod.uom)}
                      />
                      <Figure
                        label="Weight Used"
                        value={Number(prod.weightPerPieceUsed || 0).toFixed(3)}
                        hint="KG per piece"
                      />
                      <Figure label="Unit (UOM)" value={normalizeUom(prod.uom)} />
                    </div>
                    <SectionLabel as="h3">Required Raw Materials</SectionLabel>
                    <RawMaterialsTable
                      rawMaterials={prod.rawMaterials || []}
                      rawMaterialsMap={rawMaterialsMap}
                      orderStatus={fullOrder?.status || ""}
                      productionHasStarted={productionHasStarted}
                    />
                  </Tile>
                ))
              ) : (
                <Tile>
                  <EmptyState compact title="No products recorded on this order." />
                </Tile>
              ))}

            {/* ── Shift-wise Production & Dispatch ─────────── */}
            {tab === "shifts" && (
              <>
                <Tile
                  padding="sm"
                  title="Shift-wise Production & Dispatch Details"
                  actions={
                    fullOrder?.status === "COMPLETED_WITH_SHORTFALL" && producedVal < targetVal ? (
                      <Chip tone="danger" size="sm">
                        Permanently Stopped (Shortfall: {formatQty(targetVal - producedVal)} pcs)
                      </Chip>
                    ) : undefined
                  }
                >
                  <DataTable
                    ariaLabel="Shift-wise production"
                    columns={plansWithDispatch.length > 0 ? shiftColumns : fallbackShiftColumns}
                    data={plansWithDispatch.length > 0 ? plansWithDispatch : fallbackShiftData}
                    rowKey={(r) => r.id}
                    emptyMessage="No shift plans recorded yet."
                    minHeightClassName="min-h-0"
                    density="compact"
                    className="!shadow-none border border-line-soft"
                  />
                </Tile>

                {fullOrder?.goodsDispatchItems?.length > 0 && (
                  <Tile padding="sm" title="Dispatch History">
                    <DataTable
                      ariaLabel="Dispatch history"
                      columns={dispatchColumns}
                      data={fullOrder.goodsDispatchItems}
                      rowKey={(item) => item.id}
                      emptyMessage="No dispatches recorded."
                      minHeightClassName="min-h-0"
                      density="compact"
                      className="!shadow-none border border-line-soft"
                    />
                  </Tile>
                )}
              </>
            )}

            {/* ── Raw Material Issues ───────────────────────── */}
            {tab === "issues" && (
              <Tile
                title="Raw Material Issues"
                actions={
                  <Chip size="sm" tone="muted">
                    {rmIssues.length} adjustment{rmIssues.length !== 1 ? "s" : ""}
                  </Chip>
                }
              >
                <div className="flex flex-col gap-3">
                  {rmIssues.map((adj: any) => (
                    <div
                      key={adj.adjId}
                      className="overflow-hidden rounded-[14px] border border-line-soft"
                    >
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 bg-card-2 px-4 py-2.5">
                        <span className="font-mono text-xs font-bold text-accent">
                          {adj.adjustmentNumber}
                        </span>
                        <span className="text-xs text-ink-muted">{formatDate(adj.date)}</span>
                        {adj.reason && adj.reason !== "-" && (
                          <span className="text-xs italic text-ink-subtle">{adj.reason}</span>
                        )}
                        <span className="ml-auto text-xs font-medium text-ink-subtle">
                          {adj.items.length} material{adj.items.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-sm">
                          <thead>
                            <tr className="border-b border-line-soft">
                              {[
                                "Raw Material",
                                "Store",
                                "Before",
                                "After",
                                "Issued",
                                "Remarks",
                              ].map((h, i) => (
                                <th
                                  key={h}
                                  scope="col"
                                  className={`sl-th px-4 py-2 ${i >= 2 && i <= 4 ? "text-right" : "text-left"}`}
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-soft">
                            {adj.items.map((item: any, idx: number) => (
                              <tr key={idx}>
                                <td className="px-4 py-2.5">
                                  <div className="font-semibold text-ink">
                                    {item.rawMaterialName}
                                  </div>
                                  {item.rawMaterialCode && item.rawMaterialCode !== "-" && (
                                    <div className="font-mono text-xs text-ink-subtle">
                                      {item.rawMaterialCode}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-ink-muted">{item.store}</td>
                                <td className="px-4 py-2.5 text-right text-xs text-ink-muted tabular-nums">
                                  {item.currentQty.toFixed(3)} {item.uom}
                                </td>
                                <td className="px-4 py-2.5 text-right text-xs text-ink-muted tabular-nums">
                                  {item.adjustedQty.toFixed(3)} {item.uom}
                                </td>
                                <td
                                  className={`whitespace-nowrap px-4 py-2.5 text-right text-xs font-bold tabular-nums ${item.difference < 0 ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success)]"}`}
                                >
                                  {item.difference < 0 ? "" : "+"}
                                  {item.difference.toFixed(3)} {item.uom}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-ink-muted">
                                  {item.remarks}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              </Tile>
            )}

            {/* ── Status Change History ─────────────────────── */}
            {tab === "activity" && (
              <Tile title="Status Change History">
                <ol className="m-0 flex list-none flex-col p-0">
                  {historyRecords.map((rec: any, idx: number) => (
                    <li
                      key={rec.id ?? rec.changedAt ?? idx}
                      className="relative flex gap-4 pb-5 last:pb-0"
                    >
                      {idx < historyRecords.length - 1 && (
                        <span
                          className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-0.5 bg-line-soft"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className="mt-1.5 h-4 w-4 shrink-0 rounded-full border-[3px] border-card bg-accent ring-2 ring-chip"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{rec.action || "-"}</span>
                          {rec.fromStatus && (
                            <>
                              <StatusBadge status={rec.fromStatus} />
                              <span className="text-ink-subtle" aria-label="to">
                                →
                              </span>
                            </>
                          )}
                          <StatusBadge status={rec.toStatus} />
                        </div>
                        <div className="sl-muted mt-0.5 text-[13px]">
                          {formatDateTime(rec.changedAt)} ·{" "}
                          {rec.changedByName || rec.changedBy || "-"}
                        </div>
                        {rec.remarks && (
                          <p className="m-0 mt-1 text-[13px] text-ink-muted">{rec.remarks}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </Tile>
            )}
          </div>
        </>
      )}
    </PageBody>
  );
};

export default ProductionOrderHistoryView;
