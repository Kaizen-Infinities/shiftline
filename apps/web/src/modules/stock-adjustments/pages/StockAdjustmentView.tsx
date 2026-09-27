import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchStockAdjustmentById,
  approveStockAdjustment,
  clearCurrent,
} from "../../../features/stock-adjustments/stockAdjustmentSlice";
import { usePermission } from "../../../hooks/usePermission";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import { formatDate } from "../../../utils/dateUtils";
import { Boxes, CheckCircle2, Info, Pencil, XCircle } from "lucide-react";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  PageHeader,
  SectionLabel,
  SkeletonTile,
  Tile,
} from "../../../components/ui/v2";

const ADJUSTMENT_TYPE_LABELS: Record<string, string> = {
  PRODUCTION_MATERIAL_ISSUE: "Production Material Issue",
  PRODUCTION_MATERIAL_RETURN: "Production Material Return",
  STOCK_INCREASE: "Stock Increase",
  STOCK_DECREASE: "Stock Decrease",
  DAMAGE: "Damage",
  SCRAP: "Scrap",
  OPENING_STOCK: "Opening Stock",
  MANUAL_CORRECTION: "Manual Correction",
  OTHER: "Other",
};

const formatUomStr = (raw: string): string => {
  if (!raw) return "";
  const first = String(raw).split(",")[0].trim().toLowerCase();
  if (first === "ea" || first === "each") return "pcs";
  return first;
};

const getItemUom = (item: any): string => {
  if (!item) return "pcs";
  if (item.uom) {
    const raw =
      typeof item.uom === "object"
        ? item.uom.uomCode || item.uom.uomName || item.uom.code || item.uom.name
        : String(item.uom);
    if (raw) return formatUomStr(raw);
  }
  const isProduct =
    item.itemType === "PRODUCT" ||
    item.itemType === "FINISHED_GOODS" ||
    !!item.product ||
    !!item.productItemId;
  if (isProduct) {
    const pUom = item.product?.uom;
    const prodUom =
      typeof pUom === "object"
        ? pUom.uomCode || pUom.uomName || pUom.code || pUom.name
        : pUom || item.product?.baseUom || item.product?.unit;
    if (prodUom) return formatUomStr(prodUom);
    return "pcs";
  }
  const rmUom = item.rawMaterial?.baseUom || item.rawMaterial?.uom;
  if (rmUom) return formatUomStr(rmUom);
  return "kg";
};

const InfoField = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="m-0 mb-1 text-[13px] font-medium text-ink-subtle">{label}</p>
    <div className="text-sm font-semibold text-ink">{value || "—"}</div>
  </div>
);

const fmt3 = (n: unknown) =>
  Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

const Remark: React.FC<{ text?: string }> = ({ text }) =>
  text ? (
    <span className="block max-w-xs text-xs leading-normal text-ink-muted">{text}</span>
  ) : (
    <span className="text-xs text-ink-subtle">—</span>
  );

const StockAdjustmentView: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const { currentAdjustment, loading } = useAppSelector((state) => state.stockAdjustments);
  const [isApproving, setIsApproving] = useState(false);

  useEffect(() => {
    if (id) dispatch(fetchStockAdjustmentById(id));
    return () => {
      dispatch(clearCurrent());
    };
  }, [dispatch, id]);

  const handleApprove = async (targetStatus: string) => {
    if (!id || isApproving) return;
    setIsApproving(true);
    try {
      await dispatch(approveStockAdjustment({ id, status: targetStatus })).unwrap();
      if (targetStatus === "APPROVED") {
        toast.success(
          "Stock Adjustment approved by MD/Management! Inventory stock has been updated."
        );
      } else {
        toast.info("Stock Adjustment rejected.");
      }
      dispatch(fetchStockAdjustmentById(id));
    } catch (err: any) {
      toast.error(err || "Failed to process approval");
    } finally {
      setIsApproving(false);
    }
  };

  if (loading || !currentAdjustment) {
    return (
      <div className="w-full min-w-0">
        <PageHeader
          title="Stock Adjustment Details"
          back="/inventory/stock-adjustments"
          backLabel="Back to stock adjustments"
        />
        <div className="flex flex-col gap-4">
          <SkeletonTile lines={3} />
          <SkeletonTile lines={5} />
        </div>
      </div>
    );
  }

  const isPMI = currentAdjustment.adjustmentType === "PRODUCTION_MATERIAL_ISSUE";
  const po = currentAdjustment.productionOrder;
  const isApproved = currentAdjustment.status === "APPROVED";
  const isRejected = currentAdjustment.status === "REJECTED";
  const isDraft = currentAdjustment.status === "DRAFT";
  const items: any[] = currentAdjustment.items || [];

  const pmiColumns: DataTableColumn<any>[] = [
    {
      header: "Material",
      render: (item) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink">
            {item.rawMaterial?.materialName || item.rawMaterialId}
          </div>
          <div className="font-mono text-xs text-ink-subtle">{item.rawMaterialId}</div>
        </div>
      ),
    },
    { header: "Store", render: (item) => item.store?.storeName || item.storeId || "—" },
    {
      header: "Stock before",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink-muted">
          {fmt3(item.currentQty)} {getItemUom(item)}
        </span>
      ),
    },
    {
      header: "Stock after",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink-muted">
          {fmt3(item.adjustedQty)} {getItemUom(item)}
        </span>
      ),
    },
    {
      header: "Issued qty",
      align: "right",
      render: (item) => (
        <span className="font-semibold tabular-nums text-[color:var(--color-danger)]">
          {fmt3(Math.abs(Number(item.difference)))} {getItemUom(item)}
        </span>
      ),
    },
    { header: "Remarks", render: (item) => <Remark text={item.remarks} /> },
  ];

  const itemColumns: DataTableColumn<any>[] = [
    {
      header: "Item type",
      render: (item) => {
        const isWastage = item.itemType === "WASTAGE" || item.rawMaterial?.itemType === "WASTAGE";
        const isRM = (item.itemType === "RAW_MATERIAL" || !!item.rawMaterial) && !isWastage;
        return (
          <Chip size="sm" tone={isWastage ? "warning" : isRM ? "success" : "default"}>
            {isWastage ? "Wastage Product" : isRM ? "Raw Material" : "Finished Goods"}
          </Chip>
        );
      },
    },
    {
      header: "Item details",
      render: (item) => {
        const itemName =
          item.rawMaterial?.materialName ||
          item.product?.productName ||
          item.rawMaterialId ||
          item.productItemId ||
          "—";
        const itemCode = item.rawMaterial?.rawMaterialId || item.product?.productCode || "";
        return (
          <div className="min-w-0">
            <div className="font-semibold text-ink">{itemName}</div>
            {itemCode && <div className="font-mono text-xs text-ink-subtle">{itemCode}</div>}
          </div>
        );
      },
    },
    { header: "Store", render: (item) => item.store?.storeName || "—" },
    {
      header: "Current qty",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink-muted">
          {fmt3(item.currentQty)} {getItemUom(item)}
        </span>
      ),
    },
    {
      header: "Adjusted qty",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink">
          {fmt3(item.adjustedQty)} {getItemUom(item)}
        </span>
      ),
    },
    {
      header: "Difference",
      align: "right",
      render: (item) => {
        const diff = Number(item.difference);
        return (
          <Chip
            size="sm"
            tone={diff > 0 ? "success" : diff < 0 ? "danger" : "muted"}
            className="tabular-nums"
          >
            {diff > 0 ? "+" : ""}
            {fmt3(diff)} {getItemUom(item)}
          </Chip>
        );
      },
    },
    { header: "Remarks", render: (item) => <Remark text={item.remarks} /> },
  ];

  const typeLabel =
    ADJUSTMENT_TYPE_LABELS[currentAdjustment.adjustmentType] || currentAdjustment.adjustmentType;

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title="Stock Adjustment Details"
        subtitle={`${currentAdjustment.adjustmentNumber} · ${typeLabel}`}
        back="/inventory/stock-adjustments"
        backLabel="Back to stock adjustments"
        breadcrumbs={[
          { label: "Inventory" },
          { label: "Stock adjustments", to: "/inventory/stock-adjustments" },
          { label: currentAdjustment.adjustmentNumber },
        ]}
        meta={<StatusBadge status={currentAdjustment.status} />}
        actions={
          isDraft && can("stock-adjustments.edit") ? (
            <>
              <ActionPill
                variant="secondary"
                icon={<Pencil size={16} />}
                onClick={() =>
                  navigate(`/inventory/stock-adjustments/edit/${currentAdjustment.id}`)
                }
              >
                Edit
              </ActionPill>
              <ActionPill
                variant="danger"
                icon={<XCircle size={16} />}
                onClick={() => handleApprove("REJECTED")}
                disabled={isApproving}
              >
                Reject
              </ActionPill>
            </>
          ) : null
        }
        primaryAction={
          isDraft && can("stock-adjustments.edit") ? (
            <ActionPill
              icon={<CheckCircle2 size={17} />}
              onClick={() => handleApprove("APPROVED")}
              loading={isApproving}
              loadingText="Processing..."
            >
              Approve (MD Approval)
            </ActionPill>
          ) : undefined
        }
      />

      {isApproved && isPMI && (
        <Tile className="mb-4 flex items-start gap-3">
          <CheckCircle2
            className="mt-0.5 shrink-0 text-[color:var(--color-success)]"
            size={20}
            aria-hidden="true"
          />
          <div>
            <p className="m-0 text-sm font-semibold text-ink">Material Issue Approved</p>
            <p className="m-0 mt-0.5 text-sm text-ink-muted">
              Production Order <strong>{currentAdjustment.productionOrderId}</strong> is now
              eligible to start production. Raw material stock has been deducted.
            </p>
          </div>
        </Tile>
      )}
      {isDraft && isPMI && (
        <Tile className="mb-4 flex items-start gap-3">
          <Info
            className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
            size={20}
            aria-hidden="true"
          />
          <div>
            <p className="m-0 text-sm font-semibold text-ink">Draft — Pending Approval</p>
            <p className="m-0 mt-0.5 text-sm text-ink-muted">
              This Material Issue is in <strong>Draft</strong> status. Approve it to deduct stock
              and allow Production Start.
            </p>
          </div>
        </Tile>
      )}
      {isRejected && (
        <Tile className="mb-4 flex items-start gap-3">
          <XCircle
            className="mt-0.5 shrink-0 text-[color:var(--color-danger)]"
            size={20}
            aria-hidden="true"
          />
          <div>
            <p className="m-0 text-sm font-semibold text-ink">Adjustment Rejected</p>
            {currentAdjustment.approvedBy && (
              <p className="m-0 mt-0.5 text-sm text-ink-muted">
                Rejected by <strong>{currentAdjustment.approvedBy}</strong> on{" "}
                {formatDate(currentAdjustment.approvedAt)}.
              </p>
            )}
          </div>
        </Tile>
      )}

      <div className="flex flex-col gap-4">
        <Tile title="Adjustment information">
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-5">
            <InfoField
              label="Adjustment No."
              value={<span className="font-mono">{currentAdjustment.adjustmentNumber}</span>}
            />
            <InfoField label="Date" value={formatDate(currentAdjustment.adjustmentDate)} />
            <InfoField label="Type" value={<Chip size="sm">{typeLabel}</Chip>} />
            <InfoField label="Status" value={<StatusBadge status={currentAdjustment.status} />} />
            <InfoField
              label="Created By"
              value={currentAdjustment.createdByUser?.fullName || currentAdjustment.createdBy}
            />
            {currentAdjustment.reason && (
              <div className="col-span-2 sm:col-span-3 lg:col-span-5">
                <InfoField label="Adjusted By" value={currentAdjustment.reason} />
              </div>
            )}
          </div>
          {!isPMI && (currentAdjustment.sourceDocument || currentAdjustment.sourceDocId) && (
            <div className="mt-5 grid grid-cols-2 gap-5 border-t border-line-soft pt-4 sm:grid-cols-4">
              <InfoField label="Source Document" value={currentAdjustment.sourceDocument} />
              <InfoField label="Source Doc Reference" value={currentAdjustment.sourceDocId} />
              <InfoField
                label="Auto Generated"
                value={
                  currentAdjustment.autoGenerated ? (
                    <Chip size="sm" tone="info">
                      Auto-generated
                    </Chip>
                  ) : (
                    "No"
                  )
                }
              />
            </div>
          )}
        </Tile>

        {isPMI && po && (
          <Tile title="Production order information" icon={<Boxes size={18} />}>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
              <InfoField
                label="PO Number"
                value={<span className="font-mono">{po.productionOrderId}</span>}
              />
              <InfoField
                label="Product"
                value={
                  <div>
                    <div>{po.productItem?.productName || "—"}</div>
                    {po.productItem?.productCode && (
                      <div className="font-mono text-xs font-normal text-ink-subtle">
                        {po.productItem.productCode}
                      </div>
                    )}
                  </div>
                }
              />
              <InfoField
                label="Planned Qty"
                value={
                  po.targetQty
                    ? `${Number(po.targetQty).toLocaleString("en-IN")} ${po.uom || ""}`
                    : "—"
                }
              />
              <InfoField label="Due Date" value={formatDate(po.dueDate)} />
              <InfoField label="Machine" value={po.Machine?.machineName || po.machineMachineId} />
              <InfoField label="PO Status" value={<StatusBadge status={po.status} />} />
            </div>
          </Tile>
        )}

        <section aria-label={isPMI ? "Issued Materials" : "Adjustment Items"}>
          <SectionLabel
            action={
              <Chip size="sm" tone="muted">
                {items.length} item{items.length !== 1 ? "s" : ""}
              </Chip>
            }
          >
            {isPMI ? "Issued Materials" : "Adjustment Items"}
          </SectionLabel>
          <DataTable
            data={items}
            rowKey={(item: any) => item.id || `${item.rawMaterialId}-${item.productItemId}`}
            columns={isPMI ? pmiColumns : itemColumns}
            density="compact"
            ariaLabel={isPMI ? "Issued materials" : "Adjustment items"}
            emptyMessage="No items found"
          />
        </section>
      </div>
    </div>
  );
};

export default StockAdjustmentView;
