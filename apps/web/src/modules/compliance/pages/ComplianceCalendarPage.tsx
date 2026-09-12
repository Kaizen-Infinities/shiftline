import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import { gstReturnsService, type ComplianceDue } from "../../../services/gstReturnsService";
import { Card, day, message, td, th } from "../components/gstUi";

/**
 * The compliance calendar (P1-13d): every statutory date in the window, how far along each one
 * is, and what is already late.
 *
 * Overdue comes first. A calendar that puts next month's GSTR-1 above last month's unfiled
 * return is a pretty list rather than a working one.
 */
const STATUS_STYLE: Record<ComplianceDue["status"], string> = {
  NOT_STARTED: "bg-slate-100 text-slate-700",
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  SUBMITTED: "bg-sky-100 text-sky-800",
};
const STATUS_LABEL: Record<ComplianceDue["status"], string> = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUBMITTED: "Filed",
};

/** Where a filing type is actually worked on. */
const linkFor = (row: ComplianceDue): string => {
  if (row.filingType === "GSTR9") return `/compliance/gst?tab=gstr9`;
  if (row.filingType === "IMS") return `/compliance/gst?tab=ims&period=${row.periodKey}`;
  if (row.filingType.startsWith("GSTR"))
    return `/compliance/gst?tab=${row.filingType.toLowerCase()}&period=${row.periodKey}`;
  return row.filingId ? `/compliance/approvals?focus=${row.filingId}` : "/compliance/approvals";
};

const ComplianceCalendarPage: React.FC = () => {
  const [rows, setRows] = useState<ComplianceDue[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await gstReturnsService.calendar());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const overdue = rows.filter((r) => r.overdue);
  const upcoming = rows.filter((r) => !r.overdue && r.daysLeft >= 0);
  const done = rows.filter((r) => !r.overdue && r.daysLeft < 0);

  const table = (list: ComplianceDue[], empty: string) => (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead>
          <tr>
            <th className={th}>Filing</th>
            <th className={th}>Period</th>
            <th className={th}>Due</th>
            <th className={th}>Status</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={`${r.filingType}-${r.periodKey}`} className="border-t border-line-soft">
              <td className={td}>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-ink-muted">{r.authority}</div>
              </td>
              <td className={td}>{r.periodKey}</td>
              <td className={td}>
                {day(r.dueDate)}
                <div
                  className={`text-xs ${r.overdue ? "font-semibold text-rose-700" : "text-ink-muted"}`}
                >
                  {r.daysLeft === 0
                    ? "today"
                    : r.daysLeft > 0
                      ? `in ${r.daysLeft} day${r.daysLeft === 1 ? "" : "s"}`
                      : `${-r.daysLeft} day${r.daysLeft === -1 ? "" : "s"} late`}
                </div>
              </td>
              <td className={td}>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className={`${td} text-right`}>
                <Link
                  className="text-sm font-semibold text-blue-700 hover:underline"
                  to={linkFor(r)}
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td className={`${td} text-ink-muted`} colSpan={5}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold text-ink">Compliance Calendar</h1>
        <p className="text-sm text-ink-muted">
          Every statutory date, where it stands, and what is already late.
        </p>
      </header>
      {loading && <p className="text-sm text-ink-muted">Loading…</p>}
      {overdue.length > 0 && (
        <Card title={`Overdue · ${overdue.length}`}>{table(overdue, "Nothing overdue.")}</Card>
      )}
      <Card title="Coming up">{table(upcoming, "Nothing due in the window.")}</Card>
      {done.length > 0 && <Card title="Done">{table(done, "")}</Card>}
    </div>
  );
};

export default ComplianceCalendarPage;
