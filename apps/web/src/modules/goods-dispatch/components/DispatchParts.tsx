import React from "react";
import { Link } from "react-router-dom";
import { Check, Truck, X } from "lucide-react";

import { fmtQty, formatUOM } from "./dispatchFormat";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { formatDate, formatDateTime } from "../../../utils/dateUtils";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SectionLabel,
  SkeletonTile,
  Tile,
  actionPillClass,
} from "../../../components/ui/v2";
import { useT } from "../../../i18n/I18nProvider";

/** Shared building blocks for the goods-dispatch view, gate and store screens. */

export const InfoField = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="m-0 mb-1 text-[13px] font-medium text-ink-subtle">{label}</p>
    <div className="text-sm font-semibold text-ink">{value || "—"}</div>
  </div>
);

const LIST = "/production/goods-dispatch";

/** Loading and not-found states with the page header. */
export const DispatchPlaceholder: React.FC<{ loading: boolean; title: string }> = ({
  loading,
  title,
}) => {
  const { t } = useT();
  return (
    <div className="w-full min-w-0">
      <PageHeader title={title} back={LIST} backLabel={t("dispatch.back")} />
      {loading ? (
        <>
          <span className="sr-only">{t("dispatch.loadingDetails")}</span>
          <div className="flex flex-col gap-4">
            <SkeletonTile lines={2} />
            <SkeletonTile lines={5} />
          </div>
        </>
      ) : (
        <Tile>
          <EmptyState
            icon={<Truck size={26} strokeWidth={1.75} />}
            title={t("dispatch.notFound")}
            action={
              <Link to={LIST} className={actionPillClass({ variant: "secondary" })}>
                {t("dispatch.backToList")}
              </Link>
            }
          />
        </Tile>
      )}
    </div>
  );
};

/** Page header for one dispatch: number, status chip, date and breadcrumb. */
export const DispatchHeader: React.FC<{ data: any; prefix?: string }> = ({ data, prefix }) => {
  const { t } = useT();
  return (
    <PageHeader
      title={prefix ? `${prefix} — ${data.dispatchNumber}` : data.dispatchNumber}
      subtitle={
        t("dispatch.dateSubtitle", { date: formatDate(data.dispatchDate) }) +
        (data.store?.storeName ? t("dispatch.toStore", { store: data.store.storeName }) : "")
      }
      meta={<StatusBadge status={data.status} translate />}
      icon={<Truck size={22} />}
      back={LIST}
      backLabel={t("dispatch.back")}
      breadcrumbs={[
        { label: t("dispatch.crumbProduction") },
        { label: t("dispatch.title"), to: LIST },
        { label: data.dispatchNumber },
      ]}
    />
  );
};

/** Received quantity cell: read-only with a "missing" chip when short. */
export const ReceivedCell: React.FC<{ item: any }> = ({ item }) => {
  const { t } = useT();
  const received = item.receivedQty !== null && item.receivedQty !== undefined;
  const short = received && Number(item.receivedQty) < Number(item.dispatchQty);
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="font-semibold tabular-nums text-accent">
        {received ? `${fmtQty(item.receivedQty)} ${formatUOM(item.uom)}` : "—"}
      </span>
      {short && (
        <Chip size="sm" tone="danger" className="tabular-nums">
          {t("dispatch.missing", {
            qty: `${fmtQty(Number(item.dispatchQty) - Number(item.receivedQty))} ${formatUOM(item.uom)}`,
          })}
        </Chip>
      )}
    </div>
  );
};

/** Received quantity input, capped at the dispatched quantity. */
export const ReceivedInput: React.FC<{
  item: any;
  value: string;
  onChange: (value: string) => void;
}> = ({ item, value, onChange }) => {
  const { t } = useT();
  return (
    <div className="flex items-center justify-end gap-2">
      <input
        name={`receivedQty-${item.id}`}
        type="number"
        inputMode="decimal"
        min={0}
        max={Number(item.dispatchQty)}
        value={value}
        aria-label={t("dispatch.receivedFor", {
          po: item.productionOrder?.productionOrderId ?? "",
        })}
        onChange={(e) => {
          let val = Number(e.target.value);
          if (val > Number(item.dispatchQty)) val = Number(item.dispatchQty);
          onChange(String(val));
        }}
        className="sl-input h-9 w-24 px-2 text-right tabular-nums"
      />
      <span className="text-xs font-semibold text-ink-subtle">{formatUOM(item.uom)}</span>
    </div>
  );
};

/** Dispatched items table; `received` renders the last column. */
export const DispatchItemsTable: React.FC<{
  items: any[];
  received?: (item: any) => React.ReactNode;
}> = ({ items, received }) => {
  const { t } = useT();
  const columns: DataTableColumn<any>[] = [
    {
      header: t("dispatch.col.po"),
      render: (item) => (
        <span className="font-semibold text-ink">{item.productionOrder?.productionOrderId}</span>
      ),
    },
    {
      header: t("common.product"),
      render: (item) => (
        <div className="min-w-0">
          <div className="font-semibold text-ink">{item.product?.productName}</div>
          <div className="font-mono text-xs text-ink-subtle">{item.product?.productCode}</div>
        </div>
      ),
    },
    {
      header: t("dispatch.col.dispatchQty"),
      align: "right",
      render: (item) => (
        <span className="font-semibold tabular-nums text-ink">
          {fmtQty(item.dispatchQty)} {formatUOM(item.uom)}
        </span>
      ),
    },
    {
      header: t("dispatch.col.receivedQty"),
      align: "right",
      render: (item) => (received ? received(item) : <ReceivedCell item={item} />),
    },
  ];
  return (
    <section aria-label={t("dispatch.itemsLabel")}>
      <SectionLabel
        action={
          <Chip size="sm" tone="muted">
            {t("dispatch.itemCount", { count: items.length })}
          </Chip>
        }
      >
        {t("dispatch.itemsLabel")}
      </SectionLabel>
      <DataTable
        data={items}
        columns={columns}
        rowKey={(item: any) => item.id}
        density="compact"
        minHeightClassName=""
        ariaLabel={t("dispatch.itemsLabel")}
        emptyMessage={t("dispatch.noItems")}
      />
    </section>
  );
};

export const VehicleTile: React.FC<{ data: any }> = ({ data }) => {
  const { t } = useT();
  return (
    <Tile title={t("dispatch.vehicleInfo")}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <InfoField label={t("dispatch.vehicleNumber")} value={data.vehicleNumber} />
        <InfoField label={t("dispatch.driverName")} value={data.driverName} />
        <InfoField label={t("dispatch.driverMobile")} value={data.driverMobile} />
        <InfoField label={t("dispatch.transportName")} value={data.transportName} />
        <InfoField label={t("dispatch.loadingTime")} value={data.loadingTime} />
        <div className="col-span-2 md:col-span-3">
          <InfoField label={t("common.remarks")} value={data.remarks} />
        </div>
      </div>
    </Tile>
  );
};

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

/** Created → gate → store timeline. */
export const StatusTimeline: React.FC<{ data: any; className?: string }> = ({
  data,
  className,
}) => {
  const { t } = useT();
  const gateRejected = data.status === "GATE_REJECTED";
  const storeRejected = data.status === "STORE_REJECTED";
  return (
    <Tile title={t("dispatch.history")} className={className ?? "h-fit"}>
      <ol className="m-0 list-none p-0">
        <TimelineStep
          tone="muted"
          title={t("dispatch.created")}
          at={formatDateTime(data.createdAt)}
          last={!data.gateApprovedAt && !data.storeReceivedAt}
        />
        {data.gateApprovedAt && (
          <TimelineStep
            tone={gateRejected ? "danger" : "info"}
            title={gateRejected ? t("status.GATE_REJECTED") : t("dispatch.gateApproved")}
            at={formatDateTime(data.gateApprovedAt)}
            note={data.gateRemarks}
            last={!data.storeReceivedAt}
          />
        )}
        {data.storeReceivedAt && (
          <TimelineStep
            tone={storeRejected ? "danger" : "success"}
            title={storeRejected ? t("status.STORE_REJECTED") : t("dispatch.warehouseReceived")}
            at={formatDateTime(data.storeReceivedAt)}
            note={data.storeRemarks}
            last
          />
        )}
      </ol>
    </Tile>
  );
};

/** Approve / reject decision tile with a remarks box. */
export const DecisionTile: React.FC<{
  title: string;
  note?: React.ReactNode;
  remarks: string;
  onRemarksChange: (value: string) => void;
  placeholder: string;
  approveLabel: string;
  onApprove: () => void;
  onReject: () => void;
  loading?: boolean;
}> = ({
  title,
  note,
  remarks,
  onRemarksChange,
  placeholder,
  approveLabel,
  onApprove,
  onReject,
  loading,
}) => {
  const { t } = useT();
  return (
    <Tile title={title} subtitle={t("dispatch.rejectNeedsRemarks")}>
      <div className="flex flex-col gap-3">
        {note && (
          <p className="m-0 rounded-[14px] bg-nav-active px-3 py-2.5 text-sm text-ink-muted">
            {note}
          </p>
        )}
        <label className="sl-label" htmlFor="dispatch-decision-remarks">
          {t("common.remarks")}
        </label>
        <textarea
          id="dispatch-decision-remarks"
          className="sl-input -mt-2 min-h-[84px] resize-y px-4 py-2.5"
          placeholder={placeholder}
          value={remarks}
          onChange={(e) => onRemarksChange(e.target.value)}
          rows={3}
        />
        <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <ActionPill variant="danger" icon={<X size={16} />} onClick={onReject} disabled={loading}>
            {t("dispatch.reject")}
          </ActionPill>
          <ActionPill icon={<Check size={17} />} onClick={onApprove} disabled={loading}>
            {approveLabel}
          </ActionPill>
        </div>
      </div>
    </Tile>
  );
};
