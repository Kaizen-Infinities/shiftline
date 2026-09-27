import React, { useEffect, useState } from "react";
import { PackageMinus, X } from "lucide-react";
import { ActionPill, Chip, Skeleton } from "../../../components/ui/v2";
import { formatDate as formatDisplayDate } from "../../../utils/dateUtils";
import { toast } from "react-toastify";
import { productionOrderService } from "../../../services/productionOrderService";
import type { ProductionOrder } from "../../../services/productionOrderService";
import { rawMaterialService } from "../../../services/rawMaterialService";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import { MaterialIssueModal } from "./MaterialIssueModal";

interface ProductionOrderViewModalProps {
  show: boolean;
  onHide: () => void;
  order: ProductionOrder | null;
  onSuccess?: () => void;
}

export const ProductionOrderViewModal: React.FC<ProductionOrderViewModalProps> = ({
  show,
  onHide,
  order,
  onSuccess,
}) => {
  const [fullOrder, setFullOrder] = useState<any>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [selectedProdForIssue, setSelectedProdForIssue] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [rawMaterialsMap, setRawMaterialsMap] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    rawMaterialService
      .fetchAll()
      .then((data) => {
        const arr = Array.isArray(data) ? data : ((data as any)?.rawMaterials ?? []);
        const map = new Map<string, any>();
        arr.forEach((rm: any) => map.set(rm.rawMaterialId?.toString(), rm));
        setRawMaterialsMap(map);
      })
      .catch((err) => console.error("Failed to fetch raw materials", err));
  }, []);

  useEffect(() => {
    if (show && order) {
      setLoading(true);
      const fetchIds =
        (order as any).items &&
        Array.isArray((order as any).items) &&
        (order as any).items.length > 0
          ? (order as any).items.map((i: any) => i.productionOrderId || i.id)
          : [order.productionOrderId || order.id];

      Promise.all(fetchIds.map((id: string) => productionOrderService.getById(id)))
        .then((dataArray) => {
          if (dataArray.length > 0) {
            const mergedOrder = { ...dataArray[0] };
            mergedOrder.products = dataArray.map((d: any) => ({
              productName: d.productItem?.productName || "Unknown",
              productCode: d.productItem?.productCode || "Unknown",
              quantity: d.targetQty || 0,
              uom: d.uom || d.productItem?.uom || "pcs",
              weightPerPieceUsed: d.productItem?.weightPerPiece || 0,
              rawMaterials: d.draftRawMaterials || d.rawMaterials || [],
              productionOrderId: d.productionOrderId,
              status: d.status,
            }));
            mergedOrder.productionOrderId = order.productionOrderId || order.id;
            setFullOrder(mergedOrder);
          } else {
            setFullOrder(null);
          }
        })
        .catch((err) => {
          console.error("❌ Failed to fetch PO details:", err);
          toast.error("Failed to load production order details");
        })
        .finally(() => setLoading(false));
    } else {
      setFullOrder(null);
    }
  }, [show, order]);

  if (!order) return null;

  const formatDate = (dateString?: string) => (dateString ? formatDisplayDate(dateString) : "-");

  const hasInsufficientStock = fullOrder?.products?.some((p: any) =>
    p.rawMaterials?.some((rm: any) => {
      const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
      const required = Number(rm.requiredQty || 0);
      let available = stockRm
        ? Number(stockRm.onHandQty || 0) - Number(stockRm.reservedQty || 0)
        : Number(rm.availableStock || 0);
      const isReservedStatus = [
        "RM_AVAILABLE",
        "READY_FOR_PLANNING",
        "SCHEDULED",
        "IN_PROGRESS",
        "IN PROGRESS",
      ].includes(fullOrder?.status);
      if (isReservedStatus && stockRm) {
        available += required;
      }
      return rm.status ? rm.status === "INSUFFICIENT" : available < required;
    })
  );

  if (!show) return null;
  return (
    <>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4">
        <div className="sl-backdrop" aria-hidden="true" />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="po-view-modal-title"
          className="sl-dialog flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="sl-dialog-header border-b border-line-soft pb-4">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 id="po-view-modal-title" className="sl-dialog-title">
                Production Order Details
              </h3>
              <Chip size="sm" tone="muted" className="font-mono">
                {fullOrder?.productionOrderId || order.productionOrderId}
              </Chip>
            </div>
            <button
              type="button"
              onClick={onHide}
              aria-label="Close"
              className="sl-icon-btn sl-icon-btn-ghost"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto flex-1">
            {hasInsufficientStock && (
              <div className="rounded-[14px] bg-card-2 text-[color:var(--color-danger)] px-4 py-3 shadow-[inset_4px_0_0_var(--color-danger)] flex items-center gap-2 mb-4 text-sm font-medium">
                One or more required raw materials have insufficient stock. Please create a Raw
                Material Order before proceeding to Weekly Machine Assignment.
              </div>
            )}

            {loading ? (
              <div className="flex flex-col gap-3" role="status">
                <span className="sr-only">Loading details...</span>
                <Skeleton height={96} />
                <Skeleton height={160} />
                <Skeleton height={120} />
              </div>
            ) : (
              <div className="space-y-6">
                {/* General Details Grid */}
                <div className="bg-card-2 p-4 rounded-[16px]">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-y-4 gap-x-6">
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Order No
                      </div>
                      <div className="font-semibold text-ink">
                        {fullOrder?.productionOrderId || order.productionOrderId}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Sales Order No
                      </div>
                      <div className="font-semibold text-ink">
                        {fullOrder?.salesOrderDetails?.orderNo ||
                        order.salesOrderDetails?.orderNo ||
                        order.sourceSalesOrderId ? (
                          fullOrder?.salesOrderDetails?.orderNo ||
                          order.salesOrderDetails?.orderNo ||
                          order.sourceSalesOrderId
                        ) : (
                          <span className="sl-chip sl-chip-sm sl-chip-muted">Direct Order</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Customer
                      </div>
                      <div className="font-semibold text-ink">
                        {fullOrder?.salesOrderDetails?.customerName ||
                        order.salesOrderDetails?.customerName ? (
                          fullOrder?.salesOrderDetails?.customerName ||
                          order.salesOrderDetails?.customerName
                        ) : (
                          <span className="text-ink-subtle italic text-sm">N/A (Direct)</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Order Date
                      </div>
                      <div className="font-semibold text-ink">
                        {formatDate(fullOrder?.orderDate || order.orderDate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Due Date
                      </div>
                      <div className="font-semibold text-ink">
                        {formatDate(fullOrder?.dueDate || order.dueDate)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Priority
                      </div>
                      <div className="font-semibold text-ink">
                        {fullOrder?.priority || order.priority || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Order Type
                      </div>
                      <div className="font-semibold text-ink">
                        {fullOrder?.orderType || order.orderType || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Status
                      </div>
                      <div className="flex flex-col gap-1">
                        <div>
                          <StatusBadge status={fullOrder?.status || order.status} />
                        </div>
                        {fullOrder?.productionOrderHistories?.some(
                          (h: any) => h.toStatus === "COMPLETED_WITH_SHORTFALL"
                        ) && (
                          <span className="text-[10px] text-[color:var(--color-danger)] font-bold uppercase leading-none mt-0.5 whitespace-nowrap">
                            Force Stopped / Short-Closed
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-1 md:col-span-3 pt-2 border-t border-line-soft mt-2">
                      <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                        Remarks / Notes
                      </div>
                      <div className="font-medium text-ink bg-card p-3 rounded-[14px] border border-line-soft text-sm whitespace-pre-wrap">
                        {fullOrder?.remarks || order.remarks || (
                          <span className="text-ink-subtle font-normal italic">
                            No remarks provided
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Products List */}
                {fullOrder?.products?.map((prod: any, idx: number) => (
                  <div key={idx} className="rounded-[16px] border border-line-soft overflow-hidden">
                    <div className="bg-card border-b border-line p-4">
                      <h4 className="sl-h2 m-0">
                        Product {idx + 1}: {prod.productName}{" "}
                        <span className="text-ink-subtle text-sm font-normal">
                          ({prod.productCode})
                        </span>
                      </h4>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                        <div>
                          <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                            Production Qty
                          </div>
                          <div className="font-semibold text-ink">
                            {prod.quantity}{" "}
                            {prod.uom?.toLowerCase() === "ea" || prod.uom?.toLowerCase() === "each"
                              ? "pcs"
                              : prod.uom}
                          </div>
                        </div>
                        <div>
                          <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                            Weight Used
                          </div>
                          <div className="font-semibold text-ink">
                            {Number(prod.weightPerPieceUsed || 0).toFixed(3)} KG
                          </div>
                        </div>
                        <div>
                          <div className="text-[12px] font-medium uppercase tracking-[0.04em] text-ink-subtle mb-0.5">
                            Unit (UOM)
                          </div>
                          <div className="font-semibold text-ink">
                            {prod.uom?.toLowerCase() === "ea" || prod.uom?.toLowerCase() === "each"
                              ? "pcs"
                              : prod.uom}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-card-2">
                      <div className="sl-section-label mb-2">Required Raw Materials</div>
                      <div className="bg-card rounded-[14px] border border-line-soft overflow-hidden">
                        <table className="w-full text-left text-sm text-ink-muted">
                          <thead className="bg-card-2 border-b border-line-soft">
                            <tr>
                              <th scope="col" className="sl-th px-4 py-3">
                                Raw Material Code
                              </th>
                              <th scope="col" className="sl-th px-4 py-3">
                                Raw Material Name
                              </th>
                              <th scope="col" className="sl-th px-4 py-3">
                                Required Qty
                              </th>
                              <th scope="col" className="sl-th px-4 py-3">
                                Available Stock
                              </th>
                              <th scope="col" className="sl-th px-4 py-3">
                                Stock Status
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line-soft">
                            {prod.rawMaterials?.map((rm: any) => {
                              const stockRm = rawMaterialsMap.get(rm.rawMaterialId?.toString());
                              const required = Number(rm.requiredQty || 0);
                              let available = stockRm
                                ? Number(stockRm.onHandQty || 0) - Number(stockRm.reservedQty || 0)
                                : Number(rm.availableStock || 0);
                              const isReservedStatus = [
                                "RM_AVAILABLE",
                                "READY_FOR_PLANNING",
                                "SCHEDULED",
                                "IN_PROGRESS",
                                "IN PROGRESS",
                              ].includes(fullOrder?.status);
                              if (isReservedStatus && stockRm) {
                                available += required;
                              }
                              const materialName =
                                rm.materialName || stockRm?.materialName || rm.rawMaterialId;
                              const isAvailable = rm.status
                                ? rm.status === "AVAILABLE"
                                : available >= required;

                              // Get correct UOM
                              let displayUom =
                                stockRm?.baseUom?.split(",")[0] || rm.uom || stockRm?.uom || "KG";
                              if (
                                displayUom.toLowerCase() === "ea" ||
                                displayUom.toLowerCase() === "each"
                              ) {
                                displayUom = "pcs";
                              }

                              return (
                                <tr key={rm.rawMaterialId} className="sl-row-hover">
                                  <td className="px-4 py-3 font-medium text-ink">
                                    {rm.rawMaterialId}
                                  </td>
                                  <td className="px-4 py-3 text-ink-muted">{materialName}</td>
                                  <td className="px-4 py-3 font-medium">
                                    {required.toFixed(2)} {displayUom}
                                  </td>
                                  <td className="px-4 py-3">
                                    {available.toFixed(2)} {displayUom}
                                  </td>
                                  <td className="px-4 py-3">
                                    <StatusBadge
                                      status={isAvailable ? "AVAILABLE" : "INSUFFICIENT"}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                            {(!prod.rawMaterials || prod.rawMaterials.length === 0) && (
                              <tr>
                                <td colSpan={5} className="text-center text-ink-subtle p-6 italic">
                                  No raw materials defined for this product.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {["RM_AVAILABLE", "READY_FOR_PLANNING", "SCHEDULED"].includes(
                        prod.status || fullOrder?.status
                      ) && (
                        <div className="flex justify-end mt-4">
                          <ActionPill
                            icon={<PackageMinus size={17} />}
                            onClick={() => {
                              setSelectedProdForIssue(prod);
                              setShowIssueModal(true);
                            }}
                          >
                            Issue Raw Materials
                          </ActionPill>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Shift / Daily Execution & Dispatch History */}
                {(() => {
                  const plans: any[] = [];
                  const coveredWeeklyProgramIds = new Set<string>();

                  if (
                    fullOrder?.dailyProductionPlans &&
                    fullOrder.dailyProductionPlans.length > 0
                  ) {
                    fullOrder.dailyProductionPlans.forEach((plan: any) => {
                      if (plan.weeklyProgramId) {
                        coveredWeeklyProgramIds.add(plan.weeklyProgramId);
                      }
                      const hourlySum =
                        plan.hourlyProductions?.reduce(
                          (acc: number, curr: any) => acc + Number(curr.qtyProduced || 0),
                          0
                        ) || 0;
                      const producedForPlan =
                        hourlySum > 0
                          ? hourlySum
                          : plan.status === "COMPLETED"
                            ? Number(plan.plannedQty || 0)
                            : 0;
                      plans.push({
                        id: plan.dailyPlanId,
                        date: plan.productionDate ? formatDisplayDate(plan.productionDate) : "-",
                        shiftName: plan.shift?.shiftName || plan.shiftId || "-",
                        machineName:
                          plan.machine?.machineName ||
                          plan.machineId ||
                          fullOrder?.Machine?.machineName ||
                          (order as any)?.machineName ||
                          "-",
                        plannedQty: Number(plan.plannedQty || 0),
                        producedQty: producedForPlan,
                        status: plan.status || "PLANNED",
                      });
                    });
                  }

                  const totalDispatchedQty = fullOrder?.goodsDispatchItems
                    ? fullOrder.goodsDispatchItems.reduce(
                        (sum: number, item: any) => sum + Number(item.dispatchQty || 0),
                        0
                      )
                    : 0;
                  let cumulativeProduced = 0;

                  return (
                    <>
                      <div className="rounded-[16px] border border-line-soft overflow-hidden mt-6">
                        <div className="bg-card border-b border-line p-4 flex justify-between items-center flex-wrap gap-2">
                          <h4 className="sl-h2 m-0">Shift-wise Production & Dispatch Details</h4>
                          {(() => {
                            const targetVal = Number(fullOrder?.targetQty || order.targetQty || 0);
                            const producedVal = Number(
                              fullOrder?.producedQty || order.producedQty || 0
                            );
                            const hasShortfallStop =
                              fullOrder?.status === "COMPLETED_WITH_SHORTFALL";

                            return (
                              <div className="flex items-center gap-2 flex-wrap text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                                <span>
                                  Target: <span className="text-ink font-bold">{targetVal}</span>
                                </span>
                                <span>|</span>
                                <span>
                                  Produced:{" "}
                                  <span className="text-[color:var(--color-success)] font-bold">
                                    {producedVal}
                                  </span>
                                </span>
                                <span>|</span>
                                <span>
                                  Dispatched:{" "}
                                  <span className="text-[color:var(--color-info)] font-bold">
                                    {totalDispatchedQty}
                                  </span>
                                </span>
                                {hasShortfallStop && (
                                  <>
                                    <span>|</span>
                                    <span className="sl-chip sl-chip-sm sl-chip-danger whitespace-nowrap">
                                      Permanently Stopped (Shortfall:{" "}
                                      {Math.max(0, targetVal - producedVal)} pcs)
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="p-4 bg-card-2 overflow-x-auto">
                          <div className="bg-card rounded-[14px] border border-line-soft overflow-hidden min-w-[750px]">
                            <table className="w-full text-left text-sm text-ink-muted">
                              <thead className="bg-card-2 border-b border-line-soft">
                                <tr>
                                  <th scope="col" className="sl-th px-4 py-3">
                                    Date
                                  </th>
                                  <th scope="col" className="sl-th px-4 py-3">
                                    Shift
                                  </th>
                                  <th scope="col" className="sl-th px-4 py-3">
                                    Machine
                                  </th>
                                  <th scope="col" className="sl-th px-4 py-3">
                                    Planned Qty
                                  </th>
                                  <th scope="col" className="sl-th px-4 py-3">
                                    Produced Qty
                                  </th>
                                  <th scope="col" className="sl-th px-4 py-3 whitespace-nowrap">
                                    Production Status
                                  </th>
                                  <th
                                    scope="col"
                                    className="sl-th px-4 py-3 whitespace-nowrap text-center"
                                  >
                                    Dispatch Status
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line-soft">
                                {plans.length > 0 ? (
                                  plans.map((plan: any, idx: number) => {
                                    cumulativeProduced += plan.producedQty;
                                    const isPlanDispatched =
                                      totalDispatchedQty > 0 &&
                                      cumulativeProduced <= totalDispatchedQty + 0.001;
                                    const isReadyForDispatch =
                                      plan.status === "COMPLETED" ||
                                      fullOrder?.status === "READY_FOR_DISPATCH" ||
                                      fullOrder?.status === "COMPLETED";

                                    let dispatchBadge = (
                                      <span className="sl-chip sl-chip-sm sl-chip-muted">
                                        Not Dispatched
                                      </span>
                                    );
                                    if (isPlanDispatched) {
                                      dispatchBadge = (
                                        <span className="sl-chip sl-chip-sm sl-chip-muted">
                                          Dispatched
                                        </span>
                                      );
                                    } else if (isReadyForDispatch) {
                                      dispatchBadge = (
                                        <span className="sl-chip sl-chip-sm sl-chip-muted">
                                          Ready for Dispatch
                                        </span>
                                      );
                                    }

                                    return (
                                      <tr key={plan.id || idx} className="sl-row-hover">
                                        <td className="px-4 py-3 font-medium text-ink">
                                          {plan.date}
                                        </td>
                                        <td className="px-4 py-3 text-ink-muted">
                                          {plan.shiftName}
                                        </td>
                                        <td className="px-4 py-3 text-ink-muted">
                                          {plan.machineName}
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-ink-muted">
                                          {Number(plan.plannedQty || 0).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-[color:var(--color-success)]">
                                          {Number(plan.producedQty || 0).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3">
                                          <StatusBadge status={plan.status} />
                                        </td>
                                        <td className="px-4 py-3 text-center">{dispatchBadge}</td>
                                      </tr>
                                    );
                                  })
                                ) : (
                                  <tr className="sl-row-hover">
                                    <td className="px-4 py-3 font-medium text-ink">
                                      {formatDisplayDate(fullOrder?.orderDate || order.orderDate)}
                                    </td>
                                    <td className="px-4 py-3 text-ink-muted">General Shift</td>
                                    <td className="px-4 py-3 text-ink-muted">
                                      {fullOrder?.Machine?.machineName ||
                                        fullOrder?.machineMachineId ||
                                        (order as any)?.machineName ||
                                        (order as any)?.machineMachineId ||
                                        "-"}
                                    </td>
                                    <td className="px-4 py-3 font-semibold text-ink-muted">
                                      {Number(fullOrder?.targetQty || order.targetQty || 0).toFixed(
                                        2
                                      )}
                                    </td>
                                    <td className="px-4 py-3 font-bold text-[color:var(--color-success)]">
                                      {Number(
                                        fullOrder?.producedQty || order.producedQty || 0
                                      ).toFixed(2)}
                                    </td>
                                    <td className="px-4 py-3">
                                      <StatusBadge status={fullOrder?.status || order.status} />
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                      {fullOrder?.status === "DISPATCHED" ? (
                                        <span className="sl-chip sl-chip-sm sl-chip-muted">
                                          Dispatched
                                        </span>
                                      ) : fullOrder?.status === "READY_FOR_DISPATCH" ||
                                        fullOrder?.status === "COMPLETED" ? (
                                        <span className="sl-chip sl-chip-sm sl-chip-muted">
                                          Ready for Dispatch
                                        </span>
                                      ) : (
                                        <span className="sl-chip sl-chip-sm sl-chip-muted">
                                          Not Dispatched
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>

                      {/* Dispatch History Section */}
                      {fullOrder?.goodsDispatchItems && fullOrder.goodsDispatchItems.length > 0 && (
                        <div className="rounded-[16px] border border-line-soft overflow-hidden mt-6">
                          <div className="bg-card border-b border-line p-4">
                            <h4 className="sl-h2 m-0">Dispatch History</h4>
                          </div>
                          <div className="p-4 bg-card-2 overflow-x-auto">
                            <div className="bg-card rounded-[14px] border border-line-soft overflow-hidden min-w-[700px]">
                              <table className="w-full text-left text-sm text-ink-muted">
                                <thead className="bg-card-2 border-b border-line-soft">
                                  <tr>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Dispatch No
                                    </th>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Date
                                    </th>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Vehicle
                                    </th>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Driver
                                    </th>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Dispatch Qty
                                    </th>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Received Qty
                                    </th>
                                    <th scope="col" className="sl-th px-4 py-3">
                                      Status
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line-soft">
                                  {fullOrder.goodsDispatchItems?.map((item: any) => {
                                    const dispatch = item?.dispatch || {};
                                    const status = dispatch?.status || "PENDING_GATE_APPROVAL";
                                    const dispatchDate = dispatch.dispatchDate
                                      ? formatDisplayDate(dispatch.dispatchDate)
                                      : "-";
                                    return (
                                      <tr key={item.id} className="sl-row-hover">
                                        <td className="px-4 py-3 font-semibold text-ink">
                                          {dispatch.dispatchNumber || "-"}
                                        </td>
                                        <td className="px-4 py-3 text-ink-muted">{dispatchDate}</td>
                                        <td className="px-4 py-3 text-ink-muted">
                                          {dispatch.vehicleNumber || "-"}
                                        </td>
                                        <td className="px-4 py-3 text-ink-muted">
                                          {dispatch.driverName || "-"}
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-ink-muted">
                                          {Number(item.dispatchQty || 0).toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-[color:var(--color-info)]">
                                          {item.receivedQty !== null &&
                                          item.receivedQty !== undefined
                                            ? Number(item.receivedQty).toFixed(2)
                                            : "-"}
                                        </td>
                                        <td className="px-4 py-3">
                                          <StatusBadge status={status} />
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sl-dialog-footer">
            <ActionPill variant="secondary" onClick={onHide}>
              Close
            </ActionPill>
          </div>
        </div>
      </div>

      {selectedProdForIssue && (
        <MaterialIssueModal
          show={showIssueModal}
          onHide={() => {
            setShowIssueModal(false);
            setSelectedProdForIssue(null);
          }}
          productionOrderId={selectedProdForIssue.productionOrderId}
          rawMaterials={selectedProdForIssue.rawMaterials || []}
          rawMaterialsMap={rawMaterialsMap}
          defaultStoreId={fullOrder?.sourceStoreId}
          onSuccess={() => {
            // Reload details in modal
            setLoading(true);
            const fetchIds =
              (order as any).items &&
              Array.isArray((order as any).items) &&
              (order as any).items.length > 0
                ? (order as any).items.map((i: any) => i.productionOrderId || i.id)
                : [order.productionOrderId || order.id];

            Promise.all(fetchIds.map((id: string) => productionOrderService.getById(id)))
              .then((dataArray) => {
                if (dataArray.length > 0) {
                  const mergedOrder = { ...dataArray[0] };
                  mergedOrder.products = dataArray.map((d: any) => ({
                    productName: d.productItem?.productName || "Unknown",
                    productCode: d.productItem?.productCode || "Unknown",
                    quantity: d.targetQty || 0,
                    uom: d.uom || d.productItem?.uom || "pcs",
                    weightPerPieceUsed: d.productItem?.weightPerPiece || 0,
                    rawMaterials: d.draftRawMaterials || d.rawMaterials || [],
                    productionOrderId: d.productionOrderId,
                    status: d.status,
                  }));
                  mergedOrder.productionOrderId = order.productionOrderId || order.id;
                  setFullOrder(mergedOrder);
                }
              })
              .catch((err) => console.error("Failed to reload PO details after issue", err))
              .finally(() => setLoading(false));

            // Trigger parent refresh
            onSuccess?.();
          }}
        />
      )}
    </>
  );
};

export default ProductionOrderViewModal;
