import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Clock3, Route, Truck } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  ewayBillService,
  type EwayBillRow,
  type EwbStatus,
  type TripSheetRow,
} from "../../../services/ewayBillService";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  PageHeader,
  Tile,
  Toolbar,
  actionPillClass,
  type ChipTone,
} from "../../../components/ui/v2";

/** E-way bill register (P1-12): every bill with validity, the ones about to lapse, and trip sheets. */
const STATUS_TONE: Record<EwbStatus, ChipTone> = {
  PENDING: "warning",
  ACTIVE: "success",
  CANCELLED: "muted",
  EXPIRED: "danger",
  FAILED: "danger",
};
const STATUS_LABEL: Record<EwbStatus, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  FAILED: "Failed",
};
const HOUR = 3600 * 1000;
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const linkFor = (r: EwayBillRow) =>
  r.docType === "INV" ? `/sales-invoices/${r.docRef}` : `/production/goods-dispatch/${r.docRef}`;
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

type Filter = EwbStatus | "" | "EXPIRING";

const EwayBillsPage: React.FC = () => {
  const { can } = usePermission();
  const [params] = useSearchParams();
  const [rows, setRows] = useState<EwayBillRow[]>([]);
  const [sheets, setSheets] = useState<TripSheetRow[]>([]);
  const [status, setStatus] = useState<EwbStatus | "">(params.get("expiring") ? "ACTIVE" : "");
  const [expiring, setExpiring] = useState(Boolean(params.get("expiring")));
  const [selected, setSelected] = useState<string[]>([]);
  const [trip, setTrip] = useState({ fromPlace: "", fromState: "", vehicleNo: "" });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bills, trips] = await Promise.all([
        ewayBillService.list({
          ...(status && { status }),
          ...(expiring && { expiringWithinHours: 12 }),
        }),
        ewayBillService.tripSheets(),
      ]);
      setRows(bills);
      setSheets(trips);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [status, expiring]);
  useEffect(() => {
    void load();
  }, [load]);

  const consolidate = async () => {
    setBusy(true);
    try {
      const s = await ewayBillService.consolidate({
        fromPlace: trip.fromPlace,
        fromState: Number(trip.fromState),
        vehicleNo: trip.vehicleNo.toUpperCase(),
        transMode: "1",
        ewbIds: selected,
      });
      toast.success(`Trip sheet ${s.cewbNo} generated`);
      setSelected([]);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const lapsing = rows.filter(
    (r) =>
      r.status === "ACTIVE" &&
      r.validUpto &&
      new Date(r.validUpto).getTime() - Date.now() < 12 * HOUR
  ).length;

  const filter: Filter = expiring ? "EXPIRING" : status;
  const onFilter = (f: Filter) => {
    if (f === "EXPIRING") {
      setStatus("ACTIVE");
      setExpiring(true);
    } else {
      setExpiring(false);
      setStatus(f);
    }
  };

  const validity = (r: EwayBillRow) => {
    if (!r.validUpto) return <span className="text-ink-subtle">—</span>;
    const left = new Date(r.validUpto).getTime() - Date.now();
    const soon = r.status === "ACTIVE" && left > 0 && left < 24 * HOUR;
    return (
      <div className="text-xs">
        <div className="tabular-nums text-ink">{when(r.validUpto)}</div>
        {soon && (
          <Chip tone="warning" size="sm" icon={<Clock3 size={12} />} className="mt-1">
            {Math.max(1, Math.round(left / HOUR))} h left
          </Chip>
        )}
      </div>
    );
  };

  const columns: DataTableColumn<EwayBillRow>[] = [
    {
      header: "",
      headerNode: <span className="sr-only">Select</span>,
      width: "48px",
      render: (r) =>
        r.status === "ACTIVE" && !r.consolidatedNo ? (
          <input
            type="checkbox"
            className="sl-check"
            aria-label={`Select ${r.ewbNo ?? r.docNo}`}
            checked={selected.includes(r.id)}
            onChange={(e) =>
              setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))
            }
          />
        ) : null,
    },
    {
      header: "Document",
      render: (r) => (
        <Link className="font-semibold text-accent hover:underline" to={linkFor(r)}>
          {r.docType === "INV" ? "Invoice" : "Challan"} {r.docNo}
        </Link>
      ),
    },
    {
      header: "EWB No.",
      render: (r) => <span className="font-mono text-xs">{r.ewbNo ?? "—"}</span>,
    },
    {
      header: "Status",
      render: (r) => (
        <div className="py-1">
          <Chip tone={STATUS_TONE[r.status]} size="sm" dot>
            {STATUS_LABEL[r.status]}
          </Chip>
          {r.error && r.status === "FAILED" && (
            <div
              className="mt-1 max-w-xs truncate text-xs text-[color:var(--color-danger)]"
              title={r.error}
            >
              {r.error}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Vehicle",
      render: (r) => (
        <div>
          <div className="font-medium">{r.vehicleNo ?? "—"}</div>
          <div className="text-xs text-ink-muted">{r.distanceKm} km</div>
        </div>
      ),
    },
    { header: "Valid until", render: validity },
    {
      header: "Trip sheet",
      render: (r) => <span className="font-mono text-xs">{r.consolidatedNo ?? ""}</span>,
    },
  ];

  const sheetColumns: DataTableColumn<TripSheetRow>[] = [
    {
      header: "Trip sheet",
      render: (s) => <span className="font-mono text-xs font-semibold">{s.cewbNo}</span>,
    },
    { header: "Vehicle", render: (s) => s.vehicleNo },
    { header: "From", render: (s) => s.fromPlace },
    {
      header: "Bills",
      render: (s) => <span className="font-mono text-xs">{s.ewbNos.join(", ")}</span>,
    },
    {
      header: "Generated",
      render: (s) => <span className="text-xs text-ink-muted">{when(s.cewbDate)}</span>,
    },
  ];

  return (
    <div className="sl-page">
      <PageHeader
        title="E-way Bills"
        icon={<Truck size={22} />}
        subtitle="Every e-way bill raised for invoices and dispatch challans, with validity. Tick live bills on one vehicle to make a trip sheet."
        meta={
          lapsing > 0 ? (
            <Chip tone="warning" dot>
              {lapsing} expiring within 12 h
            </Chip>
          ) : undefined
        }
        actions={
          can("transporters.view") ? (
            <Link to="/settings/transporters" className={actionPillClass({ variant: "secondary" })}>
              Transporters
            </Link>
          ) : undefined
        }
        primaryAction={
          <Link to="/sales-invoices" className={actionPillClass({ size: "lg" })}>
            Generate E-way Bill
          </Link>
        }
      />

      <Toolbar<Filter>
        filters={[
          { key: "", label: "All" },
          { key: "EXPIRING", label: "Expiring < 12h", count: lapsing > 0 ? lapsing : undefined },
          ...(Object.keys(STATUS_LABEL) as EwbStatus[]).map((s) => ({
            key: s as Filter,
            label: STATUS_LABEL[s],
          })),
        ]}
        filterValue={filter}
        onFilterChange={onFilter}
        filtersLabel="Status"
      />

      {selected.length > 0 && can("eway-bill.generate") && (
        <Tile
          title={`Trip sheet for ${selected.length} bill(s)`}
          icon={<Route size={18} />}
          subtitle="One vehicle, one consolidated e-way bill."
          actions={
            <ActionPill variant="secondary" size="sm" onClick={() => setSelected([])}>
              Clear selection
            </ActionPill>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_140px_1fr_auto] lg:items-end">
            <label className="block">
              <span className="sl-label">From place</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="From place"
                value={trip.fromPlace}
                onChange={(e) => setTrip({ ...trip, fromPlace: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="sl-label">State code</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="State code"
                inputMode="numeric"
                value={trip.fromState}
                onChange={(e) => setTrip({ ...trip, fromState: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="sl-label">Vehicle no.</span>
              <input
                className="sl-input h-11 py-0 text-sm uppercase"
                placeholder="Vehicle no."
                value={trip.vehicleNo}
                onChange={(e) => setTrip({ ...trip, vehicleNo: e.target.value.toUpperCase() })}
              />
            </label>
            <ActionPill
              variant="blue"
              loading={busy}
              disabled={busy || !trip.fromPlace || !trip.fromState || !trip.vehicleNo}
              onClick={consolidate}
            >
              Generate trip sheet
            </ActionPill>
          </div>
        </Tile>
      )}

      <DataTable
        ariaLabel="E-way bills"
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage={
          filter
            ? "No e-way bills match this filter."
            : "No e-way bills yet. Raise one from an invoice or a goods dispatch."
        }
        emptyAction={
          filter ? (
            <ActionPill variant="secondary" size="sm" onClick={() => onFilter("")}>
              Clear filters
            </ActionPill>
          ) : undefined
        }
      />

      {sheets.length > 0 && (
        <Tile title="Trip sheets" icon={<Route size={18} />} padding="none" divider>
          <DataTable
            ariaLabel="Trip sheets"
            density="compact"
            columns={sheetColumns}
            data={sheets}
            rowKey={(s) => s.id}
          />
        </Tile>
      )}
    </div>
  );
};

export default EwayBillsPage;
