import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock3 } from "lucide-react";

import { gstReturnsService, type ComplianceDue } from "../../../services/gstReturnsService";
import {
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatTile,
  Tile,
  actionPillClass,
  cx,
  type ChipTone,
} from "../../../components/ui/v2";
import { day, message, periodLabel } from "../components/gstUi";

/**
 * The compliance calendar (P1-13d): every statutory date in the window, how far along each one
 * is, and what is already late.
 *
 * Overdue comes first. A calendar that puts next month's GSTR-1 above last month's unfiled
 * return is a pretty list rather than a working one.
 */
const STATUS_TONE: Record<ComplianceDue["status"], ChipTone> = {
  NOT_STARTED: "muted",
  DRAFT: "muted",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUBMITTED: "success",
};
const STATUS_LABEL: Record<ComplianceDue["status"], string> = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  PENDING: "Awaiting approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUBMITTED: "Filed",
};
/** The next thing to do with a filing, as the verb on its button. */
const NEXT_STEP: Record<ComplianceDue["status"], string> = {
  NOT_STARTED: "Prepare",
  DRAFT: "Prepare",
  PENDING: "Approve",
  APPROVED: "File",
  REJECTED: "Fix",
  SUBMITTED: "View",
};
const AUTHORITY_LABEL: Record<string, string> = {
  GST: "GST",
  INCOME_TAX: "Income tax",
  EPFO: "EPFO",
  ESIC: "ESIC",
  STATE: "State",
  MCA: "MCA",
};
const authorityLabel = (a: string) =>
  AUTHORITY_LABEL[a] ??
  a
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

/** Where a filing type is actually worked on. */
const linkFor = (row: ComplianceDue): string => {
  if (row.filingType === "GSTR9") return `/compliance/gst?tab=gstr9`;
  if (row.filingType === "IMS") return `/compliance/gst?tab=ims&period=${row.periodKey}`;
  if (row.filingType.startsWith("GSTR"))
    return `/compliance/gst?tab=${row.filingType.toLowerCase()}&period=${row.periodKey}`;
  return row.filingId ? `/compliance/approvals?focus=${row.filingId}` : "/compliance/approvals";
};

/** "49 days late" / "Due today" / "Due in 3 days", as a chip whose tone says how urgent. */
const DueChip: React.FC<{ row: ComplianceDue }> = ({ row }) => {
  if (row.status === "SUBMITTED")
    return (
      <Chip tone="success" size="sm" icon={<CheckCircle2 size={12} />}>
        Filed
      </Chip>
    );
  const d = row.daysLeft;
  if (row.overdue)
    return (
      <Chip tone="danger" size="sm" icon={<AlertTriangle size={12} />}>
        Overdue · {-d} day{d === -1 ? "" : "s"} late
      </Chip>
    );
  if (d === 0)
    return (
      <Chip tone="warning" size="sm" icon={<Clock3 size={12} />}>
        Due today
      </Chip>
    );
  if (d > 0)
    return (
      <Chip tone={d <= 7 ? "warning" : "default"} size="sm" icon={<Clock3 size={12} />}>
        Due in {d} day{d === 1 ? "" : "s"}
      </Chip>
    );
  return (
    <Chip tone="muted" size="sm">
      Closed
    </Chip>
  );
};

type View = "action" | "overdue" | "upcoming" | "done";

const ComplianceCalendarPage: React.FC = () => {
  const [rows, setRows] = useState<ComplianceDue[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("action");
  const [authority, setAuthority] = useState<string>("");

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

  const scoped = useMemo(
    () => (authority ? rows.filter((r) => r.authority === authority) : rows),
    [rows, authority]
  );
  const authorities = useMemo(() => [...new Set(rows.map((r) => r.authority))], [rows]);

  const overdue = scoped.filter((r) => r.overdue);
  const upcoming = scoped.filter((r) => !r.overdue && r.daysLeft >= 0);
  const done = scoped.filter((r) => !r.overdue && r.daysLeft < 0);
  const dueThisWeek = upcoming.filter((r) => r.daysLeft <= 7 && r.status !== "SUBMITTED");
  const needsAction = [...overdue, ...upcoming.filter((r) => r.status !== "SUBMITTED")];

  const list =
    view === "overdue"
      ? overdue
      : view === "upcoming"
        ? upcoming
        : view === "done"
          ? done
          : needsAction;

  // The one thing to do next: the most urgent filing that is not yet filed.
  const next = needsAction[0];
  const allOverdue = rows.filter((r) => r.overdue).length;

  return (
    <div className="sl-page">
      <PageHeader
        title="Compliance Calendar"
        icon={<CalendarClock size={22} />}
        subtitle="Every statutory date, where it stands, and what is already late."
        meta={
          !loading ? (
            allOverdue > 0 ? (
              <Chip tone="danger" dot>
                {allOverdue} overdue
              </Chip>
            ) : (
              <Chip tone="success" dot>
                Nothing overdue
              </Chip>
            )
          ) : undefined
        }
        primaryAction={
          next ? (
            <Link to={linkFor(next)} className={actionPillClass({ size: "lg" })}>
              {NEXT_STEP[next.status]} {next.name}
              <span className="font-medium opacity-80">· {periodLabel(next.periodKey)}</span>
            </Link>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Overdue"
          value={overdue.length}
          loading={loading}
          icon={<AlertTriangle size={18} />}
          delta={overdue.length > 0 ? "Act now" : "Clear"}
          deltaTone={overdue.length > 0 ? "danger" : "success"}
          onClick={() => setView("overdue")}
        />
        <StatTile
          label="Due in 7 days"
          value={dueThisWeek.length}
          loading={loading}
          icon={<Clock3 size={18} />}
          deltaTone="warning"
          delta={dueThisWeek.length > 0 ? "This week" : undefined}
          onClick={() => setView("upcoming")}
        />
        <StatTile
          label="Coming up"
          value={upcoming.length}
          loading={loading}
          icon={<CalendarClock size={18} />}
          onClick={() => setView("upcoming")}
        />
        <StatTile
          label="Done"
          value={done.length}
          loading={loading}
          icon={<CheckCircle2 size={18} />}
          onClick={() => setView("done")}
        />
      </div>

      <Tile padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line-soft px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5">
          <ChipTabs<View>
            ariaLabel="Which filings"
            value={view}
            onChange={setView}
            items={[
              { key: "action", label: "Needs action", count: needsAction.length },
              { key: "overdue", label: "Overdue", count: overdue.length },
              { key: "upcoming", label: "Coming up", count: upcoming.length },
              { key: "done", label: "Done", count: done.length },
            ]}
          />
          {authorities.length > 1 && (
            <div
              role="group"
              aria-label="Authority"
              className="flex items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]"
            >
              <Chip size="sm" selected={authority === ""} onClick={() => setAuthority("")}>
                All
              </Chip>
              {authorities.map((a) => (
                <Chip
                  key={a}
                  size="sm"
                  selected={authority === a}
                  onClick={() => setAuthority(authority === a ? "" : a)}
                  className="shrink-0"
                >
                  {authorityLabel(a)}
                </Chip>
              ))}
            </div>
          )}
        </div>

        {loading && rows.length === 0 ? (
          <SkeletonRows rows={6} columns={5} header={false} label="Loading the calendar" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={28} strokeWidth={1.75} />}
            title={
              view === "overdue"
                ? "Nothing overdue."
                : view === "done"
                  ? "Nothing filed in the window yet."
                  : view === "upcoming"
                    ? "Nothing due in the window."
                    : "You are all caught up."
            }
            description={
              view === "action" ? "Every filing in the window is filed or not yet due." : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line-soft" aria-label="Filings">
            {list.map((r) => {
              const late = r.overdue;
              return (
                <li
                  key={`${r.filingType}-${r.periodKey}`}
                  className={cx(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1.2fr)_150px_auto] md:px-5",
                    late && "bg-[color:color-mix(in_srgb,var(--color-danger)_4%,transparent)]"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cx(
                        "hidden h-10 w-10 shrink-0 flex-col items-center justify-center rounded-[12px] text-center leading-none sm:flex",
                        late
                          ? "bg-[color:color-mix(in_srgb,var(--color-danger)_12%,var(--color-card))] text-[color:var(--color-danger)]"
                          : "bg-chip text-chip-fg"
                      )}
                    >
                      <span className="text-[15px] font-bold tabular-nums">
                        {new Date(r.dueDate).getDate()}
                      </span>
                      <span className="text-[10px] font-semibold uppercase">
                        {new Date(r.dueDate).toLocaleDateString("en-IN", { month: "short" })}
                      </span>
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{r.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                        <span>{authorityLabel(r.authority)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="md:hidden">{periodLabel(r.periodKey)} ·</span>
                        <span className="md:hidden">Due {day(r.dueDate)}</span>
                        <span className="hidden md:inline">{r.cadence.toLowerCase()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="hidden text-sm tabular-nums text-ink md:block">
                    {periodLabel(r.periodKey)}
                  </div>
                  <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
                    <span className="hidden text-sm tabular-nums text-ink md:inline">
                      {day(r.dueDate)}
                    </span>
                    <DueChip row={r} />
                  </div>
                  <div className="hidden md:block">
                    <Chip tone={STATUS_TONE[r.status]} size="sm" dot>
                      {STATUS_LABEL[r.status]}
                    </Chip>
                  </div>
                  <div className="col-start-2 row-start-1 flex justify-end md:col-auto md:row-auto">
                    <Link
                      className={actionPillClass({ variant: "secondary", size: "sm" })}
                      to={linkFor(r)}
                      aria-label={`${NEXT_STEP[r.status]} ${r.name} for ${periodLabel(r.periodKey)}`}
                    >
                      {NEXT_STEP[r.status]}
                      <ChevronRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Tile>
    </div>
  );
};

export default ComplianceCalendarPage;
