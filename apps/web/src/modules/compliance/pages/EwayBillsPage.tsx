import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  ewayBillService,
  type EwayBillRow,
  type EwbStatus,
  type TripSheetRow,
} from "../../../services/ewayBillService";

/** E-way bill register (P1-12): every bill with validity, the ones about to lapse, and trip sheets. */
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-1.5 text-sm text-ink";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const field = "rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm text-ink";
const STATUS: Record<EwbStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-100 text-slate-700",
  EXPIRED: "bg-rose-100 text-rose-800",
  FAILED: "bg-rose-100 text-rose-800",
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const linkFor = (r: EwayBillRow) =>
  r.docType === "INV" ? `/sales-invoices/${r.docRef}` : `/production/goods-dispatch/${r.docRef}`;
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

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
      new Date(r.validUpto).getTime() - Date.now() < 12 * 3600 * 1000
  ).length;
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">E-way Bills</h2>
          <p className="text-sm text-ink-muted">
            Every e-way bill raised for invoices and dispatch challans, with validity. Tick live
            bills on one vehicle to make a trip sheet.
          </p>
        </div>
        {lapsing > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {lapsing} expiring within 12 h
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={field}
          value={status}
          onChange={(e) => setStatus(e.target.value as EwbStatus | "")}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {(Object.keys(STATUS) as EwbStatus[]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-ink">
          <input
            type="checkbox"
            checked={expiring}
            onChange={(e) => setExpiring(e.target.checked)}
          />{" "}
          Expiring within 12 hours
        </label>
      </div>
      {selected.length > 0 && can("eway-bill.generate") && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-soft bg-card p-3">
          <span className="text-sm text-ink">Trip sheet for {selected.length} bill(s):</span>
          <input
            className={field}
            placeholder="From place"
            value={trip.fromPlace}
            onChange={(e) => setTrip({ ...trip, fromPlace: e.target.value })}
          />
          <input
            className={field}
            placeholder="State code"
            value={trip.fromState}
            onChange={(e) => setTrip({ ...trip, fromState: e.target.value })}
          />
          <input
            className={field}
            placeholder="Vehicle no."
            value={trip.vehicleNo}
            onChange={(e) => setTrip({ ...trip, vehicleNo: e.target.value.toUpperCase() })}
          />
          <button
            type="button"
            className={primary}
            disabled={busy || !trip.fromPlace || !trip.fromState || !trip.vehicleNo}
            onClick={consolidate}
          >
            Generate trip sheet
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th} />
              <th className={th}>Document</th>
              <th className={th}>EWB No.</th>
              <th className={th}>Status</th>
              <th className={th}>Vehicle</th>
              <th className={th}>Valid until</th>
              <th className={th}>Trip sheet</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  {r.status === "ACTIVE" && !r.consolidatedNo && (
                    <input
                      type="checkbox"
                      checked={selected.includes(r.id)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)
                        )
                      }
                    />
                  )}
                </td>
                <td className={td}>
                  <Link className="font-medium text-blue-600 hover:underline" to={linkFor(r)}>
                    {r.docType === "INV" ? "Invoice" : "Challan"} {r.docNo}
                  </Link>
                </td>
                <td className={`${td} font-mono text-xs`}>{r.ewbNo ?? "—"}</td>
                <td className={td}>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[r.status]}`}
                  >
                    {r.status}
                  </span>
                  {r.error && r.status === "FAILED" && (
                    <div className="max-w-xs truncate text-xs text-rose-700" title={r.error}>
                      {r.error}
                    </div>
                  )}
                </td>
                <td className={td}>
                  {r.vehicleNo ?? "—"}{" "}
                  <span className="text-xs text-ink-muted">{r.distanceKm} km</span>
                </td>
                <td className={`${td} text-xs`}>{when(r.validUpto)}</td>
                <td className={`${td} font-mono text-xs`}>{r.consolidatedNo ?? ""}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={7}>
                  No e-way bills yet. Raise one from an invoice or a goods dispatch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sheets.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
          <table className="min-w-full divide-y divide-line-soft">
            <thead>
              <tr>
                <th className={th}>Trip sheet</th>
                <th className={th}>Vehicle</th>
                <th className={th}>From</th>
                <th className={th}>Bills</th>
                <th className={th}>Generated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {sheets.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-mono text-xs`}>{s.cewbNo}</td>
                  <td className={td}>{s.vehicleNo}</td>
                  <td className={td}>{s.fromPlace}</td>
                  <td className={`${td} font-mono text-xs`}>{s.ewbNos.join(", ")}</td>
                  <td className={`${td} text-xs`}>{when(s.cewbDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default EwayBillsPage;
