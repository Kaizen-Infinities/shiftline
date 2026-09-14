import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import apiClient from "../../../api/apiClient";
import {
  bankingService,
  type Brs,
  type ChequeRow,
  type MatchCandidate,
  type StatementFormat,
  type StatementLineRow,
} from "../../../services/bankingService";
import {
  Card,
  danger,
  day,
  field,
  message,
  money,
  primary,
  secondary,
  success,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Bank reconciliation and cheques (P1-20).
 *
 * The unmatched lines are the work, so they come first and the matched ones are out of the way.
 * Every automatic match shows what it matched on, because a match nobody can check is a match
 * nobody should trust.
 */
type Tab = "lines" | "brs" | "cheques" | "import";
const FORMATS: StatementFormat[] = ["HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "GENERIC"];
const CHEQUE_STYLE: Record<ChequeRow["status"], string> = {
  IN_HAND: "bg-amber-100 text-amber-800",
  DEPOSITED: "bg-sky-100 text-sky-800",
  CLEARED: "bg-emerald-100 text-emerald-800",
  BOUNCED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-slate-100 text-slate-700",
};

interface BankAccountOption {
  id: string;
  bankName: string;
  accountNumber?: string | null;
}

const BankReconciliationPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<Tab>("lines");
  const [accounts, setAccounts] = useState<BankAccountOption[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [lines, setLines] = useState<StatementLineRow[]>([]);
  const [brs, setBrs] = useState<Brs | null>(null);
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [matching, setMatching] = useState<{
    line: StatementLineRow;
    options: MatchCandidate[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const rows = (await apiClient.get("/accounts/bank-accounts")).data
          .data as BankAccountOption[];
        setAccounts(rows);
        if (rows[0]) setBankAccountId(rows[0].id);
      } catch {
        // The picker is empty until an account exists; the tabs say so themselves.
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!bankAccountId && tab !== "cheques") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (tab === "lines") setLines(await bankingService.lines({ bankAccountId }));
      if (tab === "brs") setBrs(await bankingService.brs(bankAccountId));
      if (tab === "cheques") setCheques(await bankingService.cheques());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, bankAccountId]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const unmatched = lines.filter((l) => l.status === "UNMATCHED");

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Bank Reconciliation</h1>
          <p className="text-sm text-ink-muted">
            The statement against the cash book, and the cheques that have not turned into money
            yet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className={field}
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            aria-label="Bank account"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bankName}
                {a.accountNumber ? ` · ${a.accountNumber}` : ""}
              </option>
            ))}
            {accounts.length === 0 && <option value="">No bank account yet</option>}
          </select>
          {tab === "lines" && can("banking.manage") && bankAccountId && (
            <button
              className={primary}
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const out = await bankingService.autoMatch(bankAccountId);
                  toast.info(
                    `${out.matched} matched, ${out.leftForAPerson} left for you to look at`
                  );
                }, "Matched")
              }
            >
              Match what it can
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {(
          [
            ["lines", "Statement lines"],
            ["brs", "Reconciliation"],
            ["cheques", "Cheques"],
            ["import", "Import a statement"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-semibold transition ${
              tab === key
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && <p className="text-sm text-ink-muted">Loading…</p>}

      {tab === "lines" && (
        <Card title={`Statement lines · ${unmatched.length} still to deal with`}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>What the bank called it</th>
                  <th className={th}>Reference</th>
                  <th className={`${th} text-right`}>Out</th>
                  <th className={`${th} text-right`}>In</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-line-soft">
                    <td className={td}>{day(l.txnDate)}</td>
                    <td className={td}>{l.description}</td>
                    <td className={td}>{l.refNo ?? "—"}</td>
                    <td className={`${td} text-right`}>
                      {Number(l.debit) > 0 ? money(l.debit) : ""}
                    </td>
                    <td className={`${td} text-right`}>
                      {Number(l.credit) > 0 ? money(l.credit) : ""}
                    </td>
                    <td className={td}>
                      {l.status === "MATCHED" ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                          matched
                          {l.matchConfidence !== null && l.matchConfidence < 100
                            ? ` · ${l.matchConfidence}%`
                            : ""}
                        </span>
                      ) : l.status === "IGNORED" ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          set aside
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          unmatched
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {can("banking.manage") &&
                        (l.status === "UNMATCHED" ? (
                          <button
                            className={secondary}
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                setMatching({
                                  line: l,
                                  options: await bankingService.candidates(l.id),
                                });
                              } catch (err) {
                                toast.error(message(err));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Find a match
                          </button>
                        ) : (
                          <button
                            className={secondary}
                            disabled={busy}
                            onClick={() => act(() => bankingService.unmatch(l.id), "Unmatched")}
                          >
                            Undo
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={7}>
                      No statement has been imported for this account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "brs" && brs && (
        <>
          <Card title={`Reconciliation as at ${brs.asOn}`}>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Balance per the books" value={money(brs.bookBalance)} />
              <Row
                label="Balance per the bank"
                value={brs.bankBalance === null ? "not on the statement" : money(brs.bankBalance)}
              />
              <Row
                label="Add: cheques issued, not presented"
                value={money(brs.reconcilingItems.chequesIssuedNotPresented)}
              />
              <Row
                label="Less: deposits not yet credited"
                value={money(brs.reconcilingItems.depositsNotYetCredited)}
              />
              <Row
                label="Less: charges not in the books"
                value={money(brs.reconcilingItems.chargesNotInBooks)}
              />
              <Row
                label="Add: credits not in the books"
                value={money(brs.reconcilingItems.creditsNotInBooks)}
              />
            </dl>
            <p className="mt-3 text-lg font-semibold text-ink">
              Reconciled balance {money(brs.reconciledBalance)}
            </p>
            {brs.difference !== null && Math.abs(brs.difference) >= 0.01 && (
              <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
                {money(Math.abs(brs.difference))} is still unexplained. That difference is the whole
                reason for doing this — it is shown rather than absorbed.
              </p>
            )}
            {brs.unmatchedLines > 0 && (
              <p className="mt-2 text-xs text-ink-muted">
                {brs.unmatchedLines} statement line(s) are still unmatched.
              </p>
            )}
          </Card>
        </>
      )}

      {tab === "cheques" && (
        <Card title="Cheque register">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Cheque</th>
                  <th className={th}>Dated</th>
                  <th className={th}>Party</th>
                  <th className={th}>Kind</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {cheques.map((c) => (
                  <tr key={c.id} className="border-t border-line-soft">
                    <td className={td}>
                      {c.chequeNo}
                      {c.bankName && <div className="text-xs text-ink-muted">{c.bankName}</div>}
                    </td>
                    <td className={td}>{day(c.chequeDate)}</td>
                    <td className={td}>{c.partyName ?? "—"}</td>
                    <td className={td}>{c.kind.toLowerCase()}</td>
                    <td className={`${td} text-right font-semibold`}>{money(c.amount)}</td>
                    <td className={td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CHEQUE_STYLE[c.status]}`}
                      >
                        {c.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                      {c.bounceReason && (
                        <div className="text-xs text-rose-700">{c.bounceReason}</div>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      {can("banking.manage") &&
                        (c.status === "IN_HAND" || c.status === "DEPOSITED") && (
                          <>
                            {c.status === "IN_HAND" && (
                              <button
                                className={`${secondary} mr-2`}
                                disabled={busy}
                                onClick={() =>
                                  act(
                                    () =>
                                      bankingService.setChequeStatus(c.id, { status: "DEPOSITED" }),
                                    "Deposited"
                                  )
                                }
                              >
                                Deposit
                              </button>
                            )}
                            <button
                              className={`${success} mr-2`}
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () => bankingService.setChequeStatus(c.id, { status: "CLEARED" }),
                                  "Cleared"
                                )
                              }
                            >
                              Cleared
                            </button>
                            <button
                              className={danger}
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt("Why did it come back?");
                                if (reason === null) return;
                                const charges = window.prompt("What did the bank charge?", "0");
                                void act(
                                  () =>
                                    bankingService.setChequeStatus(c.id, {
                                      status: "BOUNCED",
                                      bounceReason: reason,
                                      bounceCharges: Number(charges ?? 0) || 0,
                                    }),
                                  "Recorded as returned"
                                );
                              }}
                            >
                              Bounced
                            </button>
                          </>
                        )}
                      {can("banking.manage") && c.status === "BOUNCED" && (
                        <button
                          className={secondary}
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => bankingService.rePresent(c.id),
                              "Re-presented — posted again and back in the bank"
                            )
                          }
                        >
                          Re-present
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {cheques.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={7}>
                      No cheques on the register.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "import" && (
        <ImportCard
          busy={busy}
          bankAccountId={bankAccountId}
          onDone={(body) =>
            act(async () => {
              const out = await bankingService.importStatement(body);
              toast.info(
                `${out.imported} line(s) imported, ${out.skippedAsDuplicates} already on file`
              );
              setTab("lines");
            }, "Imported")
          }
        />
      )}

      {matching && (
        <MatchDialog
          line={matching.line}
          options={matching.options}
          busy={busy}
          onCancel={() => setMatching(null)}
          onPick={(voucherId) =>
            act(async () => {
              await bankingService.match(matching.line.id, voucherId);
              setMatching(null);
            }, "Matched")
          }
          onIgnore={(note) =>
            act(async () => {
              await bankingService.ignore(matching.line.id, note);
              setMatching(null);
            }, "Set aside")
          }
        />
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 border-b border-line-soft py-1">
    <dt className="text-ink-muted">{label}</dt>
    <dd className="font-semibold text-ink">{value}</dd>
  </div>
);

const ImportCard: React.FC<{
  busy: boolean;
  bankAccountId: string;
  onDone: (body: {
    bankAccountId: string;
    format: StatementFormat;
    csv: string;
    fileName?: string;
  }) => void;
}> = ({ busy, bankAccountId, onDone }) => {
  const [format, setFormat] = useState<StatementFormat>("HDFC");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");

  return (
    <Card title="Import a statement">
      <p className="mb-3 text-xs text-ink-muted">
        Save the statement as CSV, or paste it straight from the bank&apos;s portal. Dates and
        amounts are normalised on the way in — there is no need to reformat a file the bank gave
        you. A row already on file is counted and skipped, so an overlapping export is safe.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-ink-muted">
          Bank
          <select
            className={`${field} mt-1 block`}
            value={format}
            onChange={(e) => setFormat(e.target.value as StatementFormat)}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f === "GENERIC" ? "Something else" : f}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-muted">
          File name
          <input
            className={`${field} mt-1 block`}
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="statement.csv"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-xs"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setCsv(await file.text());
            }}
          />
        </label>
      </div>
      <textarea
        className={`${field} mt-3 h-48 w-full font-mono text-xs`}
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder="Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance"
      />
      <div className="mt-3 flex justify-end">
        <button
          className={primary}
          disabled={busy || !csv.trim() || !bankAccountId}
          onClick={() =>
            onDone({ bankAccountId, format, csv, fileName: fileName.trim() || undefined })
          }
        >
          Import
        </button>
      </div>
    </Card>
  );
};

const MatchDialog: React.FC<{
  line: StatementLineRow;
  options: MatchCandidate[];
  busy: boolean;
  onCancel: () => void;
  onPick: (voucherId: number) => void;
  onIgnore: (note: string) => void;
}> = ({ line, options, busy, onCancel, onPick, onIgnore }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div className="w-full max-w-2xl rounded-xl border border-line-soft bg-card p-4">
      <h2 className="text-lg font-semibold text-ink">
        {day(line.txnDate)} · {line.description}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {Number(line.debit) > 0 ? `Out ${money(line.debit)}` : `In ${money(line.credit)}`}
        {line.refNo ? ` · reference ${line.refNo}` : ""}
      </p>
      <div className="mt-3 max-h-80 overflow-y-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Voucher</th>
              <th className={th}>Date</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={th}>Why it might be this</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.voucherId} className="border-t border-line-soft">
                <td className={td}>
                  {o.voucherNo}
                  {o.narration && <div className="text-xs text-ink-muted">{o.narration}</div>}
                </td>
                <td className={td}>{day(o.date)}</td>
                <td className={`${td} text-right`}>{money(o.amount)}</td>
                <td className={td}>
                  <span className="text-xs text-ink-muted">{o.why.join("; ")}</span>
                  <div className="text-xs font-semibold text-ink">{o.confidence}% sure</div>
                </td>
                <td className={`${td} text-right`}>
                  <button className={primary} disabled={busy} onClick={() => onPick(o.voucherId)}>
                    This one
                  </button>
                </td>
              </tr>
            ))}
            {options.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={5}>
                  Nothing in the books looks like this. It is probably a charge, interest, or
                  something that has not been entered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-between gap-2">
        <button
          className={secondary}
          disabled={busy}
          onClick={() => {
            const note = window.prompt("Why is this being set aside?");
            if (note) onIgnore(note);
          }}
        >
          Set aside
        </button>
        <button className={secondary} onClick={onCancel} disabled={busy}>
          Close
        </button>
      </div>
    </div>
  </div>
);

export default BankReconciliationPage;
