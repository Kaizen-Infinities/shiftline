import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../../hooks/usePermission";
import {
  previousFyCode,
  yearEndService,
  type PeriodControl,
  type YearEndClosing,
  type YearEndPreview,
} from "../../../../services/yearEndService";
import { formatDate, formatDateTime } from "../../../../utils/dateUtils";

/**
 * Year-end closing (P1-09e). Preview the closing journal for a financial year, prepare it, have
 * an approver post it (which also closes the year's periods, opens the next year and freezes
 * the books), or reverse a closing after moving the freeze date back.
 */
const input =
  "rounded-lg border border-line-soft bg-card px-3 py-2 text-sm text-ink outline-none focus:border-blue-500";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;

const STATUS_STYLE: Record<string, string> = {
  PREPARED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REVERSED: "bg-rose-100 text-rose-800",
  DISCARDED: "bg-slate-100 text-slate-700",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const YearEndPage: React.FC = () => {
  const { can } = usePermission();
  const [fyCode, setFyCode] = useState(previousFyCode());
  const [applied, setApplied] = useState(previousFyCode());
  const [preview, setPreview] = useState<YearEndPreview | null>(null);
  const [closings, setClosings] = useState<YearEndClosing[]>([]);
  const [control, setControl] = useState<PeriodControl | null>(null);
  const [freeze, setFreeze] = useState("");
  const [allowBack, setAllowBack] = useState(false);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, list, pc] = await Promise.all([
        yearEndService.preview(applied),
        yearEndService.list(),
        yearEndService.periodControl(),
      ]);
      setPreview(p);
      setClosings(list);
      setControl(pc);
      setFreeze(pc.booksFrozenUpTo ?? "");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const prepare = () =>
    run(`${applied} prepared for approval`, () => yearEndService.prepare(applied, notes));
  const approve = (c: YearEndClosing) => {
    if (
      !window.confirm(
        `Close ${c.fyCode}? The closing journal is posted on ${formatDate(c.fyEnd)}, the year's periods close and the books freeze up to that date.`
      )
    )
      return;
    return run(`${c.fyCode} closed`, () => yearEndService.approve(c.id));
  };
  const discard = (c: YearEndClosing) =>
    run("Preparation discarded", () => yearEndService.discard(c.id));
  const reverse = (c: YearEndClosing) => {
    const reason = window.prompt(`Why is the ${c.fyCode} closing being reversed?`);
    if (!reason) return;
    return run(`${c.fyCode} reopened`, () => yearEndService.reverse(c.id, reason));
  };
  const saveFreeze = () =>
    run("Freeze date saved", () => yearEndService.setFreezeDate(freeze || null, allowBack));

  const existing = preview?.existing ?? null;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">Year-End Closing</h2>
        <p className="text-sm text-ink-muted">
          Transfer the year&apos;s result to Retained Earnings, close the year&apos;s periods, open
          the next year and freeze the books. Prepared by one person, approved by another.
        </p>
      </div>

      <section className="rounded-xl border border-line-soft bg-card p-4">
        <h3 className="text-sm font-semibold text-ink">Books frozen up to</h3>
        <p className="mb-3 text-xs text-ink-muted">
          Nothing dated on or before this day can be posted or changed. It moves forward on its own
          when a year is closed; moving it back needs the box ticked.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            className={input}
            value={freeze}
            onChange={(e) => setFreeze(e.target.value)}
            disabled={!can("accounts.edit")}
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={allowBack}
              onChange={(e) => setAllowBack(e.target.checked)}
            />
            Allow moving it back
          </label>
          {can("accounts.edit") && (
            <button type="button" className={secondary} onClick={saveFreeze} disabled={busy}>
              Save
            </button>
          )}
          <span className="text-xs text-ink-muted">
            Currently:{" "}
            {control?.booksFrozenUpTo ? formatDate(control.booksFrozenUpTo) : "not frozen"}
          </span>
        </div>
      </section>

      <section className="rounded-xl border border-line-soft bg-card p-4 space-y-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(fyCode.trim());
          }}
        >
          <label className="text-xs font-medium text-ink-muted">
            Financial year
            <input
              className={`${input} block w-32`}
              value={fyCode}
              onChange={(e) => setFyCode(e.target.value)}
              placeholder="2025-26"
              pattern="\d{4}-\d{2}"
            />
          </label>
          <button type="submit" className={secondary} disabled={loading}>
            Preview
          </button>
        </form>

        {preview && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-ink">
                Closing journal for {preview.fy.periodName}
              </h3>
              <span className="text-xs text-ink-muted">
                {formatDate(preview.fy.start)} – {formatDate(preview.fy.end)}
              </span>
              {existing && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[existing.status]}`}
                >
                  {existing.status}
                </span>
              )}
            </div>
            {preview.blockers.length > 0 && (
              <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {preview.stale && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                The books changed since this closing was prepared. Discard it and prepare again.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-1 pr-4">Ledger</th>
                    <th className="py-1 pr-4">Type</th>
                    <th className="py-1 pr-4 text-right">Debit</th>
                    <th className="py-1 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-ink-muted">
                        No income or expense was recorded in this year.
                      </td>
                    </tr>
                  )}
                  {preview.lines.map((l) => (
                    <tr key={`${l.ledgerId}-${l.side}`} className="border-t border-line-soft">
                      <td className="py-1 pr-4 text-ink">
                        <span className="font-mono text-xs text-ink-muted">{l.code}</span> {l.name}
                      </td>
                      <td className="py-1 pr-4 text-ink-muted">{l.type}</td>
                      <td className="py-1 pr-4 text-right text-ink">
                        {l.side === "DEBIT" ? inr(l.amount) : ""}
                      </td>
                      <td className="py-1 text-right text-ink">
                        {l.side === "CREDIT" ? inr(l.amount) : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line-soft text-sm font-semibold text-ink">
                  <tr>
                    <td className="py-1 pr-4" colSpan={2}>
                      Income {inr(preview.totalIncome)} · Expenses {inr(preview.totalExpense)} ·{" "}
                      {preview.netProfit >= 0 ? "Profit" : "Loss"}{" "}
                      {inr(Math.abs(preview.netProfit))}
                    </td>
                    <td className="py-1 pr-4 text-right">
                      {inr(
                        preview.lines
                          .filter((l) => l.side === "DEBIT")
                          .reduce((s, l) => s + l.amount, 0)
                      )}
                    </td>
                    <td className="py-1 text-right">
                      {inr(
                        preview.lines
                          .filter((l) => l.side === "CREDIT")
                          .reduce((s, l) => s + l.amount, 0)
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!existing && can("year-end.prepare") && (
                <>
                  <input
                    className={`${input} w-72`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Note for the approver (optional)"
                    maxLength={255}
                  />
                  <button
                    type="button"
                    className={primary}
                    onClick={prepare}
                    disabled={busy || !preview.canPrepare}
                  >
                    Prepare for approval
                  </button>
                </>
              )}
              {existing?.status === "PREPARED" && can("year-end.approve") && (
                <button
                  type="button"
                  className={primary}
                  onClick={() => void approve(existing)}
                  disabled={busy || preview.stale}
                >
                  Approve and close {existing.fyCode}
                </button>
              )}
              {existing?.status === "PREPARED" && can("year-end.prepare") && (
                <button
                  type="button"
                  className={secondary}
                  onClick={() => void discard(existing)}
                  disabled={busy}
                >
                  Discard preparation
                </button>
              )}
              {existing?.status === "APPROVED" && can("year-end.approve") && (
                <button
                  type="button"
                  className={danger}
                  onClick={() => void reverse(existing)}
                  disabled={busy}
                >
                  Reverse closing
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-line-soft bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">History</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="py-1 pr-4">Year</th>
                <th className="py-1 pr-4">Status</th>
                <th className="py-1 pr-4 text-right">Result</th>
                <th className="py-1 pr-4">Journal</th>
                <th className="py-1 pr-4">Prepared</th>
                <th className="py-1 pr-4">Approved</th>
                <th className="py-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {closings.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-center text-ink-muted">
                    No year has been closed yet.
                  </td>
                </tr>
              )}
              {closings.map((c) => (
                <tr key={c.id} className="border-t border-line-soft">
                  <td className="py-1 pr-4 text-ink">{c.fyCode}</td>
                  <td className="py-1 pr-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[c.status]}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="py-1 pr-4 text-right text-ink">
                    {c.netProfit >= 0 ? "" : "−"}
                    {inr(Math.abs(c.netProfit))}
                  </td>
                  <td className="py-1 pr-4 font-mono text-xs text-ink">
                    {c.closingVoucher?.voucherNo ?? "—"}
                  </td>
                  <td className="py-1 pr-4 text-ink-muted">{formatDateTime(c.preparedAt)}</td>
                  <td className="py-1 pr-4 text-ink-muted">
                    {c.approvedAt ? formatDateTime(c.approvedAt) : "—"}
                  </td>
                  <td className="py-1 text-ink-muted">{c.reverseReason ?? c.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default YearEndPage;
