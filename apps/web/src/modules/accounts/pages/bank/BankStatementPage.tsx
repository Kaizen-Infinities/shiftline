import React, { useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { Landmark, RefreshCw } from "lucide-react";
import { ActionPill, PageHeader } from "../../../../components/ui/v2";
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
    <div className="w-full space-y-4">
      <PageHeader
        back="/accounts/bank-accounts"
        backLabel="Back to bank accounts"
        breadcrumbs={[
          { label: "Bank & Cash Accounts", to: "/accounts/bank-accounts" },
          { label: data?.ledger?.name || "Statement" },
        ]}
        title={data?.ledger?.name || "Bank Statement"}
        subtitle={data?.ledger ? `${data.ledger.code} · ${data.ledger.group}` : "Running statement"}
        icon={<Landmark size={20} />}
        actions={
          <ActionPill
            variant="secondary"
            icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
            onClick={refresh}
          >
            Refresh
          </ActionPill>
        }
      />
      <div className="sl-tile">
        {/* Filter row */}
        <div className="p-4 sm:p-5 flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-[170px]">
            <label className="sl-label">From</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="sl-input h-11 w-full text-sm"
            />
          </div>
          <div className="w-full sm:w-[170px]">
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
              className="sl-btn sl-pill-sm"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Balance Summary - compact 3-up */}
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
          <div className="sl-tile p-4 sm:p-5">
            <p className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
              Opening Balance
            </p>
            <p className="text-base tabular-nums font-bold text-ink mt-0.5">
              ₹{Math.abs(data.openingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="sl-tile p-4 sm:p-5">
            <p className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
              Closing Balance
            </p>
            <p
              className={`text-base tabular-nums font-bold mt-0.5 ${data.closingBalance >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-danger)]"}`}
            >
              ₹{Math.abs(data.closingBalance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="sl-tile p-4 sm:p-5">
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
          <div className="p-10 text-center text-sm text-ink-muted">
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
