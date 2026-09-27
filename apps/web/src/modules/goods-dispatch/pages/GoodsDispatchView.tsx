import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchGoodsDispatchById,
  gateApproveDispatch,
  storeReceiveDispatch,
} from "../../../features/goods-dispatch/goodsDispatchSlice";
import { usePermission } from "../../../hooks/usePermission";
import {
  DecisionTile,
  DispatchHeader,
  DispatchItemsTable,
  DispatchPlaceholder,
  ReceivedInput,
  StatusTimeline,
  VehicleTile,
} from "../components/DispatchParts";

const GoodsDispatchView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();

  const { currentDispatch: dispatchData, loading } = useAppSelector((state) => state.goodsDispatch);
  const { can } = usePermission();
  const canEdit = can("production_orders.edit");

  const [remarks, setRemarks] = useState("");
  const [receivedQuantities, setReceivedQuantities] = useState<Record<number, string>>({});

  useEffect(() => {
    if (dispatchData?.items && dispatchData.status === "PENDING_STORE_RECEIPT") {
      const initial: Record<number, string> = {};
      dispatchData.items.forEach((item: any) => {
        initial[item.id] = String(item.receivedQty || item.dispatchQty);
      });
      setReceivedQuantities(initial);
    }
  }, [dispatchData]);

  useEffect(() => {
    if (id) {
      dispatch(fetchGoodsDispatchById(id));
    }
  }, [dispatch, id]);

  if (loading && !dispatchData) {
    return <DispatchPlaceholder loading title="Goods Dispatch" />;
  }

  if (!dispatchData) {
    return <DispatchPlaceholder loading={false} title="Goods Dispatch" />;
  }

  const handleGateApproval = async (action: "APPROVE" | "REJECT") => {
    if (action === "REJECT" && !remarks) {
      toast.error("Remarks are required for rejection");
      return;
    }
    try {
      await dispatch(
        gateApproveDispatch({ id: dispatchData.id, data: { action, remarks } })
      ).unwrap();
      toast.success(`Gate approval ${action.toLowerCase()} processed`);
      setRemarks("");
    } catch (err: any) {
      toast.error(err);
    }
  };

  const handleStoreReceipt = async (action: "APPROVE" | "REJECT") => {
    if (action === "REJECT" && !remarks) {
      toast.error("Remarks are required for rejection");
      return;
    }
    try {
      const receivedItems =
        action === "APPROVE"
          ? dispatchData.items?.map((item: any) => ({
              itemId: Number(item.id),
              receivedQty: Number(receivedQuantities[item.id] || item.dispatchQty),
            }))
          : undefined;

      await dispatch(
        storeReceiveDispatch({
          id: dispatchData.id,
          data: { action, remarks, receivedItems },
        })
      ).unwrap();
      toast.success(`Store receipt ${action.toLowerCase()} processed`);
      setRemarks("");
    } catch (err: any) {
      toast.error(err);
    }
  };

  const pendingGate = dispatchData.status === "PENDING_GATE_APPROVAL" && canEdit;
  const pendingStore = dispatchData.status === "PENDING_STORE_RECEIPT" && canEdit;

  return (
    <div className="w-full min-w-0">
      <DispatchHeader data={dispatchData} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <DispatchItemsTable
            items={dispatchData.items || []}
            received={
              pendingStore
                ? (item: any) => (
                    <ReceivedInput
                      item={item}
                      value={receivedQuantities[item.id] ?? ""}
                      onChange={(val) =>
                        setReceivedQuantities((prev) => ({ ...prev, [item.id]: val }))
                      }
                    />
                  )
                : undefined
            }
          />
          <VehicleTile data={dispatchData} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {pendingGate && (
            <DecisionTile
              title="Gate Approval"
              remarks={remarks}
              onRemarksChange={setRemarks}
              placeholder="Enter approval or rejection remarks here..."
              approveLabel="Approve"
              onApprove={() => handleGateApproval("APPROVE")}
              onReject={() => handleGateApproval("REJECT")}
              loading={loading}
            />
          )}
          {pendingStore && (
            <DecisionTile
              title="Store Receipt"
              note={
                <>
                  Approving this will automatically update the Finished Goods Stock in{" "}
                  <span className="font-semibold text-ink">
                    {dispatchData.store?.storeName || "the destination store"}
                  </span>
                  .
                </>
              }
              remarks={remarks}
              onRemarksChange={setRemarks}
              placeholder="Enter receipt or rejection remarks here..."
              approveLabel="Receive Stock"
              onApprove={() => handleStoreReceipt("APPROVE")}
              onReject={() => handleStoreReceipt("REJECT")}
              loading={loading}
            />
          )}
          <StatusTimeline data={dispatchData} />
        </div>
      </div>
    </div>
  );
};

export default GoodsDispatchView;
