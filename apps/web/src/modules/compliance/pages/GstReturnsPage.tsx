import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  gstReturnsService,
  type GstinScopeRow,
  type Gstr1Return,
  type Gstr2bSummary,
  type Gstr3bReturn,
  type Gstr9Return,
  type Gstr2bRecordRow,
  type ImsStatus,
  type TaxAmounts,
} from "../../../services/gstReturnsService";
import {
  money,
  monthOptions,
  fyOptions,
  TaxRow,
  Card,
  th,
  td,
  field,
  primary,
  secondary,
} from "../components/gstUi";
import Gstr2bWorkbench from "../components/Gstr2bWorkbench";
import ImsWorkbench from "../components/ImsWorkbench";

/**
 * The GST returns hub (P1-13d): one period, one GSTIN, and every return the month needs — what
 * was sold (GSTR-1), what is owed (GSTR-3B), what the suppliers filed (GSTR-2B), the decision on
 * each of those records (IMS), and the year added up (GSTR-9).
 *
 * They share a period and a registration because that is how the work is actually done: an
 * accountant closes a month across all of them rather than opening five screens.
 */
type Tab = "gstr1" | "gstr3b" | "gstr2b" | "ims" | "gstr9";
const TABS: { key: Tab; label: string }[] = [
  { key: "gstr1", label: "GSTR-1" },
  { key: "gstr3b", label: "GSTR-3B" },
  { key: "gstr2b", label: "GSTR-2B" },
  { key: "ims", label: "IMS" },
  { key: "gstr9", label: "GSTR-9" },
];
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const GstReturnsPage: React.FC = () => {
  const { can } = usePermission();
  const [params, setParams] = useSearchParams();
  const months = useMemo(() => monthOptions(18), []);
  const years = useMemo(() => fyOptions(4), []);

  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "gstr1");
  const [period, setPeriod] = useState(params.get("period") || months[1].value);
  const [fy, setFy] = useState(params.get("fy") || years[1].value);
  const [gstins, setGstins] = useState<GstinScopeRow[]>([]);
  const [gstin, setGstin] = useState(params.get("gstin") || "");

  const [gstr1, setGstr1] = useState<Gstr1Return | null>(null);
  const [gstr3b, setGstr3b] = useState<Gstr3bReturn | null>(null);
  const [two, setTwo] = useState<Gstr2bSummary | null>(null);
  const [ims, setIms] = useState<Gstr2bRecordRow[]>([]);
  const [nine, setNine] = useState<Gstr9Return | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    gstReturnsService
      .gstins()
      .then((rows) => {
        setGstins(rows);
        setGstin((g) => g || rows[0]?.gstin || "");
      })
      .catch((err) => toast.error(message(err)));
  }, []);

  useEffect(() => {
    const next = new URLSearchParams(params);
    next.set("tab", tab);
    next.set("period", period);
    if (gstin) next.set("gstin", gstin);
    setParams(next, { replace: true });
    // The URL is the state here so a period can be linked to from a notification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period, gstin, fy]);

  const load = useCallback(async () => {
    if (!gstin) return;
    setLoading(true);
    try {
      if (tab === "gstr1") setGstr1(await gstReturnsService.gstr1(period, gstin));
      if (tab === "gstr3b") setGstr3b(await gstReturnsService.gstr3b(period, gstin));
      if (tab === "gstr2b") setTwo(await gstReturnsService.gstr2bSummary(period, gstin));
      if (tab === "ims") setIms(await gstReturnsService.ims(period, gstin));
      if (tab === "gstr9") setNine(await gstReturnsService.gstr9(fy, gstin));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, period, fy, gstin]);
  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    setBusy(true);
    try {
      if (tab === "gstr1") setGstr1(await gstReturnsService.gstr1Register(period, gstin));
      if (tab === "gstr3b") setGstr3b(await gstReturnsService.gstr3bRegister(period, gstin));
      if (tab === "gstr9") setNine(await gstReturnsService.gstr9Register(fy, gstin));
      toast.success("Registered for approval");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (id: string, status: ImsStatus, reason?: string) => {
    await gstReturnsService.imsAct(id, status, reason ?? null);
    await load();
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">GST Returns</h1>
          <p className="text-sm text-ink-muted">
            Computed from the books. Nothing is filed until it is approved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={field}
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            aria-label="GSTIN"
          >
            {gstins.map((g) => (
              <option key={g.gstin} value={g.gstin}>
                {g.gstin} · {g.name}
              </option>
            ))}
          </select>
          {tab === "gstr9" ? (
            <select
              className={field}
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              aria-label="Financial year"
            >
              {years.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <select
              className={field}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Period"
            >
              {months.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <button className={secondary} onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          {can("gst-returns.prepare") && tab !== "gstr2b" && tab !== "ims" && (
            <button className={primary} onClick={() => void register()} disabled={busy || loading}>
              Register for approval
            </button>
          )}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {loading && <p className="text-sm text-ink-muted">Working it out…</p>}

      {tab === "gstr1" && gstr1 && <Gstr1View ret={gstr1} period={period} gstin={gstin} />}
      {tab === "gstr3b" && gstr3b && <Gstr3bView ret={gstr3b} />}
      {tab === "gstr2b" && two && (
        <Gstr2bWorkbench summary={two} period={period} gstin={gstin} onChange={load} />
      )}
      {tab === "ims" && (
        <ImsWorkbench rows={ims} period={period} gstin={gstin} onDecide={decide} onChange={load} />
      )}
      {tab === "gstr9" && nine && <Gstr9View ret={nine} />}
    </div>
  );
};

const Warnings: React.FC<{ warnings: string[] }> = ({ warnings }) =>
  warnings.length === 0 ? null : (
    <Card title="Worth a look before filing">
      <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </Card>
  );

const Gstr1View: React.FC<{ ret: Gstr1Return; period: string; gstin: string }> = ({
  ret,
  period,
  gstin,
}) => (
  <div className="space-y-4">
    <Card title={`GSTR-1 · ${ret.fp}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Invoices" value={String(ret.totals.invoices)} />
        <Stat label="Credit notes" value={String(ret.totals.creditNotes)} />
        <Stat label="Taxable" value={money(ret.totals.taxable)} />
        <Stat
          label="Tax"
          value={money(ret.totals.igst + ret.totals.cgst + ret.totals.sgst + ret.totals.cess)}
        />
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Table</th>
              <th className={`${th} text-right`}>Documents</th>
              <th className={`${th} text-right`}>Taxable</th>
              <th className={`${th} text-right`}>Tax</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(ret.totals.byTable).map(([name, t]) => (
              <tr key={name} className="border-t border-line-soft">
                <td className={`${td} uppercase`}>{name}</td>
                <td className={`${td} text-right`}>{t.count}</td>
                <td className={`${td} text-right`}>{money(t.taxable)}</td>
                <td className={`${td} text-right`}>{money(t.tax)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a
        className={`${secondary} mt-3 inline-block`}
        href={`/api${gstReturnsService.gstr1JsonUrl(period, gstin)}`}
        download
      >
        Download the portal JSON
      </a>
    </Card>
    <Warnings warnings={ret.warnings} />
  </div>
);

const Gstr3bView: React.FC<{ ret: Gstr3bReturn }> = ({ ret }) => (
  <div className="space-y-4">
    <Card title="3.1 Outward supplies and inward supplies liable to reverse charge">
      <TaxTable
        rows={[
          ["(a) Taxable supplies", ret.table31.a],
          ["(b) Zero-rated supplies", ret.table31.b],
          ["(c) Nil-rated and exempt", ret.table31.c],
          ["(d) Inward, reverse charge", ret.table31.d],
          ["(e) Non-GST outward", ret.table31.e],
        ]}
      />
    </Card>
    <Card title="4 Eligible ITC">
      <TaxTable
        rows={[
          ["(A)(3) Reverse charge", ret.table4.available.reverseCharge],
          ["(A)(5) All other ITC", ret.table4.available.other],
          ["(A) Total available", ret.table4.available.total],
          ["(B) Reversed", ret.table4.reversed.total],
          ["(C) Net available", ret.table4.net],
          ["(D)(2) Ineligible, s.17(5)", ret.table4.other.ineligible],
        ]}
      />
    </Card>
    <Card title="6.1 Payment of tax">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Head</th>
              <th className={th}>Nature</th>
              <th className={`${th} text-right`}>Payable</th>
              <th className={`${th} text-right`}>Paid by credit</th>
              <th className={`${th} text-right`}>In cash</th>
            </tr>
          </thead>
          <tbody>
            {[
              ...ret.table61.otherThanReverseCharge.map((r) => ({ ...r, nature: "Output tax" })),
              ...ret.table61.reverseCharge.map((r) => ({ ...r, nature: "Reverse charge" })),
            ]
              .filter((r) => r.payable > 0 || r.cash > 0)
              .map((r) => (
                <tr key={`${r.head}-${r.nature}`} className="border-t border-line-soft">
                  <td className={td}>{r.head}</td>
                  <td className={`${td} text-ink-muted`}>{r.nature}</td>
                  <td className={`${td} text-right`}>{money(r.payable)}</td>
                  <td className={`${td} text-right`}>
                    {money(
                      r.paidThroughItc.igst +
                        r.paidThroughItc.cgst +
                        r.paidThroughItc.sgst +
                        r.paidThroughItc.cess
                    )}
                  </td>
                  <td className={`${td} text-right font-semibold`}>{money(r.cash)}</td>
                </tr>
              ))}
            <tr className="border-t-2 border-line">
              <td className={`${td} font-semibold`} colSpan={4}>
                To pay by challan
              </td>
              <td className={`${td} text-right font-semibold`}>
                {money(ret.table61.cashPayable.total)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Reverse-charge tax is always paid in cash: credit may only pay output tax.
      </p>
    </Card>
    <Warnings warnings={ret.warnings} />
  </div>
);

const Gstr9View: React.FC<{ ret: Gstr9Return }> = ({ ret }) => (
  <div className="space-y-4">
    <Card title={`GSTR-9 working papers · ${ret.fyKey}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Turnover" value={money(Number(ret.table5.turnoverForTheYear ?? 0))} />
        <Stat label="Tax payable" value={money((ret.table4.total as TaxAmounts).taxable)} />
        <Stat label="ITC availed" value={money(sumTax(ret.table6.total as TaxAmounts))} />
        <Stat label="ITC reversed" value={money(sumTax(ret.table7.total as TaxAmounts))} />
      </div>
    </Card>
    <Card title="Month by month">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Month</th>
              <th className={`${th} text-right`}>Outward taxable</th>
              <th className={`${th} text-right`}>Net ITC</th>
              <th className={`${th} text-right`}>Cash paid</th>
            </tr>
          </thead>
          <tbody>
            {ret.monthly.map((m) => (
              <tr key={m.periodKey} className="border-t border-line-soft">
                <td className={td}>{m.periodKey}</td>
                <td className={`${td} text-right`}>{money(m.outputTax.taxable)}</td>
                <td className={`${td} text-right`}>{money(sumTax(m.netItc))}</td>
                <td className={`${td} text-right`}>{money(m.cashPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    <Card title="8 The books against what the suppliers filed">
      <TaxTable
        rows={[
          ["(A) As per GSTR-2B", ret.table8.asPer2b],
          ["(B) As per the books", ret.table8.asPerBooks],
          ["(D) Difference", ret.table8.difference],
        ]}
      />
    </Card>
    <Warnings warnings={ret.warnings} />
  </div>
);

const sumTax = (t: TaxAmounts) => t.igst + t.cgst + t.sgst + t.cess;

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-line-soft bg-card-2 p-3">
    <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
  </div>
);

const TaxTable: React.FC<{ rows: [string, TaxAmounts][] }> = ({ rows }) => (
  <div className="overflow-x-auto">
    <table className="min-w-full">
      <thead>
        <tr>
          <th className={th}>Row</th>
          <th className={`${th} text-right`}>Taxable</th>
          <th className={`${th} text-right`}>IGST</th>
          <th className={`${th} text-right`}>CGST</th>
          <th className={`${th} text-right`}>SGST</th>
          <th className={`${th} text-right`}>Cess</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, t]) => (
          <TaxRow key={label} label={label} amounts={t} />
        ))}
      </tbody>
    </table>
  </div>
);

export default GstReturnsPage;
