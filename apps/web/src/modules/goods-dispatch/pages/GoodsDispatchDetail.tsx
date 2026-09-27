import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import { Truck } from "lucide-react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchGoodsDispatchById } from "../../../features/goods-dispatch/goodsDispatchSlice";

import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { formatDate, formatDateTime } from "../../../utils/dateUtils";
import EwayBillPanel from "../../compliance/components/EwayBillPanel";
import {
  Chip,
  EmptyState,
  PageHeader,
  SectionLabel,
  SkeletonTile,
  StatTile,
  Tile,
  actionPillClass,
} from "../../../components/ui/v2";
import { Link } from "react-router-dom";

const InfoField = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="m-0 mb-1 text-[13px] font-medium text-ink-subtle">{label}</p>
    <div className="text-sm font-semibold text-ink">{value || "—"}</div>
  </div>
);

const formatUOM = (code: string | null | undefined) => {
  if (!code) return "PCS";
  const upper = code.toUpperCase();
  return upper === "EA" || upper === "EACH" ? "PCS" : upper;
};

const n = (v: unknown) => Number(v || 0).toLocaleString("en-IN");

type TimelineTone = "muted" | "info" | "success" | "danger";
const DOT: Record<TimelineTone, string> = {
  muted: "bg-ink-subtle",
  info: "bg-accent",
  success: "bg-[color:var(--color-success)]",
  danger: "bg-[color:var(--color-danger)]",
};

const TimelineStep: React.FC<{
  tone: TimelineTone;
  title: string;
  at: string;
  note?: string | null;
  last?: boolean;
}> = ({ tone, title, at, note, last }) => (
  <li className={`relative pl-6 ${last ? "" : "pb-5"}`}>
    {!last && <span className="absolute left-[5px] top-3 h-full w-px bg-line" aria-hidden="true" />}
    <span
      className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full ${DOT[tone]}`}
      aria-hidden="true"
    />
    <p className="m-0 text-sm font-semibold text-ink">{title}</p>
    <p className="m-0 mt-0.5 text-xs text-ink-subtle">{at}</p>
    {note && <p className="m-0 mt-1 text-xs italic text-ink-muted">"{note}"</p>}
  </li>
);

const GoodsDispatchDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const { currentDispatch: dispatchData, loading } = useAppSelector((state) => state.goodsDispatch);

  useEffect(() => {
    if (id) dispatch(fetchGoodsDispatchById(id));
  }, [dispatch, id]);

  if (loading && !dispatchData) {
    return (
      <div className="w-full min-w-0">
        <PageHeader
          title="Goods Dispatch"
          back="/production/goods-dispatch"
          backLabel="Back to dispatches"
        />
        <span className="sr-only">Loading dispatch details...</span>
        <div className="flex flex-col gap-4">
          <SkeletonTile lines={2} />
          <SkeletonTile lines={5} />
        </div>
      </div>
    );
  }

  if (!dispatchData) {
    return (
      <div className="w-full min-w-0">
        <PageHeader
          title="Goods Dispatch"
          back="/production/goods-dispatch"
          backLabel="Back to dispatches"
        />
        <Tile>
          <EmptyState
            icon={<Truck size={26} strokeWidth={1.75} />}
            title="Goods Dispatch not found."
            action={
              <Link
                to="/production/goods-dispatch"
                className={actionPillClass({ variant: "secondary" })}
              >
                Back to list
              </Link>
            }
          />
        </Tile>
      </div>
    );
  }

  const items = dispatchData.items || [];
  const totalDispatched = items.reduce((s: number, i: any) => s + Number(i.dispatchQty || 0), 0);
  const anyReceived = items.some((i: any) => i.receivedQty !== null && i.receivedQty !== undefined);
  const totalReceived = items.reduce((s: number, i: any) => s + Number(i.receivedQty || 0), 0);
  const gateRejected = dispatchData.status === "GATE_REJECTED";
  const storeRejected = dispatchData.status === "STORE_REJECTED";

  const columns: DataTableColumn<any>[] = [
    {
      header: "PO No",
      render: (item) => (
        <span className="font-semibold text-ink">{item.productionOrder?.productionOrderId}</span>
      ),
    },
    {
      header: "Product",
      render: (item) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink">{item.product?.productName}</div>
          <div className="font-mono text-xs text-ink-subtle">{item.product?.productCode}</div>
        </div>
      ),
    },
    {
      header: "Dispatch Qty",
      align: "right",
      render: (item) => (
        <span className="font-semibold tabular-nums text-ink">
          {n(item.dispatchQty)} {formatUOM(item.uom)}
        </span>
      ),
    },
    {
      header: "Received Qty",
      align: "right",
      render: (item) => {
        const received = item.receivedQty !== null && item.receivedQty !== undefined;
        const short = received && Number(item.receivedQty) < Number(item.dispatchQty);
        return (
          <div className="flex flex-col items-end gap-1">
            <span className="font-semibold tabular-nums text-accent">
              {received ? `${n(item.receivedQty)} ${formatUOM(item.uom)}` : "—"}
            </span>
            {short && (
              <Chip size="sm" tone="danger" className="tabular-nums">
                {n(Number(item.dispatchQty) - Number(item.receivedQty))} {formatUOM(item.uom)}{" "}
                Missing
              </Chip>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={dispatchData.dispatchNumber}
        subtitle={`Dispatched ${formatDate(dispatchData.dispatchDate)}${dispatchData.store?.storeName ? ` · to ${dispatchData.store.storeName}` : ""}`}
        meta={<StatusBadge status={dispatchData.status} />}
        icon={<Truck size={22} />}
        back="/production/goods-dispatch"
        backLabel="Back to dispatches"
        breadcrumbs={[
          { label: "Production" },
          { label: "Goods dispatch", to: "/production/goods-dispatch" },
          { label: dispatchData.dispatchNumber },
        ]}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Production orders" value={items.length} />
        <StatTile label="Dispatched" value={n(totalDispatched)} hint="units" />
        <StatTile
          label="Received"
          value={anyReceived ? n(totalReceived) : "—"}
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
          <section aria-label="Dispatched Items">
            <SectionLabel>Dispatched Items</SectionLabel>
            <DataTable
              data={items}
              columns={columns}
              rowKey={(item: any) => item.id}
              density="compact"
              minHeightClassName=""
              ariaLabel="Dispatched items"
              emptyMessage="No items on this dispatch."
            />
          </section>

          {/* E-way bill (P1-12) */}
          <EwayBillPanel
            docType="CHL"
            docRef={String(dispatchData.id)}
            vehicleNo={dispatchData.vehicleNumber}
            documentCancelled={gateRejected || storeRejected}
          />

          <Tile title="Vehicle Information">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoField label="Vehicle Number" value={dispatchData.vehicleNumber} />
              <InfoField label="Driver Name" value={dispatchData.driverName} />
              <InfoField label="Driver Mobile" value={dispatchData.driverMobile} />
              <InfoField label="Transport Name" value={dispatchData.transportName} />
              <InfoField label="Loading Time" value={dispatchData.loadingTime} />
              <div className="col-span-2 md:col-span-3">
                <InfoField label="Remarks" value={dispatchData.remarks} />
              </div>
            </div>
          </Tile>
        </div>

        <Tile title="Status History" className="h-fit">
          <ol className="m-0 list-none p-0">
            <TimelineStep
              tone="muted"
              title="Dispatch Created"
              at={formatDateTime(dispatchData.createdAt)}
              last={!dispatchData.gateApprovedAt && !dispatchData.storeReceivedAt}
            />
            {dispatchData.gateApprovedAt && (
              <TimelineStep
                tone={gateRejected ? "danger" : "info"}
                title={gateRejected ? "Gate Rejected" : "Gate Approved"}
                at={formatDateTime(dispatchData.gateApprovedAt)}
                note={dispatchData.gateRemarks}
                last={!dispatchData.storeReceivedAt}
              />
            )}
            {dispatchData.storeReceivedAt && (
              <TimelineStep
                tone={storeRejected ? "danger" : "success"}
                title={storeRejected ? "Store Rejected" : "Warehouse Received"}
                at={formatDateTime(dispatchData.storeReceivedAt)}
                note={dispatchData.storeRemarks}
                last
              />
            )}
          </ol>
        </Tile>
      </div>
    </div>
  );
};

export default GoodsDispatchDetail;
