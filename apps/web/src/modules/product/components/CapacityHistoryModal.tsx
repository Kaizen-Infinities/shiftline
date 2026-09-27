import React, { useEffect } from "react";
import { Modal } from "../../../components/ui/TailwindPrimitives";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchCapacityHistory,
  clearHistory,
} from "../../../features/product-capacity-history/productCapacityHistorySlice";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable from "../../../components/ui/table/DataTable";
import { StatTile } from "../../../components/ui/v2";
import { useSocketSync } from "../../../hooks/useSocketSync";

interface Props {
  show: boolean;
  onHide: () => void;
  productId?: number;
  productName?: string;
  currentCapacity?: number | null;
}

const CapacityHistoryModal: React.FC<Props> = ({
  show,
  onHide,
  productId,
  productName,
  currentCapacity,
}) => {
  const dispatch = useAppDispatch();
  const { records, loading } = useAppSelector((state) => state.productCapacityHistory);

  useEffect(() => {
    if (show && productId) {
      dispatch(fetchCapacityHistory(productId));
    }
    return () => {
      if (!show) dispatch(clearHistory());
    };
  }, [show, productId, dispatch]);

  useSocketSync("productCapacityHistory", undefined, () => {
    if (show && productId) {
      dispatch(fetchCapacityHistory(productId));
    }
  });

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          Capacity History
          {productName && <span className="text-ink-muted text-sm ml-2">— {productName}</span>}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {currentCapacity !== undefined && currentCapacity !== null && (
          <StatTile
            className="mb-4"
            label="Current capacity"
            value={`${Number(currentCapacity).toLocaleString("en-IN")} / shift`}
          />
        )}

        <DataTable
          data={records}
          rowKey={(r) => r.id}
          loading={loading}
          emptyMessage="No capacity history found for this product."
          minHeightClassName=""
          density="compact"
          ariaLabel="Capacity history"
          columns={[
            {
              header: "#",
              width: "40px",
              align: "center",
              render: (_r, idx) => <span className="text-ink-subtle">{idx + 1}</span>,
            },
            {
              header: "Date",
              render: (r) => (
                <span className="font-semibold text-ink">
                  {new Date(r.productionDate).toLocaleDateString()}
                </span>
              ),
            },
            {
              header: "Production order",
              render: (r) => <span className="text-ink-subtle text-xs">{r.productionOrderId}</span>,
            },
            {
              header: "Previous",
              render: (r) => Number(r.previousCapacity).toLocaleString("en-IN"),
            },
            {
              header: "New",
              render: (r) => (
                <span className="font-bold text-ink">
                  {Number(r.newCapacity).toLocaleString("en-IN")}
                </span>
              ),
            },
            {
              header: "Change",
              render: (r) => {
                const change = Number(r.newCapacity) - Number(r.previousCapacity);
                const isIncrease = change >= 0;
                return (
                  <span
                    className={
                      isIncrease
                        ? "text-[color:var(--color-success)]"
                        : "text-[color:var(--color-danger)]"
                    }
                  >
                    {isIncrease ? "+" : ""}
                    {change.toLocaleString("en-IN")}
                  </span>
                );
              },
            },
            {
              header: "Target",
              render: (r) => (
                <span className="text-ink-subtle">
                  {Number(r.targetQty).toLocaleString("en-IN")}
                </span>
              ),
            },
            {
              header: "Actual",
              render: (r) => (
                <span className="font-bold text-ink">
                  {Number(r.actualQty).toLocaleString("en-IN")}
                </span>
              ),
            },
            {
              header: "Achievement",
              render: (r) => (
                <div className="flex items-center gap-1">
                  <StatusBadge
                    status={
                      r.achievementPct >= 100
                        ? "ACTIVE"
                        : r.achievementPct >= 80
                          ? "IN_PRODUCTION"
                          : "INACTIVE"
                    }
                  />
                  <span className="text-xs text-ink-subtle">
                    {Number(r.achievementPct).toFixed(1)}%
                  </span>
                </div>
              ),
            },
            { header: "Shift", render: (r) => r.shiftId },
            { header: "Machine", render: (r) => r.machineId },
            {
              header: "Operators",
              render: (r) => r.operators || "-",
            },
            {
              header: "Updated by",
              render: (r) => <span className="text-xs text-ink-subtle">{r.updatedBy || "-"}</span>,
            },
          ]}
        />
      </Modal.Body>
    </Modal>
  );
};

export default CapacityHistoryModal;
