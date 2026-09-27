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
import EwayBillPanel from "../../compliance/components/EwayBillPanel";
import Itc04Tables from "../../compliance/components/Itc04Tables";
import { day, message, money } from "../../compliance/components/gstUi";
import { AlertTriangle, FileText, PackageCheck, Truck, Undo2, X } from "lucide-react";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tile,
  type ChipTone,
} from "../../../components/ui/v2";
import { PageBody, formatQty } from "../ui";

const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-3 text-sm text-ink align-top";
const numInput = "sl-input h-11 w-28 text-right tabular-nums";

/**
 * Job work (P1-14).
 *
 * The screen is built around the clock, not the paperwork: what is still out, how long it has,
 * and what is already late. Past the deadline the credit taken on those goods is treated as a
 * supply made on the day they left, with interest — so overdue comes first and stays visible.
 */
type Tab = "challans" | "workers" | "itc04";
const STATUS_TONE: Record<ChallanRow["status"], ChipTone> = {
  OPEN: "warning",
  PART_RETURNED: "info",
  CLOSED: "success",
  CANCELLED: "muted",
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
    <PageBody>
      <PageHeader
        title="Job Work"
        icon={<Truck size={22} />}
        subtitle="Goods sent out without a sale. They have to come back within a year — three for capital goods — or the credit taken on them goes back with interest."
        actions={
          tab === "itc04" ? (
            <select
              className="sl-input h-11 w-auto pr-9"
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
          ) : undefined
        }
      >
        <ChipTabs
          items={[
            { key: "challans" as Tab, label: "Challans" },
            { key: "workers" as Tab, label: "Job workers" },
            { key: "itc04" as Tab, label: "ITC-04" },
          ]}
          value={tab}
          onChange={setTab}
          ariaLabel="Job work sections"
          size="lg"
        />
      </PageHeader>

      {tab === "challans" && (
        <>
          {overdue.length > 0 && !overdueOnly && (
            <div
              role="alert"
              className="sl-tile flex flex-wrap items-center gap-3 p-4 text-sm"
              style={{ boxShadow: "inset 4px 0 0 var(--color-danger)" }}
            >
              <AlertTriangle
                size={18}
                className="shrink-0 text-[color:var(--color-danger)]"
                aria-hidden="true"
              />
              <strong className="text-[color:var(--color-danger)]">
                {overdue.length} challan{overdue.length === 1 ? "" : "s"} past the return deadline.
              </strong>
              <ActionPill variant="secondary" size="sm" onClick={() => setOverdueOnly(true)}>
                Show only those
              </ActionPill>
            </div>
          )}
          <Tile
            padding="none"
            divider
            title={overdueOnly ? "Overdue challans" : "Challans"}
            actions={
              <div role="group" aria-label="Challan filter" className="flex gap-2">
                <Chip size="lg" selected={!overdueOnly} onClick={() => setOverdueOnly(false)}>
                  All
                </Chip>
                <Chip
                  size="lg"
                  selected={overdueOnly}
                  onClick={() => setOverdueOnly(true)}
                  count={overdue.length || undefined}
                >
                  Overdue only
                </Chip>
              </div>
            }
          >
            {loading ? (
              <SkeletonRows rows={4} columns={6} />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full" aria-label="Job work challans">
                  <thead className="bg-card-2">
                    <tr>
                      <th scope="col" className={th}>
                        Challan
                      </th>
                      <th scope="col" className={th}>
                        Sent to
                      </th>
                      <th scope="col" className={th}>
                        Date
                      </th>
                      <th scope="col" className={th}>
                        Back by
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Still out
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Value
                      </th>
                      <th scope="col" className={th}>
                        Status
                      </th>
                      <th scope="col" className={th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <React.Fragment key={r.id}>
                        <tr className="border-t border-line-soft">
                          <td className={td}>
                            <span className="font-mono text-[13px] font-semibold text-accent">
                              {r.challanNo}
                            </span>
                            <div className="text-xs text-ink-muted">
                              {r.kind.replace(/_/g, " ").toLowerCase()}
                            </div>
                          </td>
                          <td className={td}>{r.jobWorker?.name ?? r.purpose ?? "—"}</td>
                          <td className={`${td} tabular-nums`}>{day(r.challanDate)}</td>
                          <td className={`${td} tabular-nums`}>
                            {r.returnDueDate ? day(r.returnDueDate) : "—"}
                            {r.daysToReturn !== null && r.pendingQuantity > 0 && (
                              <div className="mt-1">
                                <Chip size="sm" tone={r.overdue ? "danger" : "muted"}>
                                  {r.overdue
                                    ? `${-r.daysToReturn} days late`
                                    : `${r.daysToReturn} days left`}
                                </Chip>
                              </div>
                            )}
                          </td>
                          <td className={`${td} text-right font-semibold tabular-nums`}>
                            {formatQty(r.pendingQuantity)}
                          </td>
                          <td className={`${td} text-right tabular-nums`}>{money(r.totalValue)}</td>
                          <td className={td}>
                            <Chip size="sm" dot tone={STATUS_TONE[r.status]}>
                              {r.status.replace(/_/g, " ").toLowerCase()}
                            </Chip>
                            {r.cancelledAt && r.cancelReason && (
                              <div className="mt-1 text-xs text-ink-muted">{r.cancelReason}</div>
                            )}
                          </td>
                          <td className={`${td} text-right`}>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <a
                                className="sl-btn sl-pill-sm"
                                href={`/api${jobWorkService.pdfUrl(r.id)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <FileText size={14} aria-hidden="true" />
                                Challan
                              </a>
                              {can("job-work.create") &&
                                r.kind === "JOB_WORK_OUT" &&
                                r.status !== "CANCELLED" &&
                                r.pendingQuantity > 0 && (
                                  <ActionPill
                                    variant="secondary"
                                    size="sm"
                                    icon={<PackageCheck size={14} />}
                                    onClick={() => setReceiving(r)}
                                  >
                                    Receive
                                  </ActionPill>
                                )}
                              {can("job-work.create") &&
                                r.kind === "JOB_WORK_OUT" &&
                                r.status !== "CANCELLED" &&
                                r.pendingQuantity > 0 && (
                                  <ActionPill
                                    variant="secondary"
                                    size="sm"
                                    icon={<Undo2 size={14} />}
                                    onClick={() => setReturning(r)}
                                  >
                                    Return
                                  </ActionPill>
                                )}
                              {can("job-work.manage") && r.status !== "CANCELLED" && (
                                <ActionPill
                                  variant="secondary"
                                  size="sm"
                                  icon={<Truck size={14} />}
                                  aria-expanded={ewayFor === r.id}
                                  onClick={() => setEwayFor(ewayFor === r.id ? null : r.id)}
                                >
                                  E-way bill
                                </ActionPill>
                              )}
                              {can("job-work.cancel") && r.status !== "CANCELLED" && (
                                <ActionPill
                                  variant="ghost"
                                  size="sm"
                                  icon={<X size={14} />}
                                  className="text-[color:var(--color-danger)]"
                                  onClick={() => setCancelling(r)}
                                >
                                  Cancel
                                </ActionPill>
                              )}
                            </div>
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
                  </tbody>
                </table>
                {rows.length === 0 && (
                  <EmptyState
                    compact
                    icon={<PackageCheck size={22} />}
                    title="Nothing out."
                    description={
                      overdueOnly
                        ? "No challan is past its return deadline."
                        : "Challans raised for goods sent to job workers show up here."
                    }
                  />
                )}
              </div>
            )}
          </Tile>
        </>
      )}

      {tab === "workers" && (
        <Tile padding="none" divider title="Job workers">
          {loading ? (
            <SkeletonRows rows={4} columns={5} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full" aria-label="Job workers">
                <thead className="bg-card-2">
                  <tr>
                    <th scope="col" className={th}>
                      Code
                    </th>
                    <th scope="col" className={th}>
                      Name
                    </th>
                    <th scope="col" className={th}>
                      GSTIN
                    </th>
                    <th scope="col" className={th}>
                      Process
                    </th>
                    <th scope="col" className={th}>
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id} className="border-t border-line-soft">
                      <td className={`${td} font-mono text-[13px]`}>{w.code}</td>
                      <td className={`${td} font-semibold`}>{w.name}</td>
                      <td className={`${td} font-mono text-[13px]`}>
                        {w.gstin ?? (
                          <Chip size="sm" tone="muted">
                            Unregistered
                          </Chip>
                        )}
                      </td>
                      <td className={td}>{w.processType ?? "—"}</td>
                      <td className={td}>
                        <Chip size="sm" dot tone={w.isActive ? "success" : "muted"}>
                          {w.isActive ? "Yes" : "No"}
                        </Chip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {workers.length === 0 && <EmptyState compact title="No job workers yet." />}
            </div>
          )}
        </Tile>
      )}

      {tab === "itc04" && loading && <SkeletonRows rows={4} columns={4} />}
      {tab === "itc04" && itc && (
        <Itc04Tables
          itc={itc}
          canManage={can("job-work.manage")}
          busy={busy}
          onRegister={async () => {
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
          onFilingChange={(f) => setItc({ ...itc, filing: f })}
        />
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
    </PageBody>
  );
};

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
    <Tile
      className="ring-2 ring-chip"
      title={`Receive against ${challan.challanNo}`}
      subtitle="A line is settled when what came back, what the process used up and what was scrapped add up to what was sent."
    >
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-card-2">
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
                <td className={`${td} text-right font-semibold tabular-nums`}>{i.balance}</td>
                {(["returned", "consumed", "scrap"] as const).map((k) => (
                  <td className={td} key={k}>
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label={`${k} — ${i.description ?? i.rawMaterialId}`}
                      className={numInput}
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
      <div className="mt-4 flex flex-wrap justify-end gap-2.5">
        <ActionPill variant="secondary" onClick={onCancel}>
          Cancel
        </ActionPill>
        <ActionPill
          loading={busy}
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
        </ActionPill>
      </div>
    </Tile>
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
    <Tile
      className="ring-2 ring-chip"
      title={`Return against ${challan.challanNo}`}
      subtitle="Records the receipt on the parent challan in the same step as raising this one."
    >
      <div className="mb-3 max-w-[220px]">
        <label htmlFor="jw-return-date" className="sl-label">
          Challan date
        </label>
        <input
          id="jw-return-date"
          type="date"
          className="sl-input h-11"
          value={challanDate}
          onChange={(e) => setChallanDate(e.target.value)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-card-2">
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
                <td className={`${td} text-right font-semibold tabular-nums`}>{i.balance}</td>
                {(["returned", "scrap"] as const).map((k) => (
                  <td className={td} key={k}>
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label={`${k} — ${i.description ?? i.rawMaterialId}`}
                      max={i.balance}
                      className={numInput}
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
      <div className="mt-4 flex flex-wrap justify-end gap-2.5">
        <ActionPill variant="secondary" onClick={onCancel}>
          Cancel
        </ActionPill>
        <ActionPill
          loading={busy}
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
        </ActionPill>
      </div>
    </Tile>
  );
};

export default JobWorkPage;
