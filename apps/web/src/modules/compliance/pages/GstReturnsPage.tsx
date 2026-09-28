import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";
import { AlertTriangle, Download, FileText, Landmark, RefreshCw, Send } from "lucide-react";

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
import { jobWorkService, type Itc04Registered } from "../../../services/jobWorkService";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  Field,
  PageHeader,
  SectionLabel,
  SkeletonTile,
  StatTile,
  Tile,
} from "../../../components/ui/v2";
import Itc04Tables from "../components/Itc04Tables";
import {
  money,
  monthOptions,
  fyOptions,
  periodLabel,
  TaxRow,
  TableScroll,
  Card,
  th,
  td,
} from "../components/gstUi";
import Gstr2bWorkbench from "../components/Gstr2bWorkbench";
import ImsWorkbench from "../components/ImsWorkbench";

/** Half-years, newest first, as `2026-H1` / `2026-H2` — ITC-04's period key. */
const halfYearOptions = () => {
  const now = new Date();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i * 6, 1));
    const first = d.getUTCMonth() >= 3 && d.getUTCMonth() < 9;
    const year = d.getUTCMonth() < 3 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
    const key = `${year}-H${first ? 1 : 2}`;
    if (!out.some((o) => o.value === key)) {
      out.push({ value: key, label: first ? `Apr–Sep ${year}` : `Oct ${year} – Mar ${year + 1}` });
    }
  }
  return out;
};

/**
 * The GST returns hub (P1-13d): one period, one GSTIN, and every return the month needs — what
 * was sold (GSTR-1), what is owed (GSTR-3B), what the suppliers filed (GSTR-2B), the decision on
 * each of those records (IMS), and the year added up (GSTR-9).
 *
 * They share a period and a registration because that is how the work is actually done: an
 * accountant closes a month across all of them rather than opening five screens.
 */
type Tab = "gstr1" | "gstr3b" | "gstr2b" | "ims" | "gstr9" | "itc04";
const TABS: { key: Tab; label: string }[] = [
  { key: "gstr1", label: "GSTR-1" },
  { key: "gstr3b", label: "GSTR-3B" },
  { key: "gstr2b", label: "GSTR-2B" },
  { key: "ims", label: "IMS" },
  { key: "gstr9", label: "GSTR-9" },
  { key: "itc04", label: "ITC-04" },
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
  const halfYears = useMemo(() => halfYearOptions(), []);
  const [halfYear, setHalfYear] = useState(params.get("halfYear") || halfYears[0].value);
  const [itc04, setItc04] = useState<Itc04Registered | null>(null);
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
    next.set("halfYear", halfYear);
    if (gstin) next.set("gstin", gstin);
    setParams(next, { replace: true });
    // The URL is the state here so a period can be linked to from a notification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period, gstin, fy, halfYear]);

  // ITC-04 is filed per registration, keyed the same way as GSTR-1's GSTIN selector: the
  // business place behind the currently chosen GSTIN, null for the company's own.
  const itc04BusinessPlaceId = gstins.find((g) => g.gstin === gstin)?.businessPlaceId ?? null;

  const load = useCallback(async () => {
    if (tab === "itc04") {
      setLoading(true);
      try {
        setItc04(await jobWorkService.itc04(halfYear, itc04BusinessPlaceId));
      } catch (err) {
        toast.error(message(err));
      } finally {
        setLoading(false);
      }
      return;
    }
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
  }, [tab, period, fy, gstin, halfYear, itc04BusinessPlaceId]);
  useEffect(() => {
    void load();
  }, [load]);

  const register = async () => {
    setBusy(true);
    try {
      if (tab === "gstr1") setGstr1(await gstReturnsService.gstr1Register(period, gstin));
      if (tab === "gstr3b") setGstr3b(await gstReturnsService.gstr3bRegister(period, gstin));
      if (tab === "gstr9") setNine(await gstReturnsService.gstr9Register(fy, gstin));
      if (tab === "itc04")
        setItc04(await jobWorkService.registerItc04(halfYear, itc04BusinessPlaceId));
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

  const tabLabel = TABS.find((t) => t.key === tab)?.label ?? "";
  const canRegister =
    tab === "itc04"
      ? can("job-work.manage")
      : can("gst-returns.prepare") && tab !== "gstr2b" && tab !== "ims";
  const hasData = Boolean(
    (tab === "gstr1" && gstr1) ||
    (tab === "gstr3b" && gstr3b) ||
    (tab === "gstr2b" && two) ||
    tab === "ims" ||
    (tab === "gstr9" && nine) ||
    (tab === "itc04" && itc04)
  );
  const periodText =
    tab === "gstr9"
      ? years.find((y) => y.value === fy)?.label
      : tab === "itc04"
        ? halfYears.find((h) => h.value === halfYear)?.label
        : months.find((m) => m.value === period)?.label;

  return (
    <div className="sl-page">
      <PageHeader
        title="GST Returns"
        icon={<Landmark size={22} />}
        subtitle="Computed from the books. Nothing is filed until it is approved."
        meta={periodText ? <Chip size="sm">{periodText}</Chip> : undefined}
        actions={
          <ActionPill
            variant="secondary"
            icon={<RefreshCw size={16} />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </ActionPill>
        }
        primaryAction={
          canRegister ? (
            <ActionPill
              size="lg"
              icon={<Send size={18} />}
              onClick={() => void register()}
              disabled={busy || loading}
              loading={busy}
            >
              Register {tabLabel} for approval
            </ActionPill>
          ) : undefined
        }
      />

      <Tile padding="sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="sl-section-label m-0 mb-1.5">Return</p>
            <ChipTabs<Tab>
              ariaLabel="Return"
              value={tab}
              onChange={setTab}
              size="lg"
              items={TABS.map((t) => ({ key: t.key, label: t.label }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:items-end">
            <Field label="GSTIN" className="lg:w-80">
              <select
                className="sl-input h-11 py-0 text-sm"
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
              >
                {gstins.map((g) => (
                  <option key={g.gstin} value={g.gstin}>
                    {g.gstin} · {g.name}
                  </option>
                ))}
              </select>
            </Field>
            {tab === "gstr9" ? (
              <Field label="Financial year" className="lg:w-44">
                <select
                  className="sl-input h-11 py-0 text-sm"
                  value={fy}
                  onChange={(e) => setFy(e.target.value)}
                >
                  {years.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : tab === "itc04" ? (
              <Field label="Half year" className="lg:w-56">
                <select
                  className="sl-input h-11 py-0 text-sm"
                  value={halfYear}
                  onChange={(e) => setHalfYear(e.target.value)}
                >
                  {halfYears.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Period" className="lg:w-48">
                <select
                  className="sl-input h-11 py-0 text-sm"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  {months.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </div>
      </Tile>

      {loading && !hasData && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <StatTile key={i} label={" "} value="" loading />
            ))}
          </div>
          <SkeletonTile lines={5} label="Working it out…" />
        </div>
      )}
      {loading && hasData && (
        <p className="sl-muted m-0 text-sm" role="status">
          Working it out…
        </p>
      )}

      <div className={loading && hasData ? "opacity-60 transition-opacity" : undefined}>
        {tab === "gstr1" && gstr1 && <Gstr1View ret={gstr1} period={period} gstin={gstin} />}
        {tab === "gstr3b" && gstr3b && <Gstr3bView ret={gstr3b} />}
        {tab === "gstr2b" && two && (
          <Gstr2bWorkbench summary={two} period={period} gstin={gstin} onChange={load} />
        )}
        {tab === "ims" && (
          <ImsWorkbench
            rows={ims}
            period={period}
            gstin={gstin}
            onDecide={decide}
            onChange={load}
          />
        )}
        {tab === "gstr9" && nine && <Gstr9View ret={nine} />}
        {tab === "itc04" && itc04 && (
          <Itc04Tables
            itc={itc04}
            canManage={can("job-work.manage")}
            busy={busy}
            onRegister={register}
            onFilingChange={(f) => setItc04({ ...itc04, filing: f })}
          />
        )}
      </div>
    </div>
  );
};

const Warnings: React.FC<{ warnings: string[] }> = ({ warnings }) =>
  warnings.length === 0 ? null : (
    <Tile
      title="Worth a look before filing"
      icon={<AlertTriangle size={18} />}
      actions={
        <Chip tone="warning" size="sm">
          {warnings.length} to check
        </Chip>
      }
    >
      <ul className="m-0 space-y-2 pl-0">
        {warnings.map((w) => (
          <li
            key={w}
            className="flex list-none gap-2 rounded-[12px] bg-[color:color-mix(in_srgb,var(--color-warning)_10%,var(--color-card))] px-3 py-2 text-sm text-ink"
          >
            <AlertTriangle
              size={15}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
            />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </Tile>
  );

const Gstr1View: React.FC<{ ret: Gstr1Return; period: string; gstin: string }> = ({
  ret,
  period,
  gstin,
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Invoices" value={String(ret.totals.invoices)} />
      <StatTile label="Credit notes" value={String(ret.totals.creditNotes)} />
      <StatTile label="Taxable value" value={money(ret.totals.taxable)} />
      <StatTile
        label="Tax"
        value={money(ret.totals.igst + ret.totals.cgst + ret.totals.sgst + ret.totals.cess)}
      />
    </div>
    <Card
      title={`GSTR-1 · ${periodLabel(ret.fp)}`}
      subtitle="Documents by table, as the portal groups them."
      actions={
        <a
          className="sl-btn sl-pill-sm"
          href={`/api${gstReturnsService.gstr1JsonUrl(period, gstin)}`}
          download
        >
          <Download size={15} aria-hidden="true" />
          Download the portal JSON
        </a>
      }
    >
      {Object.keys(ret.totals.byTable).length === 0 ? (
        <EmptyState
          compact
          icon={<FileText size={22} />}
          title="No documents in this period"
          description="Sales invoices and notes posted in the month show up here."
        />
      ) : (
        <TableScroll>
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
                  <td className={`${td} font-semibold uppercase`}>{name}</td>
                  <td className={`${td} text-right`}>{t.count}</td>
                  <td className={`${td} text-right`}>{money(t.taxable)}</td>
                  <td className={`${td} text-right`}>{money(t.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Card>
    <Warnings warnings={ret.warnings} />
  </div>
);

const Gstr3bView: React.FC<{ ret: Gstr3bReturn }> = ({ ret }) => {
  const cash = ret.table61.cashPayable.total;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Output tax"
          value={money(sumTax(ret.table31.a))}
          hint="3.1(a) taxable supplies"
        />
        <StatTile
          label="Net ITC available"
          value={money(sumTax(ret.table4.net))}
          hint="Table 4(C)"
        />
        <StatTile
          label="To pay by challan"
          value={money(cash)}
          hint="Cash, after credit is used"
          delta={cash > 0 ? "Payable" : "Nil"}
          deltaTone={cash > 0 ? "warning" : "success"}
        />
      </div>
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
      <Card
        title="6.1 Payment of tax"
        subtitle="Reverse-charge tax is always paid in cash: credit may only pay output tax."
      >
        <TableScroll>
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
                    <td className={`${td} font-semibold`}>{r.head}</td>
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
              <tr className="border-t-2 border-line bg-card-2">
                <td className={`${td} font-bold`} colSpan={4}>
                  To pay by challan
                </td>
                <td className={`${td} text-right text-base font-bold`}>{money(cash)}</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>
      </Card>
      <Warnings warnings={ret.warnings} />
    </div>
  );
};

const Gstr9View: React.FC<{ ret: Gstr9Return }> = ({ ret }) => (
  <div className="space-y-4">
    <SectionLabel>GSTR-9 working papers · FY {ret.fyKey}</SectionLabel>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Turnover" value={money(Number(ret.table5.turnoverForTheYear ?? 0))} />
      <StatTile label="Tax payable" value={money((ret.table4.total as TaxAmounts).taxable)} />
      <StatTile label="ITC availed" value={money(sumTax(ret.table6.total as TaxAmounts))} />
      <StatTile label="ITC reversed" value={money(sumTax(ret.table7.total as TaxAmounts))} />
    </div>
    <Card title="Month by month">
      <TableScroll>
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
                <td className={`${td} font-semibold`}>{periodLabel(m.periodKey)}</td>
                <td className={`${td} text-right`}>{money(m.outputTax.taxable)}</td>
                <td className={`${td} text-right`}>{money(sumTax(m.netItc))}</td>
                <td className={`${td} text-right`}>{money(m.cashPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
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

const TaxTable: React.FC<{ rows: [string, TaxAmounts][] }> = ({ rows }) => (
  <TableScroll>
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
  </TableScroll>
);

export default GstReturnsPage;
