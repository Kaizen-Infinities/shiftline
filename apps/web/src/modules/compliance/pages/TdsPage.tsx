import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

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
  day,
  field,
  fyOptions,
  message,
  money,
  primary,
  secondary,
  success,
  td,
  th,
} from "../components/gstUi";

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
const STATUS_STYLE: Record<TdsDeductionRow["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CHALLAN_PAID: "bg-sky-100 text-sky-800",
  RETURN_FILED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-100 text-slate-700",
};
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

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">TDS and TCS</h1>
          <p className="text-sm text-ink-muted">
            Tax held back from what you pay, and collected on what you sell. It has to reach the
            government by the 7th of the next month and be reported every quarter.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={field}
            value={fyCode}
            onChange={(e) => setFyCode(e.target.value)}
            aria-label="Financial year"
          >
            {years.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className={field}
            value={quarter}
            onChange={(e) => setQuarter(e.target.value as Quarter)}
            aria-label="Quarter"
          >
            {QUARTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {tab === "returns" && (
            <select
              className={field}
              value={form}
              onChange={(e) => setForm(e.target.value as "26Q" | "27Q")}
              aria-label="Form"
            >
              <option value="26Q">26Q · residents</option>
              <option value="27Q">27Q · non-residents</option>
            </select>
          )}
        </div>
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {(
          [
            ["deductions", "Deductions"],
            ["challans", "Challans"],
            ["returns", "Quarterly return"],
            ["sections", "Sections and rates"],
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

      {tab === "deductions" && (
        <>
          {unchallaned.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <strong>
                {unchallaned.length} deduction{unchallaned.length === 1 ? "" : "s"} not yet paid to
                the government.
              </strong>{" "}
              The return cannot be filed while any of them is outstanding.
            </div>
          )}
          <Card
            title="Deductions"
            actions={
              can("tds.pay") && (
                <button
                  className={primary}
                  disabled={picked.length === 0}
                  onClick={() => setPaying(true)}
                >
                  Pay challan{picked.length > 0 ? ` · ${money(pickedTotal)}` : ""}
                </button>
              )
            }
          >
            <div className="overflow-x-auto">
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
                          <span className="ml-1 text-xs text-ink-muted">TCS</span>
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
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[d.status]}`}
                        >
                          {d.status.replace(/_/g, " ").toLowerCase()}
                        </span>
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
            </div>
          </Card>
        </>
      )}

      {tab === "challans" && (
        <Card title="Challans paid">
          <div className="overflow-x-auto">
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
                      {c.isTcs && <span className="ml-1 text-xs text-ink-muted">TCS</span>}
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
          </div>
        </Card>
      )}

      {tab === "returns" && ret && (
        <>
          {ret.warnings.length > 0 && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              <ul className="list-inside list-disc space-y-0.5">
                {ret.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          <Card
            title={`Form ${ret.formType} · ${ret.fyCode} ${ret.quarter}`}
            actions={
              <div className="flex flex-wrap gap-2">
                <a
                  className={secondary}
                  href={`/api${tdsService.fileUrl(form, fyCode, quarter)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download e-TDS file
                </a>
                {can("tds.prepare") && (
                  <button
                    className={success}
                    disabled={busy}
                    onClick={async () => {
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
                    }}
                  >
                    Send for approval
                  </button>
                )}
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Deductees" value={String(ret.totals.deductees)} />
              <Stat label="Amount paid" value={money(ret.totals.amountPaid)} />
              <Stat label="Tax deducted" value={money(ret.totals.tdsDeducted)} />
              <Stat label="Challans total" value={money(ret.totals.challanTotal)} />
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Deductor {ret.deductor.name} · TAN {ret.deductor.tan ?? "not set"} · PAN{" "}
              {ret.deductor.pan ?? "not set"}
              {ret.filing && ` · filing ${ret.filing.status.toLowerCase()}`}
            </p>
          </Card>
          <Card title="Deductee rows">
            <div className="overflow-x-auto">
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
                          <span className="font-semibold text-rose-700">Not paid</span>
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
            </div>
          </Card>
        </>
      )}

      {tab === "sections" && (
        <Card title="Sections and rates">
          <p className="mb-3 text-xs text-ink-muted">
            Rates move with every Finance Act, so these belong to your company and can be edited.
            The familiar number is what the return carries; the Act reference says where it now
            sits.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Section</th>
                  <th className={th}>Name</th>
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
                        {s.isTcs && <span className="ml-1 text-xs text-ink-muted">TCS</span>}
                        <div className="text-xs text-ink-muted">{s.actCode ?? "—"}</div>
                      </td>
                      <td className={td}>{s.name}</td>
                      {editing ? (
                        <>
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
                          <td className={`${td} text-right`}>{Number(s.rateCompany)}%</td>
                          <td className={`${td} text-right`}>{Number(s.rateIndividual)}%</td>
                          <td className={`${td} text-right`}>{Number(s.rateNoPan)}%</td>
                          <td className={`${td} text-right`}>
                            {Number(s.thresholdSingle) > 0 ? money(s.thresholdSingle) : "—"}
                          </td>
                          <td className={`${td} text-right`}>
                            {Number(s.thresholdAnnual) > 0 ? money(s.thresholdAnnual) : "—"}
                          </td>
                          <td className={td}>{s.isActive ? "Yes" : "No"}</td>
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
          </div>
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
  <div className="rounded-lg border border-line-soft bg-card-2 p-3">
    <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-line-soft bg-card p-4">
        <h2 className="text-lg font-semibold text-ink">Record a challan</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {rows.length} deduction{rows.length === 1 ? "" : "s"} totalling {money(total)}.
        </p>
        {months.length > 1 && (
          <p className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
            These deductions fall in {months.join(", ")}. One challan covers one month — pay them
            separately.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-muted">
            BSR code
            <input
              className={`${field} mt-1 w-full`}
              value={bsrCode}
              maxLength={7}
              onChange={(e) => setBsrCode(e.target.value.replace(/\D/g, ""))}
              placeholder="7 digits"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Challan serial
            <input
              className={`${field} mt-1 w-full`}
              value={challanSerial}
              maxLength={10}
              onChange={(e) => setChallanSerial(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Paid on
            <input
              type="date"
              className={`${field} mt-1 w-full`}
              value={challanDate}
              onChange={(e) => setChallanDate(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            For the month
            <input
              type="month"
              className={`${field} mt-1 w-full`}
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Interest
            <input
              className={`${field} mt-1 w-full`}
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Late fee
            <input
              className={`${field} mt-1 w-full`}
              value={lateFee}
              onChange={(e) => setLateFee(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className={secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={primary}
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
