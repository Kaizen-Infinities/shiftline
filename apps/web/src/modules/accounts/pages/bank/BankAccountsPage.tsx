import React, { useState, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaUniversity, FaPlus, FaArrowRight, FaTimes, FaSync, FaPen } from "react-icons/fa";
import { toast } from "react-toastify";
import { Banknote, Landmark, Plus, RefreshCw, Wrench } from "lucide-react";
import { ActionPill, Chip, PageHeader } from "../../../../components/ui/v2";
import { fmtINR } from "../../components/accountsUi";
import apiClient from "../../../../api/apiClient";
import { accountService } from "../../../../services/accountService";
import { useListCache, invalidateCache, prefetchCache } from "../../../../hooks/useListCache";
import { useSocketSync } from "../../../../hooks/useSocketSync";

interface BankAccount {
  id: number;
  code: string;
  name: string;
  group: string;
  currentBalance: number;
  totalDebit: number;
  totalCredit: number;
  hasOpeningBalance: boolean;
}

interface BankAccountsData {
  accounts: BankAccount[];
  totalBalance: number;
}

const isCashAccount = (group: string, name: string) => {
  const g = (group || "").toLowerCase().trim();
  if (g === "cash in hand" || g === "cash") return true;
  if (g === "cash & bank") {
    const n = (name || "").toLowerCase();
    return n.includes("cash") && !n.includes("bank");
  }
  return false;
};

const BankAccountsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterType = searchParams.get("filter"); // "cash" | "bank" | null (all)
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Add form state
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [newGroup, setNewGroup] = useState("Bank Accounts");
  const [newOpeningBalance, setNewOpeningBalance] = useState<string>("");
  const [newOpeningDC, setNewOpeningDC] = useState<"D" | "C">("C");

  // Edit-opening-balance modal state
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [editOpeningBalance, setEditOpeningBalance] = useState<string>("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [repairRunning, setRepairRunning] = useState(false);

  const cacheKey = `accounts:bank-accounts`;

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    try {
      const res = await apiClient.get("/accounts/bank-accounts");
      const payload: BankAccountsData = res.data?.data || { accounts: [], totalBalance: 0 };
      return { data: [payload], total: payload.accounts.length };
    } catch (err: any) {
      toast.error(err?.message || "Failed to load bank accounts");
      throw err;
    }
  }, []);

  // Prefetch each bank's statement in the background when the list loads.
  // By the time the user clicks a card, the detail cache is already warm →
  // BankStatementPage renders instantly with no "Loading..." flash.
  const onListSuccess = useCallback((list: BankAccountsData[]) => {
    const payload = list[0];
    if (!payload?.accounts) return;
    for (const acc of payload.accounts) {
      const detailKey = `accounts:bank-statement-${acc.id}::`;
      prefetchCache(detailKey, async () => {
        const stmt = await accountService.fetchStatement(acc.id, {});
        return { data: stmt ? [stmt] : [], total: stmt?.entries?.length || 0 };
      });
    }
  }, []);

  const {
    data: cachedList,
    loading,
    refreshing,
    refresh,
  } = useListCache<BankAccountsData>({
    cacheKey,
    socketModule: "accountLedger",
    fetcher,
    onSuccess: onListSuccess,
  });

  // useListCache only listens to ONE module. Bank balances change on ANY voucher
  // (payment/receipt/journal/contra), petty-cash entry, or expense posting — none
  // of which fire an `accountLedger:*` event. Add extra listeners so the cards
  // don't go stale after new activity elsewhere in the app.
  const invalidateAndRefresh = useCallback(() => {
    invalidateCache(cacheKey);
    refresh();
  }, [cacheKey, refresh]);
  useSocketSync("voucher", undefined, invalidateAndRefresh);
  useSocketSync("pettyCashEntry", undefined, invalidateAndRefresh);
  useSocketSync("expense", undefined, invalidateAndRefresh);

  const data: BankAccountsData = cachedList[0] || { accounts: [], totalBalance: 0 };

  const filteredAccounts = useMemo(() => {
    if (!filterType) return data.accounts;
    if (filterType === "cash") return data.accounts.filter((a) => isCashAccount(a.group, a.name));
    if (filterType === "bank") return data.accounts.filter((a) => !isCashAccount(a.group, a.name));
    return data.accounts;
  }, [data.accounts, filterType]);

  const filteredBalance = useMemo(() => {
    return filteredAccounts.reduce((sum, a) => sum + a.currentBalance, 0);
  }, [filteredAccounts]);

  const resetForm = () => {
    setNewName("");
    setNewCode("");
    setNewGroup("Bank Accounts");
    setNewOpeningBalance("");
    setNewOpeningDC("C");
  };

  const handleAddBank = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newName || !newCode) {
      toast.error("Account name and code are required");
      return;
    }
    const openingBalance = parseFloat(newOpeningBalance) || 0;
    if (openingBalance < 0) {
      toast.error("Opening balance cannot be negative — use the type dropdown instead");
      return;
    }
    setSubmitting(true);
    try {
      await accountService.createLedger({
        code: newCode,
        name: newName,
        type: "ASSET",
        group: newGroup,
        openingBalance,
        openingBalanceType: newOpeningDC === "C" ? "DEBIT" : "CREDIT",
      });
      toast.success(
        openingBalance > 0
          ? `Bank account "${newName}" created with opening balance ₹${openingBalance.toLocaleString("en-IN")}`
          : `Bank account "${newName}" created`
      );
      setShowAddForm(false);
      resetForm();
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create");
    } finally {
      setSubmitting(false);
    }
  };

  const runRepair = async () => {
    if (repairRunning) return;
    setRepairRunning(true);
    try {
      const res = await accountService.repairPartyOpeningVouchers();
      toast.success(
        res.removed > 0
          ? `Repaired ${res.removed} legacy opening-balance voucher(s)`
          : "No legacy opening-balance vouchers to repair"
      );
      invalidateCache(cacheKey);
      refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Repair failed");
    } finally {
      setRepairRunning(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title={
          filterType === "cash"
            ? "Cash Accounts"
            : filterType === "bank"
              ? "Bank Accounts"
              : "Bank & Cash Accounts"
        }
        subtitle="Every bank, overdraft and cash ledger with its current balance"
        icon={<Landmark size={20} />}
        primaryAction={
          <ActionPill icon={<Plus size={18} />} onClick={() => setShowAddForm(true)}>
            Add Account
          </ActionPill>
        }
        actions={
          <>
            <ActionPill
              variant="secondary"
              icon={<Wrench size={16} className={repairRunning ? "animate-spin" : ""} />}
              onClick={runRepair}
              disabled={repairRunning}
              title="One-time cleanup: removes legacy customer/supplier opening JVs that wrongly hit a bank ledger"
            >
              Repair
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />}
              onClick={refresh}
            >
              Refresh
            </ActionPill>
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="group" aria-label="Account type" className="flex flex-wrap gap-2">
            <Chip size="lg" selected={!filterType} onClick={() => setSearchParams({})}>
              All
            </Chip>
            <Chip
              size="lg"
              icon={<Banknote size={15} />}
              selected={filterType === "cash"}
              onClick={() => setSearchParams({ filter: "cash" })}
            >
              Cash
            </Chip>
            <Chip
              size="lg"
              icon={<Landmark size={15} />}
              selected={filterType === "bank"}
              onClick={() => setSearchParams({ filter: "bank" })}
            >
              Bank
            </Chip>
          </div>
          <div className="text-right">
            <div className="text-[12.5px] font-medium text-ink-subtle">
              {filterType === "cash"
                ? "Cash balance"
                : filterType === "bank"
                  ? "Bank balance"
                  : "Total balance"}
            </div>
            <div
              className={`text-2xl font-bold tabular-nums ${filteredBalance < 0 ? "text-[color:var(--color-danger)]" : "text-ink"}`}
            >
              {fmtINR(Math.abs(filteredBalance))}
            </div>
          </div>
        </div>
      </PageHeader>

      {/* Account Cards */}
      {filteredAccounts.length === 0 && !loading ? (
        <div className="sl-tile p-10 text-center text-sm text-ink-muted">
          {filterType === "cash"
            ? "No cash accounts found."
            : filterType === "bank"
              ? "No bank accounts found."
              : "No bank or cash accounts found."}{" "}
          Click "Add Account" to create one.
        </div>
      ) : filteredAccounts.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {filteredAccounts.map((acc) => (
            <div
              key={acc.id}
              onClick={() => navigate(`/accounts/bank-accounts/${acc.id}`)}
              className="sl-tile sl-tile-hover cursor-pointer p-4 sm:p-5 group"
            >
              <div className="flex items-start justify-between mb-2 gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-ink truncate">{acc.name}</h3>
                  <p className="text-[11.5px] uppercase tracking-wide tabular-nums text-ink-subtle mt-0.5">
                    {acc.code}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {!acc.hasOpeningBalance && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingBank(acc);
                        setEditOpeningBalance("");
                      }}
                      title="Set opening balance (one-time only)"
                      className="p-1 rounded-sm border border-line text-ink-subtle hover:text-accent hover:border-accent/40 transition-colors"
                    >
                      <FaPen className="text-[12.5px]" />
                    </button>
                  )}
                  <span className="px-1.5 py-0.5 rounded-sm text-[11.5px] font-bold uppercase border border-line bg-card-2 text-ink-muted">
                    {isCashAccount(acc.group, acc.name) ? "Cash" : "Bank"}
                  </span>
                </div>
              </div>
              <div className="border-t border-line pt-2">
                <p className="text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                  Current Balance
                </p>
                <p
                  className={`text-base tabular-nums font-bold mt-0.5 ${
                    acc.currentBalance >= 0
                      ? "text-[color:var(--color-success)]"
                      : "text-[color:var(--color-danger)]"
                  }`}
                >
                  ₹
                  {Math.abs(acc.currentBalance).toLocaleString("en-IN", {
                    minimumFractionDigits: 2,
                  })}
                  <span className="text-[11.5px] ml-1">
                    {acc.currentBalance >= 0 ? "(Cr)" : "(Dr)"}
                  </span>
                </p>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-line-soft">
                <div className="text-[12.5px] text-ink-subtle">
                  <span className="text-[color:var(--color-success)] font-semibold">
                    ↑ ₹{acc.totalDebit.toLocaleString("en-IN")}
                  </span>
                  {" / "}
                  <span className="text-[color:var(--color-danger)] font-semibold">
                    ↓ ₹{acc.totalCredit.toLocaleString("en-IN")}
                  </span>
                </div>
                <FaArrowRight className="text-ink-subtle group-hover:text-accent transition-colors w-2.5 h-2.5" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Bank Account Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-line rounded-sm shadow-md w-[520px] max-w-[95vw] overflow-hidden">
            <div className="px-4 py-2.5 bg-card-2 border-b border-line text-ink flex items-center gap-2">
              <FaUniversity className="text-sm text-ink-muted" />
              <h2 className="text-sm font-bold flex-1">Add Bank / Cash Account</h2>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  resetForm();
                }}
                className="text-ink-muted hover:text-ink"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>

            <form onSubmit={handleAddBank} className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block mb-1 text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                    Account Name <span className="text-[color:var(--color-danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Current account — Chennai"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 border border-line bg-card-2 rounded-sm text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                    required
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block mb-1 text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                    Account Code <span className="text-[color:var(--color-danger)]">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TMB-001"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 border border-line bg-card-2 rounded-sm text-xs text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                    required
                  />
                </div>

                <div>
                  <label className="block mb-1 text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                    Type
                  </label>
                  <select
                    value={newGroup}
                    onChange={(e) => setNewGroup(e.target.value)}
                    className="w-full px-3 py-2 border border-line bg-card-2 rounded-sm text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                  >
                    <option value="Bank Accounts">Bank Account</option>
                    <option value="Cash in Hand">Cash in Hand</option>
                  </select>
                </div>

                <div>
                  <label className="block mb-1 text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                    Opening Balance (₹)
                  </label>
                  <div className="flex gap-1">
                    <select
                      value={newOpeningDC}
                      onChange={(e) => setNewOpeningDC(e.target.value as "D" | "C")}
                      className={`px-2 py-2 border border-line bg-card-2 rounded-sm text-xs font-bold tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent ${newOpeningDC === "D" ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success)]"}`}
                    >
                      <option value="D">Dr</option>
                      <option value="C">Cr</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={newOpeningBalance}
                      onChange={(e) => setNewOpeningBalance(e.target.value)}
                      className="flex-1 px-3 py-2 border border-line bg-card-2 rounded-sm text-xs text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                    />
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-subtle">
                    <span className="text-[color:var(--color-danger)] font-bold">Dr</span> = Minus
                    (↓) &nbsp;·&nbsp;
                    <span className="text-[color:var(--color-success)] font-bold">Cr</span> = Add
                    (↑)
                  </p>
                </div>
              </div>

              <div className="text-[11.5px] text-ink-subtle bg-card-2 border border-line rounded-sm p-2 leading-relaxed">
                💡 <b>Tip:</b> Enter the actual bank balance shown in your bank statement/passbook.
                A JV will auto-post: <b>Debit</b> {newName || "this account"} ₹
                {parseFloat(newOpeningBalance) || 0}
                {" · "}
                <b>Credit</b> Opening Balance Equity. Every subsequent transaction updates from this
                starting balance.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm(false);
                    resetForm();
                  }}
                  className="sl-btn sl-pill-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="sl-cta sl-pill-sm">
                  {submitting ? (
                    <>
                      <FaSync className="animate-spin text-[11.5px]" /> Creating...
                    </>
                  ) : (
                    <>
                      <FaPlus className="text-[11.5px]" /> Create Account
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Opening Balance Modal */}
      {editingBank && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-line rounded-sm shadow-md w-[480px] max-w-[95vw] overflow-hidden">
            <div className="px-4 py-2.5 bg-card-2 border-b border-line text-ink flex items-center gap-2">
              <FaPen className="text-xs text-ink-muted" />
              <h2 className="text-sm font-bold flex-1">Set Opening Balance — {editingBank.name}</h2>
              <button
                onClick={() => {
                  setEditingBank(null);
                  setEditOpeningBalance("");
                }}
                className="text-ink-muted hover:text-ink"
              >
                <FaTimes className="text-sm" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const amt = parseFloat(editOpeningBalance);
                if (!Number.isFinite(amt) || amt < 0) {
                  toast.error("Enter a valid non-negative opening balance");
                  return;
                }
                setEditSubmitting(true);
                try {
                  await accountService.setBankOpeningBalance(editingBank.id, amt);
                  toast.success(
                    amt > 0
                      ? `Opening balance of ${editingBank.name} set to ₹${amt.toLocaleString("en-IN")}`
                      : `Opening balance of ${editingBank.name} cleared`
                  );
                  setEditingBank(null);
                  setEditOpeningBalance("");
                  invalidateCache(cacheKey);
                  refresh();
                } catch (err: any) {
                  toast.error(
                    err?.response?.data?.message || err?.message || "Failed to set opening balance"
                  );
                } finally {
                  setEditSubmitting(false);
                }
              }}
              className="p-4 space-y-3"
            >
              <div>
                <label className="block mb-1 text-[11.5px] uppercase tracking-wide font-semibold text-ink-subtle">
                  Actual Opening Balance (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 150000.00"
                  value={editOpeningBalance}
                  onChange={(e) => setEditOpeningBalance(e.target.value)}
                  className="w-full px-3 py-2 border border-line bg-card-2 rounded-sm text-xs text-ink tabular-nums focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent"
                  autoFocus
                />
              </div>

              <div className="text-[11.5px] text-ink-subtle bg-card-2 border border-line rounded-sm p-2 leading-relaxed">
                💡 A JV will auto-post: <b>Debit</b> {editingBank.name} ₹
                {parseFloat(editOpeningBalance) || 0}
                {" · "}
                <b>Credit</b> Opening Balance Equity. Any previous opening JV for this account is
                replaced.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => {
                    setEditingBank(null);
                    setEditOpeningBalance("");
                  }}
                  className="sl-btn sl-pill-sm"
                >
                  Cancel
                </button>
                <button type="submit" disabled={editSubmitting} className="sl-cta sl-pill-sm">
                  {editSubmitting ? (
                    <>
                      <FaSync className="animate-spin text-[11.5px]" /> Saving...
                    </>
                  ) : (
                    "Save Opening Balance"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankAccountsPage;
