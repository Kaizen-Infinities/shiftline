import React from "react";

import type { Itc04Registered } from "../../../services/jobWorkService";
import ApprovalPanel from "./ApprovalPanel";
import { Card, day, money, secondary, td, th } from "./gstUi";

/**
 * ITC-04's totals card plus tables 4/5A/5B/5C, shared by the Job Work screen and the GST hub's
 * ITC-04 tab (P2-18) — previously duplicated markup, one per screen.
 */
const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-line-soft bg-card-2 p-3">
    <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
  </div>
);

const Itc04Tables: React.FC<{
  itc: Itc04Registered;
  canManage: boolean;
  busy: boolean;
  onRegister: () => void | Promise<void>;
  onFilingChange: (filing: NonNullable<Itc04Registered["filing"]>) => void;
}> = ({ itc, canManage, busy, onRegister, onFilingChange }) => (
  <>
    <Card
      title={`ITC-04 · ${itc.from} to ${itc.to}`}
      actions={
        canManage && (
          <div className="flex items-center gap-2">
            {itc.json && (
              <span className="text-xs text-ink-muted">
                JSON ready ({(itc.json as { version?: string }).version ?? "GST-ITC04-2.1"})
              </span>
            )}
            <button className={secondary} disabled={busy} onClick={() => void onRegister()}>
              Register / refresh
            </button>
            {itc.json && (
              <button
                className={secondary}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(itc.json, null, 2)], {
                    type: "application/json",
                  });
                  const url = URL.createObjectURL(blob);
                  window.open(url, "_blank");
                }}
              >
                View JSON
              </button>
            )}
          </div>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Challans issued" value={String(itc.totals.challansIssued)} />
        <Stat label="Quantity sent" value={String(itc.totals.quantitySent)} />
        <Stat label="Value sent" value={money(itc.totals.valueSent)} />
        <Stat label="Received back" value={String(itc.totals.challansReceived)} />
      </div>
      {itc.filing && (
        <div className="mt-3">
          <ApprovalPanel row={itc.filing} onChange={onFilingChange} />
        </div>
      )}
    </Card>
    <Card title="Table 4 — sent for job work">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Challan</th>
              <th className={th}>Date</th>
              <th className={th}>Job worker</th>
              <th className={th}>Goods</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {itc.table4.map((r, i) => (
              <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                <td className={td}>{r.challanNo}</td>
                <td className={td}>{day(r.challanDate)}</td>
                <td className={td}>
                  {r.jobWorkerName ?? "—"}
                  {!r.registered && (
                    <span className="ml-1 text-xs text-ink-muted">(unregistered)</span>
                  )}
                </td>
                <td className={td}>
                  {r.description}
                  {r.capitalGoods && (
                    <span className="ml-1 text-xs text-ink-muted">capital goods</span>
                  )}
                </td>
                <td className={`${td} text-right`}>
                  {r.quantity} {r.uom ?? ""}
                </td>
                <td className={`${td} text-right`}>{money(r.taxable)}</td>
              </tr>
            ))}
            {itc.table4.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={6}>
                  Nothing sent for job work in this half-year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
    <Card title="Table 5A — received back">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Challan</th>
              <th className={th}>Date</th>
              <th className={th}>Against</th>
              <th className={th}>Goods</th>
              <th className={`${th} text-right`}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {itc.table5A.map((r, i) => (
              <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                <td className={td}>{r.challanNo}</td>
                <td className={td}>{day(r.challanDate)}</td>
                <td className={td}>{r.originalChallanNo ?? "—"}</td>
                <td className={td}>{r.description}</td>
                <td className={`${td} text-right`}>{r.quantity}</td>
              </tr>
            ))}
            {itc.table5A.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={5}>
                  Nothing came back in this half-year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
    <Card title="Table 5B — moved between job workers">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Challan</th>
              <th className={th}>Date</th>
              <th className={th}>From</th>
              <th className={th}>To</th>
              <th className={th}>Goods</th>
              <th className={`${th} text-right`}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {itc.table5B.map((r, i) => (
              <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                <td className={td}>{r.challanNo}</td>
                <td className={td}>{day(r.challanDate)}</td>
                <td className={td}>{r.fromJobWorkerGstin ?? "—"}</td>
                <td className={td}>{r.toJobWorkerGstin ?? "—"}</td>
                <td className={td}>{r.description}</td>
                <td className={`${td} text-right`}>{r.quantity}</td>
              </tr>
            ))}
            {itc.table5B.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={6}>
                  Nothing moved between job workers in this half-year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
    <Card title="Table 5C — supplied direct from the job worker">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Challan</th>
              <th className={th}>Date</th>
              <th className={th}>Invoice</th>
              <th className={th}>Goods</th>
              <th className={`${th} text-right`}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {itc.table5C.map((r, i) => (
              <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                <td className={td}>{r.challanNo}</td>
                <td className={td}>{day(r.challanDate)}</td>
                <td className={td}>
                  {r.invoiceNo ?? "—"} {r.invoiceDate ? `(${day(r.invoiceDate)})` : ""}
                </td>
                <td className={td}>{r.description}</td>
                <td className={`${td} text-right`}>{r.quantity}</td>
              </tr>
            ))}
            {itc.table5C.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={5}>
                  Nothing supplied directly from a job worker in this half-year.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  </>
);

export default Itc04Tables;
