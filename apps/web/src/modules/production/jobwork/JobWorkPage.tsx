import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import CancelReasonModal from "../../../components/ui/CancelReasonModal/CancelReasonModal";
import { usePermission } from "../../../hooks/usePermission";
import {
  jobWorkService,
  type ChallanRow,
  type Itc04Registered,
  type JobWorkerRow,
} from "../../../services/jobWorkService";
import ApprovalPanel from "../../compliance/components/ApprovalPanel";
import EwayBillPanel from "../../compliance/components/EwayBillPanel";
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
 * Job work (P1-14).
 *
 * The screen is built around the clock, not the paperwork: what is still out, how long it has,
 * and what is already late. Past the deadline the credit taken on those goods is treated as a
 * supply made on the day they left, with interest — so overdue comes first and stays visible.
 */
type Tab = "challans" | "workers" | "itc04";
const STATUS_STYLE: Record<ChallanRow["status"], string> = {
  OPEN: "bg-amber-100 text-amber-800",
  PART_RETURNED: "bg-sky-100 text-sky-800",
  CLOSED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-slate-100 text-slate-700",
};
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

const JobWorkPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<Tab>("challans");
  const [rows, setRows] = useState<ChallanRow[]>([]);
  const [workers, setWorkers] = useState<JobWorkerRow[]>([]);
  const [itc, setItc] = useState<Itc04Registered | null>(null);
  const [halfYear, setHalfYear] = useState(halfYearOptions()[0].value);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [receiving, setReceiving] = useState<ChallanRow | null>(null);
  const [returning, setReturning] = useState<ChallanRow | null>(null);
  const [cancelling, setCancelling] = useState<ChallanRow | null>(null);
  const [ewayFor, setEwayFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "challans") setRows(await jobWorkService.challans({ overdueOnly }));
      if (tab === "workers") setWorkers(await jobWorkService.workers(true));
      if (tab === "itc04") setItc(await jobWorkService.itc04(halfYear));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, overdueOnly, halfYear]);
  useEffect(() => {
    void load();
  }, [load]);

  const overdue = rows.filter((r) => r.overdue);

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Job Work</h1>
          <p className="text-sm text-ink-muted">
            Goods sent out without a sale. They have to come back within a year — three for capital
            goods — or the credit taken on them goes back with interest.
          </p>
        </div>
        {tab === "itc04" && (
          <select
            className={field}
            value={halfYear}
            onChange={(e) => setHalfYear(e.target.value)}
            aria-label="Half year"
          >
            {halfYearOptions().map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </header>

      <nav className="flex gap-1 border-b border-line-soft" role="tablist">
        {(
          [
            ["challans", "Challans"],
            ["workers", "Job workers"],
            ["itc04", "ITC-04"],
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

      {tab === "challans" && (
        <>
          {overdue.length > 0 && !overdueOnly && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm">
              <strong className="text-rose-900">
                {overdue.length} challan{overdue.length === 1 ? "" : "s"} past the return deadline.
              </strong>{" "}
              <button
                className="font-semibold text-rose-800 underline"
                onClick={() => setOverdueOnly(true)}
              >
                Show only those
              </button>
            </div>
          )}
          <Card
            title={overdueOnly ? "Overdue challans" : "Challans"}
            actions={
              <button className={secondary} onClick={() => setOverdueOnly((v) => !v)}>
                {overdueOnly ? "Show all" : "Overdue only"}
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Challan</th>
                    <th className={th}>Sent to</th>
                    <th className={th}>Date</th>
                    <th className={th}>Back by</th>
                    <th className={`${th} text-right`}>Still out</th>
                    <th className={`${th} text-right`}>Value</th>
                    <th className={th}>Status</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <React.Fragment key={r.id}>
                      <tr className="border-t border-line-soft">
                        <td className={td}>
                          {r.challanNo}
                          <div className="text-xs text-ink-muted">
                            {r.kind.replace(/_/g, " ").toLowerCase()}
                          </div>
                        </td>
                        <td className={td}>{r.jobWorker?.name ?? r.purpose ?? "—"}</td>
                        <td className={td}>{day(r.challanDate)}</td>
                        <td className={td}>
                          {r.returnDueDate ? day(r.returnDueDate) : "—"}
                          {r.daysToReturn !== null && r.pendingQuantity > 0 && (
                            <div
                              className={`text-xs ${r.overdue ? "font-semibold text-rose-700" : "text-ink-muted"}`}
                            >
                              {r.overdue
                                ? `${-r.daysToReturn} days late`
                                : `${r.daysToReturn} days left`}
                            </div>
                          )}
                        </td>
                        <td className={`${td} text-right`}>{r.pendingQuantity}</td>
                        <td className={`${td} text-right`}>{money(r.totalValue)}</td>
                        <td className={td}>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                          >
                            {r.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                          {r.cancelledAt && r.cancelReason && (
                            <div className="text-xs text-ink-muted">{r.cancelReason}</div>
                          )}
                        </td>
                        <td className={`${td} text-right`}>
                          <a
                            className="mr-2 text-sm font-semibold text-blue-700 hover:underline"
                            href={`/api${jobWorkService.pdfUrl(r.id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Challan
                          </a>
                          {can("job-work.create") &&
                            r.kind === "JOB_WORK_OUT" &&
                            r.status !== "CANCELLED" &&
                            r.pendingQuantity > 0 && (
                              <button
                                className={`${secondary} mr-2`}
                                onClick={() => setReceiving(r)}
                              >
                                Receive
                              </button>
                            )}
                          {can("job-work.create") &&
                            r.kind === "JOB_WORK_OUT" &&
                            r.status !== "CANCELLED" &&
                            r.pendingQuantity > 0 && (
                              <button
                                className={`${secondary} mr-2`}
                                onClick={() => setReturning(r)}
                              >
                                Return
                              </button>
                            )}
                          {can("job-work.manage") && r.status !== "CANCELLED" && (
                            <button
                              className={`${secondary} mr-2`}
                              onClick={() => setEwayFor(ewayFor === r.id ? null : r.id)}
                            >
                              E-way bill
                            </button>
                          )}
                          {can("job-work.cancel") && r.status !== "CANCELLED" && (
                            <button className={danger} onClick={() => setCancelling(r)}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                      {ewayFor === r.id && (
                        <tr className="border-t border-line-soft bg-card-2">
                          <td className={td} colSpan={8}>
                            <EwayBillPanel
                              docType="JWC"
                              docRef={r.id}
                              documentCancelled={!!r.cancelledAt}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {rows.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={8}>
                        Nothing out.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "workers" && (
        <Card title="Job workers">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Name</th>
                  <th className={th}>GSTIN</th>
                  <th className={th}>Process</th>
                  <th className={th}>Active</th>
                </tr>
              </thead>
              <tbody>
                {workers.map((w) => (
                  <tr key={w.id} className="border-t border-line-soft">
                    <td className={td}>{w.code}</td>
                    <td className={td}>{w.name}</td>
                    <td className={td}>
                      {w.gstin ?? <span className="text-ink-muted">Unregistered</span>}
                    </td>
                    <td className={td}>{w.processType ?? "—"}</td>
                    <td className={td}>{w.isActive ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {workers.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={5}>
                      No job workers yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "itc04" && itc && (
        <>
          <Card
            title={`ITC-04 · ${itc.from} to ${itc.to}`}
            actions={
              can("job-work.manage") && (
                <div className="flex items-center gap-2">
                  {itc.json && (
                    <span className="text-xs text-ink-muted">
                      JSON ready ({(itc.json as { version?: string }).version ?? "GST-ITC04-2.1"})
                    </span>
                  )}
                  <button
                    className={secondary}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        setItc(await jobWorkService.registerItc04(halfYear));
                        toast.success("Registered on the filing gate");
                      } catch (err) {
                        toast.error(message(err));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Register / refresh
                  </button>
                  {itc.json && (
                    <button
                      className={secondary}
                      onClick={() => {
                        const blob = new Blob([JSON.stringify(itc.json, null, 2)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        window.open(url, "_blank");
                      }}
                    >
                      View JSON
                    </button>
                  )}
                </div>
              )
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Challans issued" value={String(itc.totals.challansIssued)} />
              <Stat label="Quantity sent" value={String(itc.totals.quantitySent)} />
              <Stat label="Value sent" value={money(itc.totals.valueSent)} />
              <Stat label="Received back" value={String(itc.totals.challansReceived)} />
            </div>
            {itc.filing && (
              <div className="mt-3">
                <ApprovalPanel row={itc.filing} onChange={(f) => setItc({ ...itc, filing: f })} />
              </div>
            )}
          </Card>
          <Card title="Table 4 — sent for job work">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Challan</th>
                    <th className={th}>Date</th>
                    <th className={th}>Job worker</th>
                    <th className={th}>Goods</th>
                    <th className={`${th} text-right`}>Qty</th>
                    <th className={`${th} text-right`}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {itc.table4.map((r, i) => (
                    <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                      <td className={td}>{r.challanNo}</td>
                      <td className={td}>{day(r.challanDate)}</td>
                      <td className={td}>
                        {r.jobWorkerName ?? "—"}
                        {!r.registered && (
                          <span className="ml-1 text-xs text-ink-muted">(unregistered)</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.description}
                        {r.capitalGoods && (
                          <span className="ml-1 text-xs text-ink-muted">capital goods</span>
                        )}
                      </td>
                      <td className={`${td} text-right`}>
                        {r.quantity} {r.uom ?? ""}
                      </td>
                      <td className={`${td} text-right`}>{money(r.taxable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Table 5A — received back">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Challan</th>
                    <th className={th}>Date</th>
                    <th className={th}>Against</th>
                    <th className={th}>Goods</th>
                    <th className={`${th} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {itc.table5A.map((r, i) => (
                    <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                      <td className={td}>{r.challanNo}</td>
                      <td className={td}>{day(r.challanDate)}</td>
                      <td className={td}>{r.originalChallanNo ?? "—"}</td>
                      <td className={td}>{r.description}</td>
                      <td className={`${td} text-right`}>{r.quantity}</td>
                    </tr>
                  ))}
                  {itc.table5A.length === 0 && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={5}>
                        Nothing came back in this half-year.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Table 5B — moved between job workers">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Challan</th>
                    <th className={th}>Date</th>
                    <th className={th}>From</th>
                    <th className={th}>To</th>
                    <th className={th}>Goods</th>
                    <th className={`${th} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {itc.table5B.map((r, i) => (
                    <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                      <td className={td}>{r.challanNo}</td>
                      <td className={td}>{day(r.challanDate)}</td>
                      <td className={td}>{r.fromJobWorkerGstin ?? "—"}</td>
                      <td className={td}>{r.toJobWorkerGstin ?? "—"}</td>
                      <td className={td}>{r.description}</td>
                      <td className={`${td} text-right`}>{r.quantity}</td>
                    </tr>
                  ))}
                  {itc.table5B.length === 0 && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={6}>
                        Nothing moved between job workers in this half-year.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Table 5C — supplied direct from the job worker">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Challan</th>
                    <th className={th}>Date</th>
                    <th className={th}>Invoice</th>
                    <th className={th}>Goods</th>
                    <th className={`${th} text-right`}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {itc.table5C.map((r, i) => (
                    <tr key={`${r.challanNo}-${i}`} className="border-t border-line-soft">
                      <td className={td}>{r.challanNo}</td>
                      <td className={td}>{day(r.challanDate)}</td>
                      <td className={td}>
                        {r.invoiceNo ?? "—"} {r.invoiceDate ? `(${day(r.invoiceDate)})` : ""}
                      </td>
                      <td className={td}>{r.description}</td>
                      <td className={`${td} text-right`}>{r.quantity}</td>
                    </tr>
                  ))}
                  {itc.table5C.length === 0 && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={5}>
                        Nothing supplied directly from a job worker in this half-year.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {receiving && (
        <ReceiveDialog
          challan={receiving}
          busy={busy}
          onCancel={() => setReceiving(null)}
          onDone={async (lines) => {
            setBusy(true);
            try {
              await jobWorkService.receive(receiving.id, lines);
              toast.success("Recorded");
              setReceiving(null);
              await load();
            } catch (err) {
              toast.error(message(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {returning && (
        <ReturnChallanDialog
          challan={returning}
          busy={busy}
          onCancel={() => setReturning(null)}
          onDone={async (challanDate, lines) => {
            setBusy(true);
            try {
              await jobWorkService.createReturn(
                returning.id,
                returning.jobWorkerId,
                challanDate,
                lines
              );
              toast.success("Return recorded against the parent challan");
              setReturning(null);
              await load();
            } catch (err) {
              toast.error(message(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      <CancelReasonModal
        show={!!cancelling}
        onHide={() => setCancelling(null)}
        isLoading={busy}
        title={cancelling ? `Cancel ${cancelling.challanNo}?` : "Cancel this challan?"}
        message="It stays on file as cancelled; nothing is deleted. Refused once a return has been recorded against it."
        confirmText="Cancel challan"
        onConfirm={async (reason) => {
          if (!cancelling) return;
          setBusy(true);
          try {
            await jobWorkService.cancel(cancelling.id, reason);
            toast.success("Challan cancelled");
            setCancelling(null);
            await load();
          } catch (err) {
            toast.error(message(err));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-line-soft bg-card-2 p-3">
    <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
    <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
  </div>
);

const ReceiveDialog: React.FC<{
  challan: ChallanRow;
  busy: boolean;
  onCancel: () => void;
  onDone: (
    lines: { itemId: string; returned?: number; consumed?: number; scrap?: number }[]
  ) => void;
}> = ({ challan, busy, onCancel, onDone }) => {
  const [draft, setDraft] = useState<
    Record<string, { returned: string; consumed: string; scrap: string }>
  >(
    Object.fromEntries(challan.items.map((i) => [i.id, { returned: "", consumed: "", scrap: "" }]))
  );
  return (
    <Card title={`Receive against ${challan.challanNo}`}>
      <p className="mb-2 text-sm text-ink-muted">
        A line is settled when what came back, what the process used up and what was scrapped add up
        to what was sent.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Goods</th>
              <th className={`${th} text-right`}>Still out</th>
              <th className={th}>Returned</th>
              <th className={th}>Consumed</th>
              <th className={th}>Scrap</th>
            </tr>
          </thead>
          <tbody>
            {challan.items.map((i) => (
              <tr key={i.id} className="border-t border-line-soft">
                <td className={td}>{i.description ?? i.rawMaterialId}</td>
                <td className={`${td} text-right font-semibold`}>{i.balance}</td>
                {(["returned", "consumed", "scrap"] as const).map((k) => (
                  <td className={td} key={k}>
                    <input
                      type="number"
                      className={`${field} w-24`}
                      value={draft[i.id]?.[k] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [i.id]: { ...draft[i.id], [k]: e.target.value } })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className={success}
          disabled={busy}
          onClick={() =>
            onDone(
              challan.items
                .map((i) => ({
                  itemId: i.id,
                  returned: Number(draft[i.id]?.returned) || 0,
                  consumed: Number(draft[i.id]?.consumed) || 0,
                  scrap: Number(draft[i.id]?.scrap) || 0,
                }))
                .filter((l) => l.returned || l.consumed || l.scrap)
            )
          }
        >
          Record
        </button>
        <button className={primary.replace("bg-blue-600", "bg-slate-500")} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Card>
  );
};

/**
 * Raising a return challan against its parent: one step. Each line shows what is still out on
 * the parent so the amount typed can't be more than that (the API refuses over-receipt too).
 */
const ReturnChallanDialog: React.FC<{
  challan: ChallanRow;
  busy: boolean;
  onCancel: () => void;
  onDone: (
    challanDate: string,
    lines: {
      parentItemId: string;
      description: string | null;
      uom: string | null;
      quantity: number;
      scrap?: number;
    }[]
  ) => void;
}> = ({ challan, busy, onCancel, onDone }) => {
  const [challanDate, setChallanDate] = useState(new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<Record<string, { returned: string; scrap: string }>>(
    Object.fromEntries(challan.items.map((i) => [i.id, { returned: "", scrap: "" }]))
  );
  return (
    <Card title={`Return against ${challan.challanNo}`}>
      <p className="mb-2 text-sm text-ink-muted">
        Records the receipt on the parent challan in the same step as raising this one.
      </p>
      <label className="mb-2 block text-sm">
        Challan date
        <input
          type="date"
          className={`${field} ml-2`}
          value={challanDate}
          onChange={(e) => setChallanDate(e.target.value)}
        />
      </label>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}>Goods</th>
              <th className={`${th} text-right`}>Still out</th>
              <th className={th}>Returned</th>
              <th className={th}>Scrap</th>
            </tr>
          </thead>
          <tbody>
            {challan.items.map((i) => (
              <tr key={i.id} className="border-t border-line-soft">
                <td className={td}>{i.description ?? i.rawMaterialId}</td>
                <td className={`${td} text-right font-semibold`}>{i.balance}</td>
                {(["returned", "scrap"] as const).map((k) => (
                  <td className={td} key={k}>
                    <input
                      type="number"
                      max={i.balance}
                      className={`${field} w-24`}
                      value={draft[i.id]?.[k] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [i.id]: { ...draft[i.id], [k]: e.target.value } })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          className={success}
          disabled={busy}
          onClick={() =>
            onDone(
              challanDate,
              challan.items
                .map((i) => ({
                  parentItemId: i.id,
                  description: i.description,
                  uom: i.uom,
                  quantity: Number(draft[i.id]?.returned) || 0,
                  scrap: Number(draft[i.id]?.scrap) || 0,
                }))
                .filter((l) => l.quantity || l.scrap)
            )
          }
        >
          Raise return challan
        </button>
        <button className={primary.replace("bg-blue-600", "bg-slate-500")} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Card>
  );
};

export default JobWorkPage;
