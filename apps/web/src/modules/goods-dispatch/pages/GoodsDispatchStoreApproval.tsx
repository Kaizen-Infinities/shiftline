import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchGoodsDispatchById,
  storeReceiveDispatch,
} from "../../../features/goods-dispatch/goodsDispatchSlice";
import {
  DecisionTile,
  DispatchHeader,
  DispatchItemsTable,
  DispatchPlaceholder,
  ReceivedInput,
  StatusTimeline,
  VehicleTile,
} from "../components/DispatchParts";

const GoodsDispatchStoreApproval: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const { currentDispatch: dispatchData, loading } = useAppSelector((state) => state.goodsDispatch);

  const [remarks, setRemarks] = useState("");
  const [receivedQuantities, setReceivedQuantities] = useState<Record<number, string>>({});

  useEffect(() => {
    if (id) {
      dispatch(fetchGoodsDispatchById(id));
    }
  }, [dispatch, id]);

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
    if (dispatchData && dispatchData.status !== "PENDING_STORE_RECEIPT") {
      toast.info(
        `This dispatch is already ${dispatchData.status.replace(/_/g, " ").toLowerCase()}. Redirecting...`
      );
      navigate(`/production/goods-dispatch/view/${id}`, { replace: true });
    }
  }, [dispatchData, id, navigate]);

  if (loading && !dispatchData) {
    return <DispatchPlaceholder loading title="Store Receipt" />;
  }

  if (!dispatchData) {
    return <DispatchPlaceholder loading={false} title="Store Receipt" />;
  }

  const handleApprove = async () => {
    try {
      const receivedItems = dispatchData.items?.map((item: any) => ({
        itemId: Number(item.id),
        receivedQty: Number(receivedQuantities[item.id] || item.dispatchQty),
      }));

      await dispatch(
        storeReceiveDispatch({
          id: dispatchData.id,
          data: { action: "APPROVE", remarks, receivedItems },
        })
      ).unwrap();
      toast.success("Store receipt approved successfully. Stock updated.");
      navigate(`/production/goods-dispatch/view/${id}`, { replace: true });
    } catch (err: any) {
      toast.error(err);
    }
  };

  const handleReject = async () => {
    if (!remarks.trim()) {
      toast.error("Remarks are required for rejection");
      return;
    }
    try {
      await dispatch(
        storeReceiveDispatch({
          id: dispatchData.id,
          data: { action: "REJECT", remarks },
        })
      ).unwrap();
      toast.success("Store receipt rejected");
      navigate(`/production/goods-dispatch/view/${id}`, { replace: true });
    } catch (err: any) {
      toast.error(err);
    }
  };

  return (
    <div className="w-full min-w-0">
      <DispatchHeader data={dispatchData} prefix="Store receipt" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <DispatchItemsTable
            items={dispatchData.items || []}
            received={(item: any) => (
              <ReceivedInput
                item={item}
                value={receivedQuantities[item.id] ?? ""}
                onChange={(val) => setReceivedQuantities((prev) => ({ ...prev, [item.id]: val }))}
              />
            )}
          />
          <VehicleTile data={dispatchData} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DecisionTile
            title="Store Receipt Action"
            note={
              <>
                Approving will automatically update Finished Goods Stock in{" "}
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
            onApprove={handleApprove}
            onReject={handleReject}
            loading={loading}
          />
          <StatusTimeline data={dispatchData} />
        </div>
      </div>
    </div>
  );
};

export default GoodsDispatchStoreApproval;
