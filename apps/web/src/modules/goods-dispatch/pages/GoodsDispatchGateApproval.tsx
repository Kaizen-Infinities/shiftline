import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  fetchGoodsDispatchById,
  gateApproveDispatch,
} from "../../../features/goods-dispatch/goodsDispatchSlice";
import {
  DecisionTile,
  DispatchHeader,
  DispatchItemsTable,
  DispatchPlaceholder,
  StatusTimeline,
  VehicleTile,
} from "../components/DispatchParts";

const GoodsDispatchGateApproval: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const { currentDispatch: dispatchData, loading } = useAppSelector((state) => state.goodsDispatch);

  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (id) {
      dispatch(fetchGoodsDispatchById(id));
    }
  }, [dispatch, id]);

  useEffect(() => {
    if (dispatchData && dispatchData.status !== "PENDING_GATE_APPROVAL") {
      toast.info(
        `This dispatch is already ${dispatchData.status.replace(/_/g, " ").toLowerCase()}. Redirecting...`
      );
      navigate(`/production/goods-dispatch/view/${id}`, { replace: true });
    }
  }, [dispatchData, id, navigate]);

  if (loading && !dispatchData) {
    return <DispatchPlaceholder loading title="Gate Approval" />;
  }

  if (!dispatchData) {
    return <DispatchPlaceholder loading={false} title="Gate Approval" />;
  }

  const handleApprove = async () => {
    try {
      await dispatch(
        gateApproveDispatch({ id: dispatchData.id, data: { action: "APPROVE", remarks } })
      ).unwrap();
      toast.success("Gate approval approved successfully");
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
        gateApproveDispatch({ id: dispatchData.id, data: { action: "REJECT", remarks } })
      ).unwrap();
      toast.success("Gate approval rejected");
      navigate(`/production/goods-dispatch/view/${id}`, { replace: true });
    } catch (err: any) {
      toast.error(err);
    }
  };

  return (
    <div className="w-full min-w-0">
      <DispatchHeader data={dispatchData} prefix="Gate Approval" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <DispatchItemsTable items={dispatchData.items || []} />
          <VehicleTile data={dispatchData} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DecisionTile
            title="Gate Approval Action"
            remarks={remarks}
            onRemarksChange={setRemarks}
            placeholder="Enter approval or rejection remarks here..."
            approveLabel="Approve"
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

export default GoodsDispatchGateApproval;
