import React, { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FaUniversity, FaArrowLeft, FaSync } from "react-icons/fa";
import { toast } from "react-toastify";
import { accountService, type LedgerStatementResult } from "../../../../services/accountService";
import { useListCache } from "../../../../hooks/useListCache";

const BankStatementPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const cacheKey = `accounts:bank-statement-${id || "none"}:${startDate}:${endDate}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      if (!id) return { data: [], total: 0 };
      try {
        const result = await accountService.fetchStatement(parseInt(id, 10), {
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        });
        return { data: result ? [result] : [], total: result?.entries?.length || 0 };
      } catch (err: any) {
        toast.error(err?.message || "Failed to load statement");
        throw err;
      }
    },
    [id, startDate, endDate]
  );

  const {
    data: statementList,
    loading,
    refreshing,
    refresh,
  } = useListCache<LedgerStatementResult>({
    cacheKey,
    socketModule: "voucher",
    fetcher,
    enabled: !!id,
  });

  const data: LedgerStatementResult | null = statementList[0] || null;

  return (
    <div className="p-3 space-y-3 min-h-screen">
      {/* Compact merged header + filters */}
      <div className="sl-tile">
        <div className="px-3 py-2 border-b border-line flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-ink flex items-center gap-2">
            <FaUniversity className="text-accent text-sm" />
            {data?.ledger?.name || "Bank Statement"}
            {data?.ledger && (
              <span className="text-[11.5px] uppercase tracking-wide tabular-nums text-ink-subtle">
                · {data.ledger.code} · {data.ledger.group}
              </span>
            )}
            {refreshing && <FaSync className="animate-spin text-accent text-[11.5px]" />}
          </h2>
          <div className="flex items-center gap-1.5">
            <button onClick={refresh} className="sl-btn sl-pill-sm">
              <FaSync className={refreshing ? "animate-spin text-accent" : ""} /> Refresh
            </button>
            <button
              onClick={() => navigate("/accounts/bank-accounts")}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-card-2 hover:bg-line text-ink-muted rounded text-xs font-semibold transition-all border border-line cursor-pointer"
            >
              <FaArrowLeft className="text-[11.5px]" /> Back
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="px-3 py-2 bg-card-2 flex flex-wrap items-end gap-2">
          <div className="w-[140px]">
            <label className="sl-label">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="sl-input h-11 w-full text-sm"
            />
          </div>
          <div className="w-[140px]">
            <label className="sl-label">To</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="sl-input h-11 w-full text-sm"
            />
          </div>
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="px-2.5 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink hover:bg-card rounded transition-colors border border-line cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Balance Summary - compact 3-up */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="sl-tile px-3 py-2">
            <p className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
              Opening Balance
            </p>
            <p className="text-base tabular-nums font-bold text-ink mt-0.5">
              ₹{Math.abs(data.openingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="sl-tile px-3 py-2">
            <p className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
              Closing Balance
            </p>
            <p
              className={`text-base tabular-nums font-bold mt-0.5 ${data.closingBalance >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-danger)]"}`}
            >
              ₹{Math.abs(data.closingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="sl-tile px-3 py-2">
            <p className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
              Transactions
            </p>
            <p className="text-base tabular-nums font-bold text-ink mt-0.5">
              {data.entries.length}
            </p>
          </div>
        </div>
      )}

      {/* Statement Table - compact */}
      <div className="sl-tile overflow-hidden">
        <div className="px-3 py-2 border-b border-line bg-card-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">Transaction Statement</h2>
          <span className="text-[12.5px] text-ink-subtle tabular-nums">
            {data?.entries.length || 0} entries
          </span>
        </div>

        {!data && loading ? null : !data || data.entries.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-subtle">
            No transactions found for this period.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-ink-muted border-collapse">
              <thead className="bg-card-2 text-ink text-[11.5px] uppercase font-bold tracking-wide border-b border-line">
                <tr>
                  <th className="px-3 py-1.5 text-xs">Date</th>
                  <th className="px-3 py-1.5 text-xs">Voucher No</th>
                  <th className="px-3 py-1.5 text-xs">Type</th>
                  <th className="px-3 py-1.5 text-xs">Particulars</th>
                  <th className="px-3 py-1.5 text-xs text-right">Debit (₹)</th>
                  <th className="px-3 py-1.5 text-xs text-right">Credit (₹)</th>
                  <th className="px-3 py-1.5 text-xs text-right">Balance (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {data.entries.map((entry, idx) => (
                  <tr key={entry.id || idx} className="hover:bg-card-2 transition-colors">
                    <td className="px-3 py-1.5 text-xs whitespace-nowrap tabular-nums">
                      {new Date(entry.date).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-3 py-1.5 text-xs tabular-nums font-medium text-accent">
                      {entry.voucherNo}
                    </td>
                    <td className="px-3 py-1.5 text-xs">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11.5px] font-bold uppercase ${
                          entry.voucherType === "RECEIPT"
                            ? "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]"
                            : entry.voucherType === "PAYMENT"
                              ? "bg-[color:var(--color-danger)]/10 text-[color:var(--color-danger)]"
                              : entry.voucherType === "CONTRA"
                                ? "bg-nav-active text-accent"
                                : entry.voucherType === "OPENING"
                                  ? "bg-[color:var(--color-warning)]/10 text-[color:var(--color-warning)]"
                                  : "bg-nav-active text-accent"
                        }`}
                      >
                        {entry.voucherType}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-ink max-w-xs truncate">
                      {entry.particulars || entry.narration || "-"}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                      {entry.debit > 0 ? (
                        <span className="text-[color:var(--color-success)] font-semibold">
                          {entry.debit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                      {entry.credit > 0 ? (
                        <span className="text-[color:var(--color-danger)] font-semibold">
                          {entry.credit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums font-bold text-ink">
                      ₹
                      {Math.abs(entry.runningBalance).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                      })}
                      {/* Bank/Cash is an ASSET — natural side is Dr. Negative
                          running balance means the ledger sits on Cr (overdraft /
                          cash shortage). Show "Cr" so the sign matches accounting
                          convention — old code wrote "Dr" here which was inverted. */}
                      {entry.runningBalance < 0 && (
                        <span className="text-[11.5px] text-[color:var(--color-danger)] ml-1">
                          Cr
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default BankStatementPage;
