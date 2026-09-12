import React, { useRef, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  gstReturnsService,
  type Gstr2bSummary,
  type MatchStatus,
} from "../../../services/gstReturnsService";
import { Card, day, danger, message, money, primary, secondary, td, th } from "./gstUi";

/**
 * The GSTR-2B reconciliation workbench (P1-13c, P1-13d).
 *
 * The screen is organised around the disagreements, because the agreements need no attention:
 * a matched record is one line, a mismatch shows which field differs and by how much, and the
 * two one-sided buckets — the supplier did not file it, or the company did not record it — are
 * the two conversations the month actually needs.
 */
const STATUS_STYLE: Record<MatchStatus, string> = {
  MATCHED: "bg-emerald-100 text-emerald-800",
  MISMATCH: "bg-amber-100 text-amber-800",
  MISSING_IN_2B: "bg-rose-100 text-rose-800",
  MISSING_IN_BOOKS: "bg-sky-100 text-sky-800",
};
const STATUS_LABEL: Record<MatchStatus, string> = {
  MATCHED: "Agrees",
  MISMATCH: "Differs",
  MISSING_IN_2B: "Not filed by the supplier",
  MISSING_IN_BOOKS: "Not in our books",
};

interface Props {
  summary: Gstr2bSummary;
  period: string;
  gstin: string;
  onChange: () => void | Promise<void>;
}

const Gstr2bWorkbench: React.FC<Props> = ({ summary, period, gstin, onChange }) => {
  const { can } = usePermission();
  const [filter, setFilter] = useState<MatchStatus | "">("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const s = summary.summary;

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

  const onFile = async (file: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      toast.error("That file is not JSON");
      return;
    }
    await act(() => gstReturnsService.gstr2bImport(period, gstin, json), "2B imported");
  };

  const rows = filter ? summary.records.filter((r) => r.matchStatus === filter) : summary.records;
  const credit = (c: { igst: number; cgst: number; sgst: number; cess: number }) =>
    c.igst + c.cgst + c.sgst + c.cess;
  const gap = credit(s.bookCredit) - credit(s.portalCredit);

  return (
    <div className="space-y-4">
      <Card
        title="Reconciliation"
        actions={
          can("gst-returns.prepare") && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
              <button
                className={secondary}
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                Import the portal's file
              </button>
              <button
                className={primary}
                onClick={() => act(() => gstReturnsService.gstr2bPull(period, gstin), "2B pulled")}
                disabled={busy}
              >
                Pull from the portal
              </button>
            </div>
          )
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["MATCHED", s.matched],
              ["MISMATCH", s.mismatch],
              ["MISSING_IN_2B", s.missingIn2b],
              ["MISSING_IN_BOOKS", s.missingInBooks],
            ] as [MatchStatus, number][]
          ).map(([key, count]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "" : key)}
              aria-pressed={filter === key}
              className={`rounded-lg border p-3 text-left transition ${
                filter === key ? "border-blue-500 bg-blue-50" : "border-line-soft bg-card-2"
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-ink-muted">{STATUS_LABEL[key]}</p>
              <p className="mt-1 text-lg font-semibold text-ink">{count}</p>
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-line-soft bg-card-2 p-3 text-sm">
          <p className="text-ink">
            Credit the suppliers filed: <strong>{money(credit(s.portalCredit))}</strong> · credit
            the books claim: <strong>{money(credit(s.bookCredit))}</strong>
          </p>
          <p className="mt-1 text-ink-muted">
            {gap === 0
              ? "The two agree."
              : gap > 0
                ? `The books claim ${money(gap)} more than the suppliers filed. That is the amount at risk.`
                : `The suppliers filed ${money(-gap)} more than the books claim.`}
          </p>
        </div>
      </Card>

      <Card title={filter ? STATUS_LABEL[filter] : "Every record"}>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Supplier</th>
                <th className={th}>Document</th>
                <th className={th}>Date</th>
                <th className={`${th} text-right`}>Taxable</th>
                <th className={`${th} text-right`}>Tax</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                    <td className={`${td} text-right`}>{money(r.taxable)}</td>
                    <td className={`${td} text-right`}>
                      {money(Number(r.igst) + Number(r.cgst) + Number(r.sgst) + Number(r.cess))}
                    </td>
                    <td className={td}>
                      {r.matchStatus && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.matchStatus]}`}
                        >
                          {STATUS_LABEL[r.matchStatus]}
                        </span>
                      )}
                      {!r.itcAvailable && (
                        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          No credit: {r.itcReason ?? "the portal says so"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {r.mismatchFields?.length ? (
                    <tr className="bg-amber-50/50">
                      <td className={`${td} text-xs text-amber-900`} colSpan={6}>
                        {r.mismatchFields.map((f) => (
                          <span key={f.field} className="mr-4">
                            <strong>{f.field}</strong>: books {String(f.inBooks)}, portal{" "}
                            {String(f.inPortal)}
                            {f.difference !== undefined
                              ? ` (${f.difference > 0 ? "+" : ""}${f.difference})`
                              : ""}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={6}>
                    Nothing here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {summary.missingIn2b.length > 0 && (
        <Card title="In our books, not filed by the supplier">
          <p className="mb-2 text-sm text-ink-muted">
            Credit cannot be taken on these until the supplier files them. They are the month's
            follow-up list.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Date</th>
                  <th className={`${th} text-right`}>Taxable</th>
                </tr>
              </thead>
              <tbody>
                {summary.missingIn2b.map((b) => (
                  <tr key={`${b.docType}-${b.docId}`} className="border-t border-line-soft">
                    <td className={td}>
                      {b.docNo} <span className="text-xs text-ink-muted">{b.docType}</span>
                    </td>
                    <td className={td}>{day(b.docDate)}</td>
                    <td className={`${td} text-right`}>{money(b.taxable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {busy && <p className={`${danger} inline-block`}>Working…</p>}
    </div>
  );
};

export default Gstr2bWorkbench;
