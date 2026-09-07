import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { useSocketSync } from "../../../hooks/useSocketSync";
import {
  ewayBillService,
  transporterService,
  type EwayBillRow,
  type EwbDocType,
  type TransporterRow,
} from "../../../services/ewayBillService";

/**
 * The e-way bill strip on a document (P1-12): raise one with the transport details, see its
 * number and validity, update the vehicle (Part B), extend near expiry, cancel within 24 hours.
 */
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const field = "rounded-lg border border-line-soft bg-card-2 px-2 py-1.5 text-sm text-ink";
const STATUS: Record<EwayBillRow["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-100 text-slate-700",
  EXPIRED: "bg-rose-100 text-rose-800",
  FAILED: "bg-rose-100 text-rose-800",
};
export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";
const HOUR = 3600 * 1000;

type Mode = "none" | "generate" | "partB" | "extend" | "cancel";

export interface EwayBillPanelProps {
  docType: EwbDocType;
  docRef: string;
  /** Vehicle already on the document (a dispatch), used as the default. */
  vehicleNo?: string | null;
  documentCancelled?: boolean;
}

const EwayBillPanel: React.FC<EwayBillPanelProps> = ({
  docType,
  docRef,
  vehicleNo,
  documentCancelled,
}) => {
  const { can } = usePermission();
  const [rows, setRows] = useState<EwayBillRow[]>([]);
  const [transporters, setTransporters] = useState<TransporterRow[]>([]);
  const [reasons, setReasons] = useState<{
    cancel: Record<string, string>;
    partB: Record<string, string>;
    extend: Record<string, string>;
  } | null>(null);
  const [mode, setMode] = useState<Mode>("none");
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState({
    distanceKm: "",
    transMode: "1",
    vehicleNo: vehicleNo ?? "",
    vehicleType: "R",
    transporter: "",
    transDocNo: "",
  });
  const [pb, setPb] = useState({
    vehicleNo: "",
    fromPlace: "",
    fromState: "",
    reasonCode: "2",
    reasonRem: "",
  });
  const [ext, setExt] = useState({
    fromPlace: "",
    fromState: "",
    fromPincode: "",
    remainingDistance: "",
    extnRsnCode: "99",
    extnRemarks: "",
  });
  const [cx, setCx] = useState({ reason: "3", remarks: "" });

  const load = useCallback(async () => {
    try {
      setRows(await ewayBillService.forDocument(docType, docRef));
    } catch (err) {
      toast.error(message(err));
    }
  }, [docType, docRef]);
  useEffect(() => {
    void load();
  }, [load]);
  useSocketSync("eway-bill", undefined, load);
  useEffect(() => {
    if (mode === "generate" && transporters.length === 0) {
      transporterService
        .list()
        .then(setTransporters)
        .catch(() => undefined);
    }
    if (mode !== "none" && !reasons) {
      ewayBillService
        .reasons()
        .then(setReasons)
        .catch(() => undefined);
    }
  }, [mode, transporters.length, reasons]);

  if (!can("eway-bill.view")) return null;
  const live = rows.find((r) => r.status === "ACTIVE") ?? null;
  const latest = rows[0] ?? null;
  const validMs = live?.validUpto ? new Date(live.validUpto).getTime() - Date.now() : null;
  const withinDay = live?.ewbDate
    ? Date.now() - new Date(live.ewbDate).getTime() < 24 * HOUR
    : false;
  const inExtendWindow = validMs !== null && Math.abs(validMs) <= 8 * HOUR;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setMode("none");
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };
  const generate = () => {
    const t = transporters.find((x) => x.id === gen.transporter);
    return run(
      () =>
        ewayBillService
          .generate({
            docType,
            docRef,
            distanceKm: Number(gen.distanceKm) || 0,
            transMode: gen.transMode,
            vehicleNo: gen.vehicleNo.trim() || null,
            vehicleType: gen.vehicleType,
            transporterId: t?.transporterId ?? null,
            transporterName: t?.name ?? null,
            transDocNo: gen.transDocNo.trim() || null,
          })
          .then((r) => {
            if (r.status !== "ACTIVE")
              throw {
                response: { data: { message: r.error ?? "The portal refused the e-way bill" } },
              };
          }),
      "E-way bill generated"
    );
  };

  return (
    <div
      className="rounded-xl border border-line-soft bg-card p-3 space-y-2 no-print"
      data-testid="eway-bill-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink">E-way bill</span>
        {latest && (
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[latest.status]}`}
          >
            {latest.status}
          </span>
        )}
        {live && validMs !== null && validMs < 12 * HOUR && validMs > 0 && (
          <span className="text-xs text-amber-700">Expires {when(live.validUpto)}</span>
        )}
        <span className="flex-1" />
        {!live && !documentCancelled && can("eway-bill.generate") && mode === "none" && (
          <button type="button" className={primary} onClick={() => setMode("generate")}>
            {latest ? "Generate again" : "Generate e-way bill"}
          </button>
        )}
        {live && can("eway-bill.update") && mode === "none" && (
          <>
            <button type="button" className={secondary} onClick={() => setMode("partB")}>
              Update vehicle
            </button>
            {inExtendWindow && (
              <button type="button" className={secondary} onClick={() => setMode("extend")}>
                Extend validity
              </button>
            )}
          </>
        )}
        {live &&
          can("eway-bill.cancel") &&
          withinDay &&
          !live.consolidatedNo &&
          mode === "none" && (
            <button type="button" className={danger} onClick={() => setMode("cancel")}>
              Cancel
            </button>
          )}
      </div>

      {live && (
        <dl className="grid gap-x-4 gap-y-0.5 text-xs text-ink-muted sm:grid-cols-[auto_1fr]">
          <dt>EWB No.</dt>
          <dd className="font-mono text-ink">{live.ewbNo}</dd>
          <dt>Valid until</dt>
          <dd className="text-ink">
            {live.validUpto ? when(live.validUpto) : "Part B not filled"}
          </dd>
          <dt>Vehicle</dt>
          <dd className="text-ink">
            {live.vehicleNo ?? "—"} · {live.distanceKm} km
            {live.transporterName ? ` · ${live.transporterName}` : ""}
          </dd>
          {live.consolidatedNo && (
            <>
              <dt>Trip sheet</dt>
              <dd className="font-mono text-ink">{live.consolidatedNo}</dd>
            </>
          )}
        </dl>
      )}
      {!live && latest && latest.status === "FAILED" && (
        <p className="text-xs text-rose-700">{latest.error}</p>
      )}
      {!live && latest && latest.status === "CANCELLED" && (
        <p className="text-xs text-ink-muted">
          {latest.ewbNo} cancelled {when(latest.cancelledAt)} · {latest.cancelRemarks}
        </p>
      )}
      {!live && latest && latest.status === "EXPIRED" && (
        <p className="text-xs text-rose-700">
          {latest.ewbNo} expired {when(latest.validUpto)}; raise a new bill for the remaining
          movement.
        </p>
      )}

      {mode === "generate" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className={field}
            placeholder="Distance (km)"
            type="number"
            min={0}
            value={gen.distanceKm}
            onChange={(e) => setGen({ ...gen, distanceKm: e.target.value })}
          />
          <select
            className={field}
            value={gen.transMode}
            onChange={(e) => setGen({ ...gen, transMode: e.target.value })}
          >
            <option value="1">Road</option>
            <option value="2">Rail</option>
            <option value="3">Air</option>
            <option value="4">Ship</option>
          </select>
          <input
            className={field}
            placeholder="Vehicle no. (TN01AB1234)"
            value={gen.vehicleNo}
            onChange={(e) => setGen({ ...gen, vehicleNo: e.target.value.toUpperCase() })}
          />
          <select
            className={field}
            value={gen.vehicleType}
            onChange={(e) => setGen({ ...gen, vehicleType: e.target.value })}
          >
            <option value="R">Regular vehicle</option>
            <option value="O">Over-dimensional cargo</option>
          </select>
          <select
            className={field}
            value={gen.transporter}
            onChange={(e) => setGen({ ...gen, transporter: e.target.value })}
          >
            <option value="">Own vehicle / no transporter</option>
            {transporters.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            className={field}
            placeholder="LR / transport doc no."
            value={gen.transDocNo}
            onChange={(e) => setGen({ ...gen, transDocNo: e.target.value })}
          />
          <div className="flex gap-2 sm:col-span-3">
            <button type="button" className={primary} disabled={busy} onClick={generate}>
              Generate
            </button>
            <button type="button" className={secondary} onClick={() => setMode("none")}>
              Back
            </button>
          </div>
        </div>
      )}
      {mode === "partB" && live && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className={field}
            placeholder="New vehicle no."
            value={pb.vehicleNo}
            onChange={(e) => setPb({ ...pb, vehicleNo: e.target.value.toUpperCase() })}
          />
          <input
            className={field}
            placeholder="From place"
            value={pb.fromPlace}
            onChange={(e) => setPb({ ...pb, fromPlace: e.target.value })}
          />
          <input
            className={field}
            placeholder="From state code (33)"
            value={pb.fromState}
            onChange={(e) => setPb({ ...pb, fromState: e.target.value })}
          />
          <select
            className={field}
            value={pb.reasonCode}
            onChange={(e) => setPb({ ...pb, reasonCode: e.target.value })}
          >
            {Object.entries(reasons?.partB ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            className={`${field} sm:col-span-2`}
            placeholder="Remarks"
            value={pb.reasonRem}
            onChange={(e) => setPb({ ...pb, reasonRem: e.target.value })}
          />
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="button"
              className={primary}
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    ewayBillService.partB(live.id, {
                      vehicleNo: pb.vehicleNo || null,
                      fromPlace: pb.fromPlace,
                      fromState: Number(pb.fromState),
                      reasonCode: pb.reasonCode,
                      reasonRem: pb.reasonRem,
                      transMode: live.transMode,
                    }),
                  "Vehicle updated on the portal"
                )
              }
            >
              Update Part B
            </button>
            <button type="button" className={secondary} onClick={() => setMode("none")}>
              Back
            </button>
          </div>
        </div>
      )}
      {mode === "extend" && live && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className={field}
            placeholder="Current place"
            value={ext.fromPlace}
            onChange={(e) => setExt({ ...ext, fromPlace: e.target.value })}
          />
          <input
            className={field}
            placeholder="State code"
            value={ext.fromState}
            onChange={(e) => setExt({ ...ext, fromState: e.target.value })}
          />
          <input
            className={field}
            placeholder="Pincode"
            value={ext.fromPincode}
            onChange={(e) => setExt({ ...ext, fromPincode: e.target.value })}
          />
          <input
            className={field}
            placeholder="Remaining distance (km)"
            type="number"
            value={ext.remainingDistance}
            onChange={(e) => setExt({ ...ext, remainingDistance: e.target.value })}
          />
          <select
            className={field}
            value={ext.extnRsnCode}
            onChange={(e) => setExt({ ...ext, extnRsnCode: e.target.value })}
          >
            {Object.entries(reasons?.extend ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            className={field}
            placeholder="Remarks"
            value={ext.extnRemarks}
            onChange={(e) => setExt({ ...ext, extnRemarks: e.target.value })}
          />
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="button"
              className={primary}
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    ewayBillService.extend(live.id, {
                      fromPlace: ext.fromPlace,
                      fromState: Number(ext.fromState),
                      fromPincode: Number(ext.fromPincode),
                      remainingDistance: Number(ext.remainingDistance),
                      extnRsnCode: ext.extnRsnCode,
                      extnRemarks: ext.extnRemarks,
                      transMode: live.transMode,
                    }),
                  "Validity extended"
                )
              }
            >
              Extend
            </button>
            <button type="button" className={secondary} onClick={() => setMode("none")}>
              Back
            </button>
          </div>
        </div>
      )}
      {mode === "cancel" && live && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={field}
            value={cx.reason}
            onChange={(e) => setCx({ ...cx, reason: e.target.value })}
          >
            {Object.entries(reasons?.cancel ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            className={`${field} min-w-[220px] flex-1`}
            placeholder="Remarks (kept on the portal)"
            value={cx.remarks}
            maxLength={100}
            onChange={(e) => setCx({ ...cx, remarks: e.target.value })}
          />
          <button
            type="button"
            className={danger}
            disabled={busy || cx.remarks.trim().length < 3}
            onClick={() =>
              run(
                () => ewayBillService.cancel(live.id, cx.reason, cx.remarks),
                "E-way bill cancelled"
              )
            }
          >
            Confirm cancellation
          </button>
          <button type="button" className={secondary} onClick={() => setMode("none")}>
            Back
          </button>
        </div>
      )}
    </div>
  );
};

export default EwayBillPanel;
