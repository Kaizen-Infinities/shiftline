import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  fxService,
  type BillOfEntryRow,
  type FxLine,
  type FxRevaluationRow,
} from "../../../services/fxService";
import {
  Card,
  day,
  field,
  message,
  money,
  monthOptions,
  primary,
  secondary,
  td,
  th,
} from "../components/reportUi";

/**
 * Foreign exchange and imports (P1-17).
 *
 * The exposure comes first because it is the number nobody sees until the year end: what is still
 * owed in a foreign currency, and what the rupee has done to it since. The restatement below it
 * says plainly that it reverses the next day, because an accountant who does not know that will
 * count the movement twice.
 */
type Tab = "exposure" | "revaluations" | "imports";
const STATUS_STYLE: Record<FxRevaluationRow["status"], string> = {
  DRAFT: "sl-chip-warning",
  POSTED: "sl-chip-success",
  REVERSED: "sl-chip-muted",
};

const ForexPage: React.FC = () => {
  const { can } = usePermission();
  const months = useMemo(() => monthOptions(12), []);
  const [tab, setTab] = useState<Tab>("exposure");
  const [periodKey, setPeriodKey] = useState(months[1]?.value ?? months[0].value);
  const [exposure, setExposure] = useState<FxLine[]>([]);
  const [revaluations, setRevaluations] = useState<FxRevaluationRow[]>([]);
  const [preview, setPreview] = useState<{
    asOn: string;
    netAmount: number;
    lines: FxLine[];
  } | null>(null);
  const [bills, setBills] = useState<BillOfEntryRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "exposure") setExposure(await fxService.exposure());
      if (tab === "revaluations") {
        setRevaluations(await fxService.revaluations());
        setPreview(await fxService.previewRevaluation(periodKey).catch(() => null));
      }
      if (tab === "imports") setBills(await fxService.billsOfEntry());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, periodKey]);
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
  const net = exposure.reduce((s, l) => s + l.difference, 0);
  const done = revaluations.find((r) => r.periodKey === periodKey);

  return (
    <div className="sl-page">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="sl-h1 m-0 leading-tight">Foreign Exchange</h1>
          <p className="sl-muted m-0 mt-1 max-w-3xl text-sm leading-snug">
            What is still owed in a foreign currency, what the rupee has done to it, and what
            customs charged on the way in.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "revaluations" && (
            <select
              className={field}
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
              aria-label="Period"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {tab === "exposure" && can("currencies.edit") && (
            <button
              className={secondary}
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const out = await fxService.pullRates({});
                  if (out.missing.length > 0) {
                    toast.info(`No rate published for ${out.missing.join(", ")}`);
                  }
                }, "Rates pulled")
              }
            >
              Pull today&apos;s rates
            </button>
          )}
          {tab === "imports" && can("imports.create") && (
            <button className={primary} onClick={() => setAdding(true)}>
              Record a bill of entry
            </button>
          )}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["exposure", "Open exposure"],
            ["revaluations", "Restatement"],
            ["imports", "Imports"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="sl-chip sl-chip-lg"
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && (
        <div className="sl-tile space-y-3 p-5" role="status" aria-label="Loading">
          <div className="sl-skeleton h-4 w-2/5" />
          <div className="sl-skeleton h-3 w-3/4" />
          <div className="sl-skeleton h-3 w-1/2" />
        </div>
      )}

      {tab === "exposure" && (
        <>
          <Card title="If everything were settled at today's rate">
            <p
              className={`text-2xl font-semibold ${net >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-danger)]"}`}
            >
              {net >= 0 ? "Gain" : "Loss"} of {money(Math.abs(net))}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Across {exposure.length} open document(s). Nothing is posted from this screen — it is
              what the restatement would find.
            </p>
          </Card>
          <Card title="Open foreign-currency documents">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Document</th>
                    <th className={th}>Type</th>
                    <th className={th}>Party</th>
                    <th className={`${th} text-right`}>Outstanding</th>
                    <th className={`${th} text-right`}>Booked at</th>
                    <th className={`${th} text-right`}>In the books</th>
                    <th className={`${th} text-right`}>Today</th>
                    <th className={`${th} text-right`}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {exposure.map((l) => (
                    <tr key={l.documentId} className="border-t border-line-soft">
                      <td className={td}>{l.documentNo}</td>
                      <td className={td}>
                        {l.documentType === "GRN_INVOICE" ? "Payable" : "Receivable"}
                      </td>
                      <td className={td}>{l.partyName}</td>
                      <td className={`${td} text-right`}>
                        {l.currencyCode} {l.foreignAmount.toLocaleString("en-IN")}
                      </td>
                      <td className={`${td} text-right`}>{l.bookedRate}</td>
                      <td className={`${td} text-right`}>{money(l.bookedInr)}</td>
                      <td className={`${td} text-right`}>{money(l.restatedInr)}</td>
                      <td
                        className={`${td} text-right font-semibold ${
                          l.difference >= 0
                            ? "text-[color:var(--color-success)]"
                            : "text-[color:var(--color-danger)]"
                        }`}
                      >
                        {money(l.difference)}
                      </td>
                    </tr>
                  ))}
                  {exposure.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={7}>
                        Nothing is outstanding in a foreign currency.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "revaluations" && (
        <>
          <Card
            title={`Restatement for ${periodKey}`}
            actions={
              can("currencies.edit") &&
              !done && (
                <button
                  className={primary}
                  disabled={busy || !preview || preview.lines.length === 0}
                  onClick={() => act(() => fxService.revalue(periodKey), "Restated")}
                >
                  Post the restatement
                </button>
              )
            }
          >
            <div className="rounded-lg border border-accent bg-nav-active p-3 text-sm text-accent">
              An unrealised difference is an opinion about a rate, not a transaction. The entry
              posts on the last day of the period and{" "}
              <strong>reverses on the first day of the next one</strong>, so the month the money
              actually arrives counts the movement once.
            </div>
            {preview && (
              <p className="mt-3 text-sm text-ink">
                As at {preview.asOn}: {money(preview.netAmount)} across {preview.lines.length}{" "}
                document(s).
              </p>
            )}
            {done && (
              <p className="mt-1 text-xs text-ink-muted">
                Already posted — voucher {done.voucherId}, reversed by {done.reversalVoucherId}.
              </p>
            )}
          </Card>
          <Card title="Past restatements">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Period</th>
                    <th className={th}>As at</th>
                    <th className={`${th} text-right`}>Net</th>
                    <th className={th}>Status</th>
                    <th className={th}>Voucher</th>
                    <th className={th}>Reversal</th>
                  </tr>
                </thead>
                <tbody>
                  {revaluations.map((r) => (
                    <tr key={r.id} className="border-t border-line-soft">
                      <td className={td}>{r.periodKey}</td>
                      <td className={td}>{day(r.asOn)}</td>
                      <td className={`${td} text-right`}>{money(r.netAmount)}</td>
                      <td className={td}>
                        <span className={`sl-chip sl-chip-sm ${STATUS_STYLE[r.status]}`}>
                          {r.status.toLowerCase()}
                        </span>
                      </td>
                      <td className={td}>{r.voucherId ?? "—"}</td>
                      <td className={td}>{r.reversalVoucherId ?? "—"}</td>
                    </tr>
                  ))}
                  {revaluations.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={6}>
                        No period has been restated yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "imports" && (
        <Card title="Bills of entry">
          <p className="mb-3 text-xs text-ink-muted">
            The IGST is creditable and stays out of the cost of the goods; the basic duty, the
            surcharge and the clearing charges are not, and go into it. The landed cost column is
            what the stock actually cost.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Bill of entry</th>
                  <th className={th}>Date</th>
                  <th className={th}>Supplier</th>
                  <th className={`${th} text-right`}>Assessable</th>
                  <th className={`${th} text-right`}>Duty</th>
                  <th className={`${th} text-right`}>IGST (credit)</th>
                  <th className={`${th} text-right`}>Landed cost</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t border-line-soft">
                    <td className={td}>
                      {b.beNumber}
                      {b.portCode && <div className="text-xs text-ink-muted">{b.portCode}</div>}
                    </td>
                    <td className={td}>{day(b.beDate)}</td>
                    <td className={td}>{b.supplier?.legalName ?? "—"}</td>
                    <td className={`${td} text-right`}>{money(b.assessableValue)}</td>
                    <td className={`${td} text-right`}>
                      {money(Number(b.basicDuty) + Number(b.socialWelfareSurcharge))}
                    </td>
                    <td className={`${td} text-right`}>{money(b.igst)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(b.landedCost)}</td>
                  </tr>
                ))}
                {bills.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={7}>
                      No imports recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {adding && (
        <BillOfEntryDialog
          busy={busy}
          onCancel={() => setAdding(false)}
          onDone={(body) =>
            act(async () => {
              await fxService.createBillOfEntry(body);
              setAdding(false);
            }, "Recorded")
          }
        />
      )}
    </div>
  );
};

const BillOfEntryDialog: React.FC<{
  busy: boolean;
  onCancel: () => void;
  onDone: (body: {
    beNumber: string;
    beDate: string;
    portCode?: string | null;
    currencyCode?: string;
    exchangeRate: number;
    foreignValue: number;
    assessableValue?: number;
    basicDuty?: number;
    socialWelfareSurcharge?: number;
    igst?: number;
    otherCharges?: number;
  }) => void;
}> = ({ busy, onCancel, onDone }) => {
  const [beNumber, setBeNumber] = useState("");
  const [beDate, setBeDate] = useState(new Date().toISOString().slice(0, 10));
  const [portCode, setPortCode] = useState("");
  const [exchangeRate, setExchangeRate] = useState("83");
  const [foreignValue, setForeignValue] = useState("");
  const [assessableValue, setAssessableValue] = useState("");
  const [basicDuty, setBasicDuty] = useState("0");
  const [swc, setSwc] = useState("0");
  const [igst, setIgst] = useState("0");
  const [otherCharges, setOtherCharges] = useState("0");

  const assessable =
    Number(assessableValue || 0) || Number(foreignValue || 0) * Number(exchangeRate || 0);
  const landed = assessable + Number(basicDuty || 0) + Number(swc || 0) + Number(otherCharges || 0);

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-xl sl-tile p-4">
        <h2 className="text-lg font-semibold text-ink">Record a bill of entry</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The customs exchange rate is notified fortnightly and is not the day&apos;s market rate —
          use the one printed on the bill.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <label className="text-sm text-ink-muted">
            BE number
            <input
              className={`${field} mt-1 w-full`}
              value={beNumber}
              onChange={(e) => setBeNumber(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            BE date
            <input
              type="date"
              className={`${field} mt-1 w-full`}
              value={beDate}
              onChange={(e) => setBeDate(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Port code
            <input
              className={`${field} mt-1 w-full`}
              value={portCode}
              onChange={(e) => setPortCode(e.target.value)}
              placeholder="INMAA1"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Invoice value (foreign)
            <input
              className={`${field} mt-1 w-full`}
              value={foreignValue}
              onChange={(e) => setForeignValue(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Customs rate
            <input
              className={`${field} mt-1 w-full`}
              value={exchangeRate}
              onChange={(e) => setExchangeRate(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Assessable value
            <input
              className={`${field} mt-1 w-full`}
              value={assessableValue}
              onChange={(e) => setAssessableValue(e.target.value)}
              placeholder="As customs worked it out"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Basic duty
            <input
              className={`${field} mt-1 w-full`}
              value={basicDuty}
              onChange={(e) => setBasicDuty(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Surcharge
            <input
              className={`${field} mt-1 w-full`}
              value={swc}
              onChange={(e) => setSwc(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            IGST (creditable)
            <input
              className={`${field} mt-1 w-full`}
              value={igst}
              onChange={(e) => setIgst(e.target.value)}
            />
          </label>
          <label className="col-span-3 text-sm text-ink-muted">
            Freight, insurance and clearing
            <input
              className={`${field} mt-1 w-full`}
              value={otherCharges}
              onChange={(e) => setOtherCharges(e.target.value)}
            />
          </label>
        </div>
        <p className="mt-3 text-sm font-semibold text-ink">
          The goods cost {money(landed)} — the IGST of {money(Number(igst || 0))} is credit, not
          cost.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={primary}
            disabled={busy || !beNumber.trim() || !(Number(exchangeRate) > 0)}
            onClick={() =>
              onDone({
                beNumber: beNumber.trim(),
                beDate,
                portCode: portCode.trim() || null,
                currencyCode: "USD",
                exchangeRate: Number(exchangeRate),
                foreignValue: Number(foreignValue || 0),
                assessableValue: Number(assessableValue || 0) || undefined,
                basicDuty: Number(basicDuty || 0),
                socialWelfareSurcharge: Number(swc || 0),
                igst: Number(igst || 0),
                otherCharges: Number(otherCharges || 0),
              })
            }
          >
            Record
          </button>
        </div>
      </div>
    </div>
  );
};

export default ForexPage;
