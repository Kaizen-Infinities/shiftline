import React, { useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  gstReturnsService,
  type Gstr2bRecordRow,
  type ImsStatus,
} from "../../../services/gstReturnsService";
import { Card, danger, day, message, money, primary, secondary, success, td, th } from "./gstUi";

/**
 * The IMS workbench (P1-13c, P1-13d).
 *
 * The screen leads with what is still undecided, because the portal accepts an undecided record
 * by default when it draws the 2B: the number at the top is credit the company will be treated
 * as having claimed if nobody acts before the 14th. Accepting in bulk is one click; rejecting is
 * deliberately not, because a rejection needs a reason the supplier will be asked about.
 */
const STATUS_STYLE: Record<ImsStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

interface Props {
  rows: Gstr2bRecordRow[];
  period: string;
  gstin: string;
  onDecide: (id: string, status: ImsStatus, reason?: string) => Promise<void>;
  onChange: () => void | Promise<void>;
}

const ImsWorkbench: React.FC<Props> = ({ rows, period, gstin, onDecide, onChange }) => {
  const { can } = usePermission();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState<ImsStatus | "">("");

  const pending = useMemo(
    () => rows.filter((r) => (r.imsStatus ?? "PENDING") === "PENDING"),
    [rows]
  );
  const pendingCredit = pending.reduce(
    (s, r) => s + Number(r.igst) + Number(r.cgst) + Number(r.sgst) + Number(r.cess),
    0
  );
  const shown = filter ? rows.filter((r) => (r.imsStatus ?? "PENDING") === filter) : rows;
  const pushed = rows.some((r) => r.imsAction?.pushedAt);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await onChange();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const reject = async (id: string) => {
    if (!reason.trim()) {
      toast.error("A rejection needs a reason");
      return;
    }
    await act(() => onDecide(id, "REJECTED", reason.trim()), "Rejected");
    setRejecting(null);
    setReason("");
  };

  return (
    <div className="space-y-4">
      <Card
        title="Decisions"
        actions={
          can("gst-returns.prepare") && (
            <div className="flex flex-wrap gap-2">
              <button
                className={secondary}
                disabled={busy || pending.length === 0}
                onClick={() =>
                  act(
                    () => gstReturnsService.imsRule(period, gstin, "ACCEPT_MATCHED"),
                    "Accepted every record that agrees with the books"
                  )
                }
              >
                Accept the ones that agree
              </button>
              <button
                className={secondary}
                disabled={busy}
                onClick={() =>
                  act(() => gstReturnsService.imsRegister(period, gstin), "Registered for approval")
                }
              >
                Register for approval
              </button>
              {can("gst-returns.file") && (
                <button
                  className={primary}
                  disabled={busy}
                  onClick={() =>
                    act(() => gstReturnsService.imsPush(period, gstin), "Sent to the portal")
                  }
                >
                  Send to the portal
                </button>
              )}
            </div>
          )
        }
      >
        <div
          className={`rounded-lg border p-3 ${
            pending.length ? "border-amber-300 bg-amber-50" : "border-line-soft bg-card-2"
          }`}
        >
          {pending.length ? (
            <>
              <p className="text-sm font-semibold text-amber-900">
                {pending.length} record{pending.length === 1 ? "" : "s"} still undecided
              </p>
              <p className="mt-1 text-sm text-amber-800">
                The portal accepts an undecided record by default, taking{" "}
                <strong>{money(pendingCredit)}</strong> of credit with it. Decide before the 14th.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink">
              Every record has a decision{pushed ? " and has gone to the portal" : ""}.
            </p>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["PENDING", "ACCEPTED", "REJECTED"] as ImsStatus[]).map((s) => (
            <button
              key={s}
              aria-pressed={filter === s}
              onClick={() => setFilter(filter === s ? "" : s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filter === s ? "ring-2 ring-blue-500" : ""
              } ${STATUS_STYLE[s]}`}
            >
              {s.toLowerCase()} · {rows.filter((r) => (r.imsStatus ?? "PENDING") === s).length}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Inward records">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Supplier</th>
                <th className={th}>Document</th>
                <th className={th}>Date</th>
                <th className={`${th} text-right`}>Credit</th>
                <th className={th}>Decision</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const status = r.imsStatus ?? "PENDING";
                const sent = Boolean(r.imsAction?.pushedAt);
                return (
                  <React.Fragment key={r.id}>
                    <tr className="border-t border-line-soft">
                      <td className={td}>
                        <div className="font-medium">{r.supplierName ?? r.supplierGstin}</div>
                        <div className="text-xs text-ink-muted">{r.supplierGstin}</div>
                      </td>
                      <td className={td}>
                        {r.docNo}
                        <span className="ml-1 text-xs text-ink-muted">{r.docType}</span>
                      </td>
                      <td className={td}>{day(r.docDate)}</td>
                      <td className={`${td} text-right`}>
                        {money(Number(r.igst) + Number(r.cgst) + Number(r.sgst) + Number(r.cess))}
                      </td>
                      <td className={td}>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[status]}`}
                        >
                          {status.toLowerCase()}
                        </span>
                        {sent && <span className="ml-1 text-xs text-ink-muted">sent</span>}
                        {r.imsAction?.reason && (
                          <div className="mt-0.5 text-xs text-ink-muted">{r.imsAction.reason}</div>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {can("gst-returns.prepare") && !sent && (
                          <div className="flex justify-end gap-1">
                            <button
                              className={success}
                              disabled={busy}
                              onClick={() => act(() => onDecide(r.id, "ACCEPTED"), "Accepted")}
                            >
                              Accept
                            </button>
                            <button
                              className={danger}
                              disabled={busy}
                              onClick={() => {
                                setRejecting(rejecting === r.id ? null : r.id);
                                setReason("");
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {rejecting === r.id && (
                      <tr className="bg-rose-50/50">
                        <td className={td} colSpan={6}>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="text-sm text-ink" htmlFor={`reason-${r.id}`}>
                              Why is this being rejected?
                            </label>
                            <input
                              id={`reason-${r.id}`}
                              className="flex-1 rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Not our purchase, wrong GSTIN, value differs…"
                            />
                            <button className={danger} disabled={busy} onClick={() => reject(r.id)}>
                              Confirm
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={6}>
                    No records for this period. Import or pull the 2B first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default ImsWorkbench;
