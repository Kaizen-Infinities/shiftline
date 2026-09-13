import React, { useEffect } from "react";
import { Modal } from "../../../components/ui/TailwindPrimitives";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchCapacityHistory,
  clearHistory,
} from "../../../features/product-capacity-history/productCapacityHistorySlice";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable from "../../../components/ui/table/DataTable";
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
          <div className="bg-card-2 border border-line rounded-sm p-3 mb-4">
            <span className="inline-flex items-center px-2 py-0.5 rounded-sm border border-line bg-card text-ink-muted text-[11px] font-semibold mb-2">
              CURRENT CAPACITY
            </span>
            <h3 className="text-lg font-bold text-ink mb-0">
              {Number(currentCapacity).toLocaleString()} / Shift
            </h3>
          </div>
        )}

        <DataTable
          data={records}
          rowKey={(r) => r.id}
          loading={loading}
          emptyMessage="No capacity history found for this product."
          minHeightClassName=""
          columns={[
            {
              header: "#",
              width: "40px",
              align: "center",
              render: (_r, idx) => <span className="text-ink-subtle">{idx + 1}</span>,
            },
            {
              header: "DATE",
              render: (r) => (
                <span className="font-semibold text-ink">
                  {new Date(r.productionDate).toLocaleDateString()}
                </span>
              ),
            },
            {
              header: "PRODUCTION ORDER",
              render: (r) => <span className="text-ink-subtle text-xs">{r.productionOrderId}</span>,
            },
            {
              header: "PREVIOUS",
              render: (r) => Number(r.previousCapacity).toLocaleString(),
            },
            {
              header: "NEW",
              render: (r) => (
                <span className="font-bold text-ink">{Number(r.newCapacity).toLocaleString()}</span>
              ),
            },
            {
              header: "CHANGE",
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
                    {change.toLocaleString()}
                  </span>
                );
              },
            },
            {
              header: "TARGET",
              render: (r) => (
                <span className="text-ink-subtle">{Number(r.targetQty).toLocaleString()}</span>
              ),
            },
            {
              header: "ACTUAL",
              render: (r) => (
                <span className="font-bold text-ink">{Number(r.actualQty).toLocaleString()}</span>
              ),
            },
            {
              header: "ACHIEVEMENT",
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
            { header: "SHIFT", render: (r) => r.shiftId },
            { header: "MACHINE", render: (r) => r.machineId },
            {
              header: "OPERATORS",
              render: (r) => r.operators || "-",
            },
            {
              header: "UPDATED BY",
              render: (r) => <span className="text-xs text-ink-subtle">{r.updatedBy || "-"}</span>,
            },
          ]}
        />
      </Modal.Body>
    </Modal>
  );
};

export default CapacityHistoryModal;
