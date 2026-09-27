import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
  AGEING_BUCKET_LABELS,
  ageingService,
  type AgeingReport,
  type AgeingRow,
} from "../../../services/ageingService";
import { formatDate } from "../../../utils/dateUtils";

/**
 * Ageing view (P1-10) shared by the receivable and payable screens: one row per party with the
 * unpaid balance split by days past due; a row opens to the documents behind it.
 */
interface Props {
  kind: "receivable" | "payable";
  asOnDate: string;
  partyId?: string;
  search?: string;
  onOpenParty?: (partyId: string) => void;
}

const inr = (n: number) =>
  n === 0
    ? ""
    : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(
        n
      );
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const th = "px-2 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle";
const td = "px-2 py-1 text-[12.5px] text-ink";
const num = `${td} text-right tabular-nums`;

const AgeingTable: React.FC<Props> = ({ kind, asOnDate, partyId, search, onOpenParty }) => {
  const [report, setReport] = useState<AgeingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, AgeingRow>>({});

  const fetcher = kind === "receivable" ? ageingService.receivable : ageingService.payable;
  const showInterest = kind === "receivable";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetcher({ asOnDate, partyId, search }));
      setOpen(null);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [fetcher, asOnDate, partyId, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (row: AgeingRow) => {
    if (open === row.partyId) {
      setOpen(null);
      return;
    }
    setOpen(row.partyId);
    if (row.documents) return;
    if (details[row.partyId]) return;
    try {
      const one = await fetcher({ asOnDate, partyId: row.partyId });
      const detail = one.rows[0];
      if (detail) setDetails((d) => ({ ...d, [row.partyId]: detail }));
    } catch (err) {
      toast.error(message(err));
    }
  };

  const buckets = report?.buckets ?? ["notDue", "d0_30", "d31_60", "d61_90", "d90_plus"];
  const colSpan = 4 + buckets.length + (showInterest ? 1 : 0);

  return (
    <div
      className="sl-tile overflow-hidden flex flex-col"
      style={{ height: "calc(100vh - 240px)" }}
    >
      <div className="px-3 py-1.5 border-b border-line bg-card-2 flex items-center justify-between gap-2 shrink-0">
        <h2 className="text-xs font-semibold text-ink">
          {kind === "receivable" ? "Receivables" : "Payables"} ageing as on{" "}
          {formatDate(report?.asOnDate ?? asOnDate)}
        </h2>
        <span className="text-[11.5px] text-ink-muted">
          Days past due date (document date plus the party&apos;s credit days). Click a row for the
          documents.
        </span>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-card-2">
            <tr>
              <th className={th}>Party</th>
              <th className={`${th} text-right`}>Credit days</th>
              {buckets.map((b) => (
                <th key={b} className={`${th} text-right`}>
                  {AGEING_BUCKET_LABELS[b]}
                </th>
              ))}
              <th className={`${th} text-right`}>Total</th>
              <th className={`${th} text-right`}>Overdue</th>
              {showInterest && <th className={`${th} text-right`}>Interest</th>}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={colSpan} className={`${td} py-6 text-center text-ink-muted`}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && report && report.rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className={`${td} py-6 text-center text-ink-muted`}>
                  Nothing outstanding.
                </td>
              </tr>
            )}
            {!loading &&
              report?.rows.map((row) => {
                const detail = row.documents ? row : details[row.partyId];
                return (
                  <React.Fragment key={row.partyId}>
                    <tr
                      className="border-t border-line hover:bg-card-2 cursor-pointer"
                      onClick={() => void toggle(row)}
                    >
                      <td className={td}>
                        <span className="text-ink-muted mr-1">
                          {open === row.partyId ? "▾" : "▸"}
                        </span>
                        <span className="tabular-nums text-[11.5px] text-ink-muted mr-1">
                          {row.code}
                        </span>
                        {onOpenParty ? (
                          <button
                            type="button"
                            className="text-accent hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenParty(row.partyId);
                            }}
                          >
                            {row.name}
                          </button>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td className={num}>{row.creditDays ?? "—"}</td>
                      {buckets.map((b) => (
                        <td
                          key={b}
                          className={`${num} ${b === "d90_plus" && row.buckets[b] > 0 ? "text-[color:var(--color-danger)] font-semibold" : ""}`}
                        >
                          {inr(row.buckets[b])}
                        </td>
                      ))}
                      <td className={`${num} font-semibold`}>{inr(row.total)}</td>
                      <td
                        className={`${num} ${row.overdue > 0 ? "text-[color:var(--color-warning)]" : ""}`}
                      >
                        {inr(row.overdue)}
                      </td>
                      {showInterest && (
                        <td
                          className={num}
                          title={row.interestRate ? `${row.interestRate}% p.a.` : ""}
                        >
                          {inr(row.interest)}
                        </td>
                      )}
                    </tr>
                    {open === row.partyId && (
                      <tr className="border-t border-line bg-card-2/60">
                        <td colSpan={colSpan} className="px-4 py-2">
                          {!detail ? (
                            <span className="text-[12.5px] text-ink-muted">Loading documents…</span>
                          ) : (
                            <table className="min-w-[60%] text-[12.5px]">
                              <thead className="text-left text-[11.5px] uppercase tracking-wide text-ink-subtle">
                                <tr>
                                  <th className="py-0.5 pr-3">Document</th>
                                  <th className="py-0.5 pr-3">Date</th>
                                  <th className="py-0.5 pr-3">Due</th>
                                  <th className="py-0.5 pr-3 text-right">Amount</th>
                                  <th className="py-0.5 pr-3 text-right">Paid</th>
                                  <th className="py-0.5 pr-3 text-right">Balance</th>
                                  <th className="py-0.5 pr-3 text-right">Days overdue</th>
                                  <th className="py-0.5 pr-3">Bucket</th>
                                  {showInterest && <th className="py-0.5 text-right">Interest</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {(detail.documents ?? []).map((d) => (
                                  <tr key={d.id} className="border-t border-line">
                                    <td className="py-0.5 pr-3 tabular-nums text-ink">
                                      {d.number}
                                    </td>
                                    <td className="py-0.5 pr-3 text-ink">{formatDate(d.date)}</td>
                                    <td className="py-0.5 pr-3 text-ink">
                                      {formatDate(d.dueDate)}
                                    </td>
                                    <td className="py-0.5 pr-3 text-right text-ink">
                                      {inr(d.amount)}
                                    </td>
                                    <td className="py-0.5 pr-3 text-right text-ink">
                                      {inr(d.paid)}
                                    </td>
                                    <td className="py-0.5 pr-3 text-right font-semibold text-ink">
                                      {inr(d.balance)}
                                    </td>
                                    <td className="py-0.5 pr-3 text-right text-ink">
                                      {d.daysOverdue < 0 ? `in ${-d.daysOverdue}` : d.daysOverdue}
                                    </td>
                                    <td className="py-0.5 pr-3 text-ink-muted">
                                      {AGEING_BUCKET_LABELS[d.bucket]}
                                    </td>
                                    {showInterest && (
                                      <td className="py-0.5 text-right text-ink">
                                        {inr(d.interest)}
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
          {report && report.rows.length > 0 && (
            <tfoot className="sticky bottom-0 bg-card-2 border-t border-line font-semibold">
              <tr>
                <td className={td} colSpan={2}>
                  Total ({report.rows.length})
                </td>
                {buckets.map((b) => (
                  <td key={b} className={num}>
                    {inr(report.totals[b])}
                  </td>
                ))}
                <td className={num}>{inr(report.totals.total)}</td>
                <td className={num}>{inr(report.totals.overdue)}</td>
                {showInterest && <td className={num}>{inr(report.totals.interest)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default AgeingTable;
