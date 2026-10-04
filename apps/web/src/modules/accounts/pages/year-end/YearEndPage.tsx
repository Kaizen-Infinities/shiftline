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
import { CalendarCheck } from "lucide-react";
import { PageHeader, useConfirm } from "../../../../components/ui/v2";

/**
 * Year-end closing (P1-09e). Preview the closing journal for a financial year, prepare it, have
 * an approver post it (which also closes the year's periods, opens the next year and freezes
 * the books), or reverse a closing after moving the freeze date back.
 */
const input = "sl-input h-11 !w-auto min-w-44 text-sm";
const primary = "sl-cta sl-pill-sm";
const secondary = "sl-btn sl-pill-sm";
const danger = "sl-btn-danger sl-pill-sm";

const STATUS_STYLE: Record<string, string> = {
  PREPARED: "sl-chip-warning",
  APPROVED: "sl-chip-success",
  REVERSED: "sl-chip-danger",
  DISCARDED: "sl-chip-muted",
};

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const YearEndPage: React.FC = () => {
  const [confirm, confirmDialog] = useConfirm();
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
  const approve = async (c: YearEndClosing) => {
    const ok = await confirm({
      title: "Close financial year",
      message: `Close ${c.fyCode}? The closing journal is posted on ${formatDate(c.fyEnd)}, the year's periods close and the books freeze up to that date.`,
      confirmText: "Close year",
      destructive: true,
    });
    if (!ok) return;
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
    <div className="sl-page">
      {confirmDialog}
      <PageHeader
        title="Year-end closing"
        subtitle="Transfer the year's result to Retained Earnings, close the year's periods, open the next year and freeze the books. Prepared by one person, approved by another."
        icon={<CalendarCheck size={20} />}
      />

      <section className="sl-tile p-5 sm:p-6">
        <h2 className="sl-h2 m-0 text-[16px]">Books frozen up to</h2>
        <p className="sl-muted mb-4 mt-1 text-sm">
          Nothing dated on or before this day can be posted or changed. It moves forward on its own
          when a year is closed; moving it back needs the box ticked.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            aria-label="Books frozen up to"
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

      <section className="sl-tile p-5 sm:p-6 space-y-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(fyCode.trim());
          }}
        >
          <label className="sl-label !mb-0 flex-col items-start gap-1.5">
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
              <h2 className="sl-h2 m-0 text-[16px]">Closing journal for {preview.fy.periodName}</h2>
              <span className="text-xs text-ink-muted">
                {formatDate(preview.fy.start)} – {formatDate(preview.fy.end)}
              </span>
              {existing && (
                <span className={`sl-chip sl-chip-sm ${STATUS_STYLE[existing.status]}`}>
                  {existing.status}
                </span>
              )}
            </div>
            {preview.blockers.length > 0 && (
              <ul className="rounded-lg border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 px-3 py-2 text-sm text-[color:var(--color-warning)]">
                {preview.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            {preview.stale && (
              <p className="rounded-lg border border-[color:var(--color-danger)]/40 bg-[color:var(--color-danger)]/10 px-3 py-2 text-sm text-[color:var(--color-danger)]">
                The books changed since this closing was prepared. Discard it and prepare again.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-card-2 text-left text-[12px] font-semibold text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
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
                        <span className="tabular-nums text-xs text-ink-muted">{l.code}</span>{" "}
                        {l.name}
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
                    aria-label="Note for the approver (optional)"
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

      <section className="sl-tile p-5 sm:p-6">
        <h2 className="sl-h2 m-0 mb-3 text-[16px]">History</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-card-2 text-left text-[12px] font-semibold text-ink-muted [&_th]:px-3 [&_th]:py-2.5">
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
                    <span className={`sl-chip sl-chip-sm ${STATUS_STYLE[c.status]}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-1 pr-4 text-right text-ink">
                    {c.netProfit >= 0 ? "" : "−"}
                    {inr(Math.abs(c.netProfit))}
                  </td>
                  <td className="py-1 pr-4 tabular-nums text-xs text-ink">
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
