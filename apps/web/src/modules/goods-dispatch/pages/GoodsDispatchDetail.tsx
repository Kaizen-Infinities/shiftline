import React, { useEffect } from "react";
import { useParams } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchGoodsDispatchById } from "../../../features/goods-dispatch/goodsDispatchSlice";

import EwayBillPanel from "../../compliance/components/EwayBillPanel";
import { StatTile } from "../../../components/ui/v2";
import {
  DispatchHeader,
  DispatchItemsTable,
  DispatchPlaceholder,
  StatusTimeline,
  VehicleTile,
} from "../components/DispatchParts";
import { fmtQty } from "../components/dispatchFormat";

const GoodsDispatchDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const { currentDispatch: dispatchData, loading } = useAppSelector((state) => state.goodsDispatch);

  useEffect(() => {
    if (id) dispatch(fetchGoodsDispatchById(id));
  }, [dispatch, id]);

  if (loading && !dispatchData) {
    return <DispatchPlaceholder loading title="Goods Dispatch" />;
  }

  if (!dispatchData) {
    return <DispatchPlaceholder loading={false} title="Goods Dispatch" />;
  }

  const items: any[] = dispatchData.items || [];
  const totalDispatched = items.reduce((s, i) => s + Number(i.dispatchQty || 0), 0);
  const anyReceived = items.some((i) => i.receivedQty !== null && i.receivedQty !== undefined);
  const totalReceived = items.reduce((s, i) => s + Number(i.receivedQty || 0), 0);

  return (
    <div className="w-full min-w-0">
      <DispatchHeader data={dispatchData} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Production orders" value={items.length} />
        <StatTile label="Dispatched" value={fmtQty(totalDispatched)} hint="units" />
        <StatTile
          label="Received"
          value={anyReceived ? fmtQty(totalReceived) : "—"}
          hint={anyReceived ? "units" : "Awaiting store"}
        />
        <StatTile
          label="Vehicle"
          value={<span className="text-xl">{dispatchData.vehicleNumber || "—"}</span>}
          hint={dispatchData.driverName}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
          <DispatchItemsTable items={items} />

          {/* E-way bill (P1-12) */}
          <EwayBillPanel
            docType="CHL"
            docRef={String(dispatchData.id)}
            vehicleNo={dispatchData.vehicleNumber}
            documentCancelled={
              dispatchData.status === "GATE_REJECTED" || dispatchData.status === "STORE_REJECTED"
            }
          />

          <VehicleTile data={dispatchData} />
        </div>

        <StatusTimeline data={dispatchData} />
      </div>
    </div>
  );
};

export default GoodsDispatchDetail;
