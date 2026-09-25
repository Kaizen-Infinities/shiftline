import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  gstReturnsService,
  type FollowUpPreview,
  type Gstr2bSummary,
  type MatchStatus,
} from "../../../services/gstReturnsService";
import { Card, day, danger, field, message, money, primary, secondary, td, th } from "./gstUi";

/**
 * The GSTR-2B reconciliation workbench (P1-13c, P1-13d).
 *
 * The screen is organised around the disagreements, because the agreements need no attention:
 * a matched record is one line, a mismatch shows which field differs and by how much, and the
 * two one-sided buckets — the supplier did not file it, or the company did not record it — are
 * the two conversations the month actually needs.
 */
const STATUS_STYLE: Record<MatchStatus, string> = {
  MATCHED: "bg-emerald-100 text-emerald-800",
  MISMATCH: "bg-amber-100 text-amber-800",
  MISSING_IN_2B: "bg-rose-100 text-rose-800",
  MISSING_IN_BOOKS: "bg-sky-100 text-sky-800",
};
const STATUS_LABEL: Record<MatchStatus, string> = {
  MATCHED: "Agrees",
  MISMATCH: "Differs",
  MISSING_IN_2B: "Not filed by the supplier",
  MISSING_IN_BOOKS: "Not in our books",
};

interface Props {
  summary: Gstr2bSummary;
  period: string;
  gstin: string;
  onChange: () => void | Promise<void>;
}

/** Per-tenant matching tolerances (P2-10): how many days and how many rupees still count as a match. */
const ToleranceSettings: React.FC = () => {
  const { can } = usePermission();
  const [days, setDays] = useState(7);
  const [value, setValue] = useState(1);
  const [followUpProvider, setFollowUpProvider] = useState<"FIXTURE" | "LIVE">("FIXTURE");
  const [nudgeAfterDays, setNudgeAfterDays] = useState(5);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    gstReturnsService
      .gstr2bSettings()
      .then((s) => {
        setDays(s.dateToleranceDays);
        setValue(s.valueTolerance);
        if (s.followUpProvider) setFollowUpProvider(s.followUpProvider);
        if (s.nudgeAfterDays) setNudgeAfterDays(s.nudgeAfterDays);
      })
      .catch(() => {});
  }, []);

  if (!can("gst-returns.prepare")) return null;

  const save = async () => {
    setSaving(true);
    try {
      const s = await gstReturnsService.gstr2bSettingsUpdate({
        dateToleranceDays: days,
        valueTolerance: value,
        followUpProvider,
        nudgeAfterDays,
      });
      setDays(s.dateToleranceDays);
      setValue(s.valueTolerance);
      if (s.followUpProvider) setFollowUpProvider(s.followUpProvider);
      if (s.nudgeAfterDays) setNudgeAfterDays(s.nudgeAfterDays);
      toast.success("Settings saved — they apply from the next reconciliation");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Matching tolerances and follow-ups"
      actions={
        <button className={secondary} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide" : "Change"}
        </button>
      }
    >
      {open ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink-muted">
            Days either side of the document date
            <input
              type="number"
              min={0}
              max={60}
              className={`${field} mt-1 block w-28`}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Rupees of difference still a match
            <input
              type="number"
              min={0}
              step="0.01"
              className={`${field} mt-1 block w-32`}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Follow-up channel
            <select
              className={`${field} mt-1 block w-36`}
              value={followUpProvider}
              onChange={(e) => setFollowUpProvider(e.target.value as "FIXTURE" | "LIVE")}
            >
              <option value="FIXTURE">Fixture (test)</option>
              <option value="LIVE">Live</option>
            </select>
          </label>
          <label className="text-sm text-ink-muted">
            Nudge after (days unfollowed)
            <input
              type="number"
              min={1}
              max={60}
              className={`${field} mt-1 block w-28`}
              value={nudgeAfterDays}
              onChange={(e) => setNudgeAfterDays(Number(e.target.value))}
            />
          </label>
          <button className={primary} onClick={save} disabled={saving}>
            Save
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          A record within {days} day(s) and {money(value)} of the books still counts as a match.
          Follow-ups send over the{" "}
          <strong>{followUpProvider === "LIVE" ? "live" : "fixture"}</strong> channel; a record
          unfollowed for {nudgeAfterDays} day(s) gets nudged automatically.
        </p>
      )}
    </Card>
  );
};

/** Chasing a supplier over the records the reconciliation named (P2-10). */
const FollowUpPanel: React.FC<{
  summary: Gstr2bSummary;
  period: string;
  gstin: string;
  onChange: () => void | Promise<void>;
}> = ({ summary, period, gstin, onChange }) => {
  const { can } = usePermission();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");
  const [preview, setPreview] = useState<FollowUpPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const chaseable = [
    ...summary.records
      .filter((r) => r.matchStatus === "MISMATCH")
      .map((r) => ({
        recordId: r.id,
        supplierGstin: r.supplierGstin,
        supplierName: r.supplierName,
        docNo: r.docNo,
        docDate: r.docDate,
      })),
    ...summary.missingIn2b.map((b) => ({
      recordId: `${b.docType}:${b.docId}`,
      supplierGstin: b.supplierGstin ?? undefined,
      supplierName: null as string | null,
      docNo: b.docNo,
      docDate: b.docDate,
    })),
  ];

  if (!can("gst-returns.prepare") || chaseable.length === 0) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const lastBySupplier = new Map(summary.followUps.map((f) => [f.supplierGstin, f]));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Chase a supplier">
      <p className="mb-2 text-xs text-ink-muted">
        Pick the records to name, a channel, and preview the message before it goes.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr>
              <th className={th}></th>
              <th className={th}>Document</th>
              <th className={th}>Date</th>
              <th className={th}>Last sent</th>
            </tr>
          </thead>
          <tbody>
            {chaseable.map((c) => {
              const last = c.supplierGstin ? lastBySupplier.get(c.supplierGstin) : undefined;
              return (
                <tr key={c.recordId} className="border-t border-line-soft">
                  <td className={td}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.recordId)}
                      onChange={() => toggle(c.recordId)}
                    />
                  </td>
                  <td className={td}>
                    {c.docNo}
                    {c.supplierName ? (
                      <span className="ml-1 text-xs text-ink-muted">{c.supplierName}</span>
                    ) : null}
                  </td>
                  <td className={td}>{day(c.docDate)}</td>
                  <td className={`${td} text-xs text-ink-muted`}>
                    {last
                      ? `${last.channel === "WHATSAPP" ? "WhatsApp" : "Email"} · ${day(last.sentAt)} · ${last.status === "SENT" ? "sent" : "failed"}`
                      : "never"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={field}
          value={channel}
          onChange={(e) => setChannel(e.target.value as "WHATSAPP" | "EMAIL")}
          aria-label="Channel"
        >
          <option value="WHATSAPP">WhatsApp</option>
          <option value="EMAIL">Email</option>
        </select>
        <button
          className={secondary}
          disabled={busy || selected.size === 0}
          onClick={() =>
            act(async () => {
              const p = await gstReturnsService.gstr2bFollowUpPreview(period, {
                gstin,
                channel,
                recordIds: [...selected],
              });
              setPreview(p);
            })
          }
        >
          Preview
        </button>
        <button
          className={primary}
          disabled={busy || selected.size === 0}
          onClick={() =>
            act(async () => {
              await gstReturnsService.gstr2bFollowUp(period, {
                gstin,
                channel,
                recordIds: [...selected],
              });
              toast.success("Follow-up sent");
              setSelected(new Set());
              setPreview(null);
              await onChange();
            })
          }
        >
          Send
        </button>
      </div>
      {preview && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg border border-line-soft bg-card-2 p-3 text-sm text-ink">
          <p className="mb-1 text-xs uppercase tracking-wide text-ink-muted">
            To {preview.supplierName ?? preview.supplierGstin}
          </p>
          {preview.message}
        </div>
      )}
    </Card>
  );
};

const Gstr2bWorkbench: React.FC<Props> = ({ summary, period, gstin, onChange }) => {
  const { can } = usePermission();
  const [filter, setFilter] = useState<MatchStatus | "">("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const s = summary.summary;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await onChange();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      toast.error("That file is not JSON");
      return;
    }
    await act(() => gstReturnsService.gstr2bImport(period, gstin, json), "2B imported");
  };

  const rows = filter ? summary.records.filter((r) => r.matchStatus === filter) : summary.records;
  const credit = (c: { igst: number; cgst: number; sgst: number; cess: number }) =>
    c.igst + c.cgst + c.sgst + c.cess;
  const gap = credit(s.bookCredit) - credit(s.portalCredit);

  return (
    <div className="space-y-4">
      <ToleranceSettings />
      <Card
        title="Reconciliation"
        actions={
          can("gst-returns.prepare") && (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
              <button
                className={secondary}
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                Import the portal's file
              </button>
              <button
                className={primary}
                onClick={() => act(() => gstReturnsService.gstr2bPull(period, gstin), "2B pulled")}
                disabled={busy}
              >
                Pull from the portal
              </button>
            </div>
          )
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["MATCHED", s.matched],
              ["MISMATCH", s.mismatch],
              ["MISSING_IN_2B", s.missingIn2b],
              ["MISSING_IN_BOOKS", s.missingInBooks],
            ] as [MatchStatus, number][]
          ).map(([key, count]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "" : key)}
              aria-pressed={filter === key}
              className={`rounded-lg border p-3 text-left transition ${
                filter === key ? "border-blue-500 bg-blue-50" : "border-line-soft bg-card-2"
              }`}
            >
              <p className="text-xs uppercase tracking-wide text-ink-muted">{STATUS_LABEL[key]}</p>
              <p className="mt-1 text-lg font-semibold text-ink">{count}</p>
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-line-soft bg-card-2 p-3 text-sm">
          <p className="text-ink">
            Credit the suppliers filed: <strong>{money(credit(s.portalCredit))}</strong> · credit
            the books claim: <strong>{money(credit(s.bookCredit))}</strong>
          </p>
          <p className="mt-1 text-ink-muted">
            {gap === 0
              ? "The two agree."
              : gap > 0
                ? `The books claim ${money(gap)} more than the suppliers filed. That is the amount at risk.`
                : `The suppliers filed ${money(-gap)} more than the books claim.`}
          </p>
        </div>
      </Card>

      <Card title={filter ? STATUS_LABEL[filter] : "Every record"}>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Supplier</th>
                <th className={th}>Document</th>
                <th className={th}>Date</th>
                <th className={`${th} text-right`}>Taxable</th>
                <th className={`${th} text-right`}>Tax</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-line-soft">
                    <td className={td}>
                      <div className="font-medium">{r.supplierName ?? r.supplierGstin}</div>
                      <div className="text-xs text-ink-muted">{r.supplierGstin}</div>
                    </td>
                    <td className={td}>
                      {r.docNo}
                      <span className="ml-1 text-xs text-ink-muted">{r.docType}</span>
                    </td>
                    <td className={td}>{day(r.docDate)}</td>
                    <td className={`${td} text-right`}>{money(r.taxable)}</td>
                    <td className={`${td} text-right`}>
                      {money(Number(r.igst) + Number(r.cgst) + Number(r.sgst) + Number(r.cess))}
                    </td>
                    <td className={td}>
                      {r.matchStatus && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.matchStatus]}`}
                        >
                          {STATUS_LABEL[r.matchStatus]}
                        </span>
                      )}
                      {!r.itcAvailable && (
                        <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          No credit: {r.itcReason ?? "the portal says so"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {r.mismatchFields?.length ? (
                    <tr className="bg-amber-50/50">
                      <td className={`${td} text-xs text-amber-900`} colSpan={6}>
                        {r.mismatchFields.map((f) => (
                          <span key={f.field} className="mr-4">
                            <strong>{f.field}</strong>: books {String(f.inBooks)}, portal{" "}
                            {String(f.inPortal)}
                            {f.difference !== undefined
                              ? ` (${f.difference > 0 ? "+" : ""}${f.difference})`
                              : ""}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={6}>
                    Nothing here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <FollowUpPanel summary={summary} period={period} gstin={gstin} onChange={onChange} />

      {summary.missingIn2b.length > 0 && (
        <Card title="In our books, not filed by the supplier">
          <p className="mb-2 text-sm text-ink-muted">
            Credit cannot be taken on these until the supplier files them. They are the month's
            follow-up list.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Document</th>
                  <th className={th}>Date</th>
                  <th className={`${th} text-right`}>Taxable</th>
                </tr>
              </thead>
              <tbody>
                {summary.missingIn2b.map((b) => (
                  <tr key={`${b.docType}-${b.docId}`} className="border-t border-line-soft">
                    <td className={td}>
                      {b.docNo} <span className="text-xs text-ink-muted">{b.docType}</span>
                    </td>
                    <td className={td}>{day(b.docDate)}</td>
                    <td className={`${td} text-right`}>{money(b.taxable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {busy && <p className={`${danger} inline-block`}>Working…</p>}
    </div>
  );
};

export default Gstr2bWorkbench;
