import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { AlertTriangle, Download, Percent, Receipt, Send } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  tdsService,
  type Quarter,
  type TdsChallanRow,
  type TdsDeductionRow,
  type TdsReturnView,
  type TdsSectionRow,
} from "../../../services/tdsService";
import {
  Card,
  TableScroll,
  day,
  field,
  fyOptions,
  message,
  money,
  primary,
  secondary,
  td,
  th,
} from "../components/gstUi";
import {
  ActionPill,
  Chip,
  ChipTabs,
  Field,
  PageHeader,
  SkeletonRows,
  Tile,
  type ChipTone,
} from "../../../components/ui/v2";

/**
 * TDS and TCS (P1-15).
 *
 * The quarter is the unit of work, so it sits in the header and every tab reads it: what was
 * deducted, what has been paid to the government against it, and what the quarterly return
 * therefore looks like. A deduction that never reached a challan is the thing that sinks a
 * return, so it is called out on both the deductions tab and the return.
 */
type Tab = "deductions" | "challans" | "returns" | "sections";
const QUARTERS: { value: Quarter; label: string }[] = [
  { value: "Q1", label: "Q1 · Apr–Jun" },
  { value: "Q2", label: "Q2 · Jul–Sep" },
  { value: "Q3", label: "Q3 · Oct–Dec" },
  { value: "Q4", label: "Q4 · Jan–Mar" },
];
const STATUS_TONE: Record<TdsDeductionRow["status"], ChipTone> = {
  PENDING: "warning",
  CHALLAN_PAID: "info",
  RETURN_FILED: "success",
  CANCELLED: "muted",
};
const STATUS_LABEL: Record<TdsDeductionRow["status"], string> = {
  PENDING: "Challan due",
  CHALLAN_PAID: "Challan paid",
  RETURN_FILED: "Return filed",
  CANCELLED: "Cancelled",
};
const TABS: { key: Tab; label: string }[] = [
  { key: "deductions", label: "Deductions" },
  { key: "challans", label: "Challans" },
  { key: "returns", label: "Quarterly return" },
  { key: "sections", label: "Sections and rates" },
];
/** The quarter a date falls in, the Indian way: April starts the year. */
const currentQuarter = (): Quarter => {
  const m = new Date().getUTCMonth();
  return `Q${Math.floor(((m - 3 + 12) % 12) / 3) + 1}` as Quarter;
};

const TdsPage: React.FC = () => {
  const { can } = usePermission();
  const years = useMemo(() => fyOptions(3), []);
  const [tab, setTab] = useState<Tab>("deductions");
  const [fyCode, setFyCode] = useState(years[0].value);
  const [quarter, setQuarter] = useState<Quarter>(currentQuarter());
  const [form, setForm] = useState<"26Q" | "27Q">("26Q");
  const [deductions, setDeductions] = useState<TdsDeductionRow[]>([]);
  const [challans, setChallans] = useState<TdsChallanRow[]>([]);
  const [sections, setSections] = useState<TdsSectionRow[]>([]);
  const [ret, setRet] = useState<TdsReturnView | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = useState<Partial<TdsSectionRow>>({});
  const [paying, setPaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "deductions") setDeductions(await tdsService.deductions({ fyCode, quarter }));
      if (tab === "challans") setChallans(await tdsService.challans({ fyCode, quarter }));
      if (tab === "sections") setSections(await tdsService.sections(true));
      if (tab === "returns") setRet(await tdsService.return(form, fyCode, quarter));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, fyCode, quarter, form]);
  useEffect(() => {
    void load();
  }, [load]);
  // A selection belongs to the quarter it was made in; changing the quarter must not carry it.
  useEffect(() => setPicked([]), [fyCode, quarter]);

  const unchallaned = deductions.filter((d) => !d.challanId && d.status !== "CANCELLED");
  const pickedRows = deductions.filter((d) => picked.includes(d.id));
  const pickedTotal = pickedRows.reduce((s, d) => s + Number(d.tdsAmount), 0);

  const sendForApproval = async () => {
    setBusy(true);
    try {
      await tdsService.registerReturn(form, fyCode, quarter);
      toast.success("Sent for approval");
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const primaryAction =
    tab === "deductions" && can("tds.pay") ? (
      <ActionPill
        size="lg"
        icon={<Receipt size={18} />}
        disabled={picked.length === 0}
        onClick={() => setPaying(true)}
        title={picked.length === 0 ? "Tick the deductions this challan pays" : undefined}
      >
        Pay challan{picked.length > 0 ? ` · ${money(pickedTotal)}` : ""}
      </ActionPill>
    ) : tab === "returns" && ret && can("tds.prepare") ? (
      <ActionPill
        size="lg"
        icon={<Send size={18} />}
        loading={busy}
        disabled={busy}
        onClick={() => void sendForApproval()}
      >
        Send for approval
      </ActionPill>
    ) : undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="TDS and TCS"
        icon={<Percent size={22} />}
        subtitle="Tax held back from what you pay, and collected on what you sell. It has to reach the government by the 7th of the next month and be reported every quarter."
        meta={
          tab === "deductions" && !loading ? (
            unchallaned.length > 0 ? (
              <Chip tone="warning" dot>
                {unchallaned.length} challan{unchallaned.length === 1 ? "" : "s"} due
              </Chip>
            ) : deductions.length > 0 ? (
              <Chip tone="success" dot>
                All paid
              </Chip>
            ) : undefined
          ) : undefined
        }
        primaryAction={primaryAction}
      />

      <Tile padding="sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <ChipTabs<Tab>
            ariaLabel="TDS area"
            value={tab}
            onChange={setTab}
            size="lg"
            items={TABS.map((t) => ({
              key: t.key,
              label: t.label,
              count:
                t.key === "deductions" && unchallaned.length > 0 ? unchallaned.length : undefined,
            }))}
          />
          <div className="grid grid-cols-2 gap-3 lg:flex lg:items-end">
            <Field label="Financial year" className="lg:w-40">
              <select
                className="sl-input h-11 py-0 text-sm"
                value={fyCode}
                onChange={(e) => setFyCode(e.target.value)}
              >
                {years.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quarter" className="lg:w-44">
              <select
                className="sl-input h-11 py-0 text-sm"
                value={quarter}
                onChange={(e) => setQuarter(e.target.value as Quarter)}
              >
                {QUARTERS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            {tab === "returns" && (
              <Field label="Form" className="col-span-2 lg:w-52">
                <select
                  className="sl-input h-11 py-0 text-sm"
                  value={form}
                  onChange={(e) => setForm(e.target.value as "26Q" | "27Q")}
                >
                  <option value="26Q">26Q · residents</option>
                  <option value="27Q">27Q · non-residents</option>
                </select>
              </Field>
            )}
          </div>
        </div>
      </Tile>

      {loading && (
        <Tile padding="none" className="overflow-hidden">
          <SkeletonRows rows={6} columns={6} label="Loading…" />
        </Tile>
      )}

      {tab === "deductions" && (
        <>
          {unchallaned.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-[16px] bg-[color:color-mix(in_srgb,var(--color-warning)_12%,var(--color-card))] p-4 text-sm text-ink"
            >
              <AlertTriangle
                size={18}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
              />
              <span>
                <strong>
                  {unchallaned.length} deduction{unchallaned.length === 1 ? "" : "s"} not yet paid
                  to the government.
                </strong>{" "}
                The return cannot be filed while any of them is outstanding. Tick them below and pay
                the challan.
              </span>
            </div>
          )}
          <Card
            title="Deductions"
            actions={
              picked.length > 0 ? (
                <Chip tone="info" size="sm">
                  {picked.length} selected · {money(pickedTotal)}
                </Chip>
              ) : undefined
            }
          >
            <TableScroll>
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th} />
                    <th className={th}>Date</th>
                    <th className={th}>Document</th>
                    <th className={th}>Deductee</th>
                    <th className={th}>Section</th>
                    <th className={`${th} text-right`}>Paid</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Tax</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {deductions.map((d) => (
                    <tr key={d.id} className="border-t border-line-soft">
                      <td className={td}>
                        <input
                          type="checkbox"
                          className="sl-check"
                          aria-label={`Select ${d.docNo}`}
                          disabled={!!d.challanId || d.status === "CANCELLED"}
                          checked={picked.includes(d.id)}
                          onChange={(e) =>
                            setPicked((p) =>
                              e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id)
                            )
                          }
                        />
                      </td>
                      <td className={td}>{day(d.deductionDate)}</td>
                      <td className={td}>{d.docNo}</td>
                      <td className={td}>
                        {d.deducteeName}
                        <div className="text-xs text-ink-muted">
                          {d.deducteePan ?? "No PAN on record"}
                        </div>
                      </td>
                      <td className={td}>
                        {d.section.code}
                        {d.section.isTcs && (
                          <Chip size="sm" className="ml-1">
                            TCS
                          </Chip>
                        )}
                      </td>
                      <td className={`${td} text-right`}>{money(d.amountPaid)}</td>
                      <td className={`${td} text-right`}>
                        {Number(d.rate)}%
                        {d.rateReason && (
                          <div className="text-xs text-ink-muted">{d.rateReason}</div>
                        )}
                      </td>
                      <td className={`${td} text-right font-semibold`}>{money(d.tdsAmount)}</td>
                      <td className={td}>
                        <Chip tone={STATUS_TONE[d.status]} size="sm" dot>
                          {STATUS_LABEL[d.status]}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                  {deductions.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={9}>
                        Nothing was deducted this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      )}

      {tab === "challans" && (
        <Card title="Challans paid">
          <TableScroll>
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Paid on</th>
                  <th className={th}>BSR code</th>
                  <th className={th}>Serial</th>
                  <th className={th}>For</th>
                  <th className={`${th} text-right`}>Tax</th>
                  <th className={`${th} text-right`}>Interest</th>
                  <th className={`${th} text-right`}>Late fee</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Deductees</th>
                </tr>
              </thead>
              <tbody>
                {challans.map((c) => (
                  <tr key={c.id} className="border-t border-line-soft">
                    <td className={td}>{day(c.challanDate)}</td>
                    <td className={td}>{c.bsrCode}</td>
                    <td className={td}>{c.challanSerial}</td>
                    <td className={td}>
                      {c.periodKey}
                      {c.isTcs && (
                        <Chip size="sm" className="ml-1">
                          TCS
                        </Chip>
                      )}
                    </td>
                    <td className={`${td} text-right`}>{money(c.tdsAmount)}</td>
                    <td className={`${td} text-right`}>{money(c.interest)}</td>
                    <td className={`${td} text-right`}>{money(c.lateFee)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(c.totalAmount)}</td>
                    <td className={`${td} text-right`}>{c.deductions.length}</td>
                  </tr>
                ))}
                {challans.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={9}>
                      Nothing has been paid for this quarter yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {tab === "returns" && ret && (
        <>
          {ret.warnings.length > 0 && (
            <div
              role="status"
              className="rounded-[16px] bg-[color:color-mix(in_srgb,var(--color-danger)_8%,var(--color-card))] p-4 text-sm text-ink"
            >
              <p className="m-0 mb-1 flex items-center gap-2 font-semibold">
                <AlertTriangle
                  size={16}
                  aria-hidden="true"
                  className="text-[color:var(--color-danger)]"
                />
                Fix before filing
              </p>
              <ul className="m-0 list-inside list-disc space-y-0.5">
                {ret.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <Card
            title={`Form ${ret.formType} · FY ${ret.fyCode} ${ret.quarter}`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {ret.filing && (
                  <Chip size="sm" dot>
                    Filing {ret.filing.status.toLowerCase()}
                  </Chip>
                )}
                <a
                  className={secondary}
                  href={`/api${tdsService.fileUrl(form, fyCode, quarter)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={15} aria-hidden="true" />
                  Download e-TDS file
                </a>
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Deductees" value={String(ret.totals.deductees)} />
              <Stat label="Amount paid" value={money(ret.totals.amountPaid)} />
              <Stat label="Tax deducted" value={money(ret.totals.tdsDeducted)} />
              <Stat label="Challans total" value={money(ret.totals.challanTotal)} />
            </div>
            <p className="m-0 mt-4 text-xs text-ink-muted">
              Deductor {ret.deductor.name} · TAN {ret.deductor.tan ?? "not set"} · PAN{" "}
              {ret.deductor.pan ?? "not set"}
            </p>
          </Card>
          <Card title="Deductee rows">
            <TableScroll>
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Deductee</th>
                    <th className={th}>PAN</th>
                    <th className={th}>Section</th>
                    <th className={th}>Document</th>
                    <th className={th}>Date</th>
                    <th className={`${th} text-right`}>Paid</th>
                    <th className={`${th} text-right`}>Rate</th>
                    <th className={`${th} text-right`}>Tax</th>
                    <th className={th}>Challan</th>
                  </tr>
                </thead>
                <tbody>
                  {ret.lines.map((l, i) => (
                    <tr key={`${l.docNo}-${i}`} className="border-t border-line-soft">
                      <td className={td}>{l.deducteeName}</td>
                      <td className={td}>{l.deducteePan ?? "—"}</td>
                      <td className={td}>{l.section}</td>
                      <td className={td}>{l.docNo}</td>
                      <td className={td}>{day(l.deductionDate)}</td>
                      <td className={`${td} text-right`}>{money(l.amountPaid)}</td>
                      <td className={`${td} text-right`}>{Number(l.rate)}%</td>
                      <td className={`${td} text-right`}>{money(l.tdsAmount)}</td>
                      <td className={td}>
                        {l.challan ? (
                          `${l.challan.bsrCode}/${l.challan.serial}`
                        ) : (
                          <Chip tone="danger" size="sm">
                            Not paid
                          </Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                  {ret.lines.length === 0 && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={9}>
                        Nothing to report in this form for the quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      )}

      {tab === "sections" && (
        <Card
          title="Sections and rates"
          subtitle="Rates move with every Finance Act, so these belong to your company and can be edited. The familiar number is what the return carries; the Act reference says where it now sits."
        >
          <TableScroll>
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Section</th>
                  <th className={th}>Name</th>
                  <th className={th}>Ledger (P2-26)</th>
                  <th className={`${th} text-right`}>Company</th>
                  <th className={`${th} text-right`}>Individual / HUF</th>
                  <th className={`${th} text-right`}>No PAN</th>
                  <th className={`${th} text-right`}>Single</th>
                  <th className={`${th} text-right`}>Annual</th>
                  <th className={th}>Active</th>
                  {can("tds.manage") && <th className={th} />}
                </tr>
              </thead>
              <tbody>
                {sections.map((s) => {
                  const editing = editingSectionId === s.id;
                  const num = (v: unknown) =>
                    v === "" || v === undefined ? 0 : Number(v as string);
                  return (
                    <tr key={s.id} className="border-t border-line-soft">
                      <td className={td}>
                        {s.code}
                        {s.isTcs && (
                          <Chip size="sm" className="ml-1">
                            TCS
                          </Chip>
                        )}
                        <div className="text-xs text-ink-muted">{s.actCode ?? "—"}</div>
                      </td>
                      <td className={td}>{s.name}</td>
                      {editing ? (
                        <>
                          <td className={td}>
                            <input
                              className={`${field} w-32`}
                              type="text"
                              value={sectionDraft.ledgerCode ?? s.ledgerCode ?? ""}
                              placeholder="e.g. TDS-LIA-001"
                              onChange={(e) =>
                                setSectionDraft((d) => ({ ...d, ledgerCode: e.target.value }))
                              }
                            />
                            {!(sectionDraft.ledgerCode ?? s.ledgerCode) && (
                              <div className="mt-0.5 text-xs text-[color:var(--color-danger)]">
                                Required
                              </div>
                            )}
                          </td>
                          <td className={`${td} text-right`}>
                            <input
                              className={`${field} w-20 text-right`}
                              type="number"
                              value={sectionDraft.rateCompany ?? s.rateCompany}
                              onChange={(e) =>
                                setSectionDraft((d) => ({ ...d, rateCompany: num(e.target.value) }))
                              }
                            />
                          </td>
                          <td className={`${td} text-right`}>
                            <input
                              className={`${field} w-20 text-right`}
                              type="number"
                              value={sectionDraft.rateIndividual ?? s.rateIndividual}
                              onChange={(e) =>
                                setSectionDraft((d) => ({
                                  ...d,
                                  rateIndividual: num(e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className={`${td} text-right`}>
                            <input
                              className={`${field} w-20 text-right`}
                              type="number"
                              value={sectionDraft.rateNoPan ?? s.rateNoPan}
                              onChange={(e) =>
                                setSectionDraft((d) => ({ ...d, rateNoPan: num(e.target.value) }))
                              }
                            />
                          </td>
                          <td className={`${td} text-right`}>
                            <input
                              className={`${field} w-24 text-right`}
                              type="number"
                              value={sectionDraft.thresholdSingle ?? s.thresholdSingle}
                              onChange={(e) =>
                                setSectionDraft((d) => ({
                                  ...d,
                                  thresholdSingle: num(e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className={`${td} text-right`}>
                            <input
                              className={`${field} w-24 text-right`}
                              type="number"
                              value={sectionDraft.thresholdAnnual ?? s.thresholdAnnual}
                              onChange={(e) =>
                                setSectionDraft((d) => ({
                                  ...d,
                                  thresholdAnnual: num(e.target.value),
                                }))
                              }
                            />
                          </td>
                          <td className={td}>
                            <input
                              type="checkbox"
                              checked={sectionDraft.isActive ?? s.isActive}
                              onChange={(e) =>
                                setSectionDraft((d) => ({ ...d, isActive: e.target.checked }))
                              }
                            />
                          </td>
                          <td className={td}>
                            <button
                              type="button"
                              className={`${primary} mr-2`}
                              disabled={busy}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  await tdsService.saveSection({
                                    id: s.id,
                                    code: s.code,
                                    actCode: s.actCode,
                                    name: s.name,
                                    isTcs: s.isTcs,
                                    ledgerCode: sectionDraft.ledgerCode ?? s.ledgerCode,
                                    rateCompany: sectionDraft.rateCompany ?? s.rateCompany,
                                    rateIndividual: sectionDraft.rateIndividual ?? s.rateIndividual,
                                    rateNoPan: sectionDraft.rateNoPan ?? s.rateNoPan,
                                    thresholdSingle:
                                      sectionDraft.thresholdSingle ?? s.thresholdSingle,
                                    thresholdAnnual:
                                      sectionDraft.thresholdAnnual ?? s.thresholdAnnual,
                                    isActive: sectionDraft.isActive ?? s.isActive,
                                  });
                                  toast.success("Section saved");
                                  setEditingSectionId(null);
                                  setSectionDraft({});
                                  await load();
                                } catch (err) {
                                  toast.error(message(err));
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className={secondary}
                              onClick={() => {
                                setEditingSectionId(null);
                                setSectionDraft({});
                              }}
                            >
                              Cancel
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={td}>
                            {s.ledgerCode ? (
                              s.ledgerCode
                            ) : (
                              <Chip tone="danger" size="sm">
                                Missing
                              </Chip>
                            )}
                          </td>
                          <td className={`${td} text-right`}>{Number(s.rateCompany)}%</td>
                          <td className={`${td} text-right`}>{Number(s.rateIndividual)}%</td>
                          <td className={`${td} text-right`}>{Number(s.rateNoPan)}%</td>
                          <td className={`${td} text-right`}>
                            {Number(s.thresholdSingle) > 0 ? money(s.thresholdSingle) : "—"}
                          </td>
                          <td className={`${td} text-right`}>
                            {Number(s.thresholdAnnual) > 0 ? money(s.thresholdAnnual) : "—"}
                          </td>
                          <td className={td}>
                            <Chip tone={s.isActive ? "success" : "muted"} size="sm">
                              {s.isActive ? "Active" : "Off"}
                            </Chip>
                          </td>
                          {can("tds.manage") && (
                            <td className={td}>
                              <button
                                type="button"
                                className={secondary}
                                onClick={() => {
                                  setEditingSectionId(s.id);
                                  setSectionDraft({});
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          )}
                        </>
                      )}
                    </tr>
                  );
                })}
                {sections.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={9}>
                      No sections yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {paying && (
        <ChallanDialog
          rows={pickedRows}
          busy={busy}
          onCancel={() => setPaying(false)}
          onDone={async (body) => {
            setBusy(true);
            try {
              await tdsService.payChallan({ ...body, deductionIds: picked });
              toast.success("Challan recorded");
              setPaying(false);
              setPicked([]);
              await load();
            } catch (err) {
              toast.error(message(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-[14px] bg-card-2 p-3 sm:p-4">
    <p className="m-0 text-[13px] font-medium text-ink-muted">{label}</p>
    <p className="m-0 mt-1 text-xl font-bold tabular-nums text-ink">{value}</p>
  </div>
);

/**
 * What the bank stamped on the ITNS 281 counterfoil. The BSR code and serial are how the
 * department matches the money to the return, so they are typed from the receipt rather than
 * guessed.
 */
const ChallanDialog: React.FC<{
  rows: TdsDeductionRow[];
  busy: boolean;
  onCancel: () => void;
  onDone: (body: {
    bsrCode: string;
    challanSerial: string;
    challanDate: string;
    periodKey: string;
    interest?: number;
    lateFee?: number;
  }) => void;
}> = ({ rows, busy, onCancel, onDone }) => {
  const monthOf = (iso: string) => iso.slice(0, 7);
  const [bsrCode, setBsrCode] = useState("");
  const [challanSerial, setChallanSerial] = useState("");
  const [challanDate, setChallanDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodKey, setPeriodKey] = useState(
    rows.length > 0 ? monthOf(rows[0].deductionDate) : new Date().toISOString().slice(0, 7)
  );
  const [interest, setInterest] = useState("0");
  const [lateFee, setLateFee] = useState("0");
  const total = rows.reduce((s, r) => s + Number(r.tdsAmount), 0);
  // One challan covers one month; the server refuses a mixed one, so say so before the round trip.
  const months = [...new Set(rows.map((r) => monthOf(r.deductionDate)))];

  return (
    <div className="sl-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tds-challan-title"
        className="sl-dialog w-full max-w-lg p-5 sm:p-6"
      >
        <h2 id="tds-challan-title" className="sl-h2 m-0">
          Record a challan
        </h2>
        <p className="m-0 mt-1 text-sm text-ink-muted">
          {rows.length} deduction{rows.length === 1 ? "" : "s"} totalling {money(total)}.
        </p>
        {months.length > 1 && (
          <p className="m-0 mt-3 rounded-[12px] bg-[color:color-mix(in_srgb,var(--color-danger)_10%,var(--color-card))] p-3 text-sm text-ink">
            These deductions fall in {months.join(", ")}. One challan covers one month — pay them
            separately.
          </p>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="sl-label">BSR code</span>
            <input
              className="sl-input h-11 py-0 text-sm"
              value={bsrCode}
              maxLength={7}
              onChange={(e) => setBsrCode(e.target.value.replace(/\D/g, ""))}
              placeholder="7 digits"
            />
          </label>
          <label className="block">
            <span className="sl-label">Challan serial</span>
            <input
              className="sl-input h-11 py-0 text-sm"
              value={challanSerial}
              maxLength={10}
              onChange={(e) => setChallanSerial(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="sl-label">Paid on</span>
            <input
              type="date"
              className="sl-input h-11 py-0 text-sm"
              value={challanDate}
              onChange={(e) => setChallanDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="sl-label">For the month</span>
            <input
              type="month"
              className="sl-input h-11 py-0 text-sm"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="sl-label">Interest</span>
            <input
              className="sl-input h-11 py-0 text-sm"
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="sl-label">Late fee</span>
            <input
              className="sl-input h-11 py-0 text-sm"
              value={lateFee}
              onChange={(e) => setLateFee(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="sl-btn sl-pill-md" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="sl-cta sl-pill-md"
            disabled={busy || bsrCode.length !== 7 || !challanSerial || months.length > 1}
            onClick={() =>
              onDone({
                bsrCode,
                challanSerial,
                challanDate,
                periodKey,
                interest: Number(interest) || 0,
                lateFee: Number(lateFee) || 0,
              })
            }
          >
            Save challan
          </button>
        </div>
      </div>
    </div>
  );
};

export default TdsPage;
