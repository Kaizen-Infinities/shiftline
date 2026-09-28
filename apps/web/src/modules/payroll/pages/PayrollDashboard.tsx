import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gavel,
  Landmark,
  PlayCircle,
  Receipt,
  RotateCcw,
  Settings,
  Umbrella,
  Users,
  Wallet,
  IndianRupee,
  Hourglass,
} from "lucide-react";
import { toast } from "react-toastify";
import { useAppSelector } from "../../../hooks/reduxHooks";
import { StatusBadge } from "../../../components/ui/StatusBadge/Badge";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import DataTable from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SectionLabel,
  SkeletonRows,
  SkeletonTile,
  StatTile,
  Tile,
  chipClass,
  cx,
} from "../../../components/ui/v2";
import { payrollService } from "../../../services/payrollService";
import type { ApiPayrollRun, ApiEmployeePayroll } from "../../../services/payrollService";
import { usePermission } from "../../../hooks/usePermission";
import {
  Notice,
  PageShell,
  errorMessage,
  formatINR,
  formatINRCompact,
  periodLabel,
} from "../components/peopleUi";

const getCurrentMonth = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
};

/** Statutory schemes shown as chips on the "Statutory dues" tile (the concept's TDS · PF · PT). */
const STATUTORY_CHIPS = ["TDS", "PF", "ESI", "PT", "LWF"] as const;

const PayrollDashboard: React.FC = () => {
  const company = useAppSelector((state) => state.company.data);
  const navigate = useNavigate();
  const { can } = usePermission();
  const canCreateRun = can("payroll-run.create");
  const canEditRun = can("payroll-run.edit");
  const canDeleteRun = can("payroll-run.delete");
  const canViewRun = can("payroll-run.view");
  const canStatutory = can("payroll.view");

  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth);
  const [runs, setRuns] = useState<ApiPayrollRun[]>([]);
  const [employees, setEmployees] = useState<ApiEmployeePayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [runsLoading, setRunsLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteRunId, setDeleteRunId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const handleConfirmDelete = async () => {
    if (!deleteRunId) return;
    setIsDeleting(true);
    try {
      await payrollService.deleteRun(deleteRunId);
      toast.success("Draft payroll run deleted successfully");
      setRuns((prev) => prev.filter((r) => r.id !== deleteRunId));
      setDeleteRunId(null);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Failed to delete payroll run"));
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setRunsLoading(true);
        setError("");
        const [runsData, empData] = await Promise.all([
          payrollService.listRuns({ period: selectedMonth || undefined, limit: 50 }),
          payrollService.listEmployees(),
        ]);
        setRuns(runsData.runs);
        setEmployees(empData);
      } catch (e: unknown) {
        setError(errorMessage(e, "Failed to load payroll data"));
      } finally {
        setLoading(false);
        setRunsLoading(false);
      }
    };
    load();
  }, [selectedMonth, reloadKey]);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const totalEmployees = employees.length;
  const empWithPayroll = employees.filter((e) => e.payrollConfig);
  const lockedRuns = runs.filter((r) => r.status === "LOCKED");
  const approvedRuns = runs.filter((r) => r.status === "APPROVED");
  const pendingRun = runs.find((r) => r.status === "DRAFT");
  const lastRunNet = lockedRuns.reduce((sum, r) => sum + Number(r.totalNetSalary || 0), 0);
  const lockedPeriods = lockedRuns.map((r) => r.period).join(", ");

  const categoryCounts = {
    FIXED_MONTHLY: employees.filter((e) => e.payrollConfig?.salaryType === "FIXED_MONTHLY").length,
    PF_MONTHLY: employees.filter((e) => e.payrollConfig?.salaryType === "PF_MONTHLY").length,
    CASH_MONTHLY: employees.filter((e) => e.payrollConfig?.salaryType === "CASH_MONTHLY").length,
    DAILY_WEEKLY: employees.filter(
      (e) =>
        e.payrollConfig?.salaryType === "DAILY_WEEKLY" ||
        e.payrollConfig?.salaryType === "WEEKLY" ||
        e.salaryType === "daily" ||
        e.salaryType === "weekly"
    ).length,
  };

  const latestRun = runs[0];
  const focusPeriod = selectedMonth || latestRun?.period || getCurrentMonth();

  // The latest run's statutory totals, for the "Statutory dues" tile.
  const duesRun = runs.find((r) => r.status !== "DRAFT") ?? latestRun;
  const pfDue = duesRun
    ? Number(duesRun.totalPfEmployee || 0) + Number(duesRun.totalPfEmployer || 0)
    : 0;
  const esiDue = duesRun
    ? Number(duesRun.totalEsiEmployee || 0) + Number(duesRun.totalEsiEmployer || 0)
    : 0;

  const timelineSteps = [
    { label: "Attendance", done: !!latestRun, active: false },
    { label: "Compute", done: !!latestRun, active: !latestRun },
    {
      label: "Review",
      done: !!latestRun && latestRun.status !== "DRAFT",
      active: latestRun?.status === "DRAFT",
    },
    {
      label: "Approve",
      done: latestRun?.status === "APPROVED" || latestRun?.status === "LOCKED",
      active: false,
    },
    {
      label: "Lock & disburse",
      done: latestRun?.status === "LOCKED",
      active: latestRun?.status === "APPROVED",
    },
  ];

  const categories = [
    { label: "Fixed monthly (Admin)", count: categoryCounts.FIXED_MONTHLY, series: 1 },
    { label: "PF workers (Monthly)", count: categoryCounts.PF_MONTHLY, series: 4 },
    { label: "Cash workers (Monthly)", count: categoryCounts.CASH_MONTHLY, series: 3 },
    { label: "Daily wage (Weekly)", count: categoryCounts.DAILY_WEEKLY, series: 2 },
  ];
  const categoryMax = Math.max(1, ...categories.map((c) => c.count));

  const shortcuts = [
    {
      label: "Attendance",
      path: "/payroll/attendance",
      icon: ClipboardList,
      show: can("payroll-attendance.view"),
    },
    { label: "Monthly report", path: "/payroll/monthly-report", icon: FileText, show: canViewRun },
    {
      label: "Weekly report",
      path: "/payroll/weekly-report",
      icon: CalendarRange,
      show: canViewRun,
    },
    {
      label: "Salary advance",
      path: "/payroll/advance",
      icon: Wallet,
      show: can("payroll-advance.view"),
    },
    { label: "Statutory", path: "/payroll/statutory", icon: Landmark, show: canStatutory },
    { label: "Leave", path: "/hr/leave", icon: Umbrella, show: can("leave.view") },
    { label: "Registers", path: "/hr/registers", icon: BookOpen, show: can("registers.view") },
    { label: "Fines", path: "/hr/fines", icon: Gavel, show: can("fines.view") },
    {
      label: "Settings",
      path: "/payroll/settings",
      icon: Settings,
      show: can("payroll-settings.view"),
    },
  ].filter((s) => s.show);

  // ── Run table columns ──────────────────────────────────────────────────────
  const runColumns = [
    {
      header: "Period",
      render: (r: ApiPayrollRun) => (
        <div className="min-w-0">
          <span className="block font-semibold text-ink">{periodLabel(r.period)}</span>
          <span className="block text-[12px] text-ink-subtle">{r.runCode}</span>
        </div>
      ),
    },
    {
      header: "Type",
      render: (r: ApiPayrollRun) => <StatusBadge status={r.type} />,
    },
    {
      header: "Employees",
      align: "right" as const,
      render: (r: ApiPayrollRun) => (
        <span className="tabular-nums text-ink-muted">{r.totalEmployees}</span>
      ),
    },
    {
      header: "Gross",
      align: "right" as const,
      render: (r: ApiPayrollRun) => (
        <span className="tabular-nums text-ink-muted">
          {Number(r.totalGross || 0) > 0 ? formatINR(r.totalGross, { decimals: 0 }) : "—"}
        </span>
      ),
    },
    {
      header: "Net Salary",
      align: "right" as const,
      render: (r: ApiPayrollRun) => {
        const netSal = Number(r.totalNetSalary || 0);
        return (
          <span className="font-semibold tabular-nums text-ink">
            {netSal > 0 ? formatINR(netSal, { decimals: 0 }) : "—"}
          </span>
        );
      },
    },
    {
      header: "Status",
      render: (r: ApiPayrollRun) => <StatusBadge status={r.status} />,
    },
    {
      header: "Action",
      align: "right" as const,
      render: (r: ApiPayrollRun) => (
        <div className="flex items-center justify-end gap-1.5">
          {canViewRun && (
            <ViewButton
              onClick={() =>
                navigate(r.type === "WEEKLY" ? "/payroll/weekly-report" : "/payroll/monthly-report")
              }
            />
          )}
          {canEditRun && (r.status === "DRAFT" || r.status === "APPROVED") && (
            <EditButton onClick={() => navigate(`/payroll/run?runId=${r.id}`)} />
          )}
          {canDeleteRun && r.status === "DRAFT" && (
            <DeleteButton onClick={() => setDeleteRunId(r.id)} />
          )}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <PageShell>
        <PageHeader title="Payroll" subtitle="Loading payroll data…" />
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonTile lines={4} height={220} className="lg:col-span-2" />
          <SkeletonTile lines={4} height={220} />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <StatTile key={i} label=" " value="" loading />
          ))}
        </div>
        <div className="sl-tile overflow-hidden">
          <SkeletonRows rows={5} columns={6} label="Loading payroll runs" />
        </div>
      </PageShell>
    );
  }

  const runPayrollCta = canCreateRun ? (
    <ActionPill
      size="xl"
      icon={<PlayCircle size={20} />}
      onClick={() => navigate("/payroll/run?type=monthly")}
    >
      Run Payroll
    </ActionPill>
  ) : null;

  return (
    <PageShell>
      <PageHeader
        title="Payroll"
        subtitle={
          <>
            {company?.companyName || "Company"} · salaries, statutory dues and payslips for{" "}
            {periodLabel(focusPeriod)}
          </>
        }
        icon={<IndianRupee size={20} />}
        actions={
          canCreateRun ? (
            <ActionPill
              variant="secondary"
              icon={<CalendarDays size={17} />}
              onClick={() => navigate("/payroll/run?type=weekly")}
            >
              Weekly run
            </ActionPill>
          ) : null
        }
      />

      {error && (
        <Notice
          tone="danger"
          title="Payroll data could not be loaded"
          action={
            <ActionPill
              variant="secondary"
              size="sm"
              icon={<RotateCcw size={15} />}
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Retry
            </ActionPill>
          }
        >
          {error}
        </Notice>
      )}

      {/* ── Hero: Run Payroll + Statutory dues ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Tile padding="lg" className="lg:col-span-3">
          <div className="flex h-full flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="lg" icon={<CalendarDays size={15} />}>
                {periodLabel(focusPeriod)}
              </Chip>
              {latestRun ? (
                <StatusBadge status={latestRun.status} />
              ) : (
                <Chip tone="muted">Not started</Chip>
              )}
              {pendingRun && <Chip tone="warning">Draft awaiting approval</Chip>}
            </div>

            <div>
              <p className="sl-section-label m-0">Net pay this period</p>
              <p className="m-0 mt-1 text-[40px] font-bold leading-none tracking-tight tabular-nums text-ink sm:text-[48px]">
                {latestRun && Number(latestRun.totalNetSalary || 0) > 0
                  ? formatINR(latestRun.totalNetSalary, { decimals: 0 })
                  : "₹0"}
              </p>
              <p className="sl-muted m-0 mt-2 text-sm">
                {latestRun
                  ? `${latestRun.totalEmployees} employees · gross ${formatINR(latestRun.totalGross, { decimals: 0 })}`
                  : `${empWithPayroll.length} of ${totalEmployees} employees are set up for payroll`}
              </p>
            </div>

            {/* Pipeline of the latest run */}
            <ol
              className="m-0 flex list-none flex-wrap items-center gap-2 p-0"
              aria-label="Payroll steps"
            >
              {timelineSteps.map((step, i) => (
                <li key={step.label} className="flex items-center gap-2">
                  <span
                    className={cx(
                      chipClass({
                        tone: step.done ? "success" : step.active ? "default" : "muted",
                        size: "sm",
                      })
                    )}
                    aria-current={step.active ? "step" : undefined}
                  >
                    {step.done ? (
                      <CheckCircle2 size={13} aria-hidden="true" />
                    ) : (
                      <span className="tabular-nums">{i + 1}</span>
                    )}
                    {step.label}
                  </span>
                  {i < timelineSteps.length - 1 && (
                    <ArrowRight size={13} aria-hidden="true" className="text-ink-subtle" />
                  )}
                </li>
              ))}
            </ol>

            <div className="mt-auto flex flex-wrap items-center gap-3">
              {runPayrollCta}
              {pendingRun && canEditRun && (
                <ActionPill
                  variant="secondary"
                  size="lg"
                  onClick={() => navigate(`/payroll/run?runId=${pendingRun.id}`)}
                >
                  Continue draft
                </ActionPill>
              )}
            </div>
          </div>
        </Tile>

        <Tile padding="lg" className="lg:col-span-2">
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="sl-h2 m-0">Statutory dues</h2>
                <p className="sl-muted m-0 mt-0.5 text-sm">
                  {duesRun ? periodLabel(duesRun.period) : "After your first run"}
                </p>
              </div>
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-chip text-accent"
                aria-hidden="true"
              >
                <Receipt size={20} />
              </span>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Statutory schemes">
              {STATUTORY_CHIPS.map((c) => (
                <Chip key={c} size="lg">
                  {c}
                </Chip>
              ))}
            </div>
            <dl className="m-0 grid grid-cols-2 gap-3">
              <div className="rounded-[14px] bg-card-2 px-4 py-3">
                <dt className="text-[12px] font-medium text-ink-subtle">Provident fund</dt>
                <dd className="m-0 mt-1 text-lg font-bold tabular-nums text-ink">
                  {formatINRCompact(pfDue)}
                </dd>
              </div>
              <div className="rounded-[14px] bg-card-2 px-4 py-3">
                <dt className="text-[12px] font-medium text-ink-subtle">State insurance</dt>
                <dd className="m-0 mt-1 text-lg font-bold tabular-nums text-ink">
                  {formatINRCompact(esiDue)}
                </dd>
              </div>
            </dl>
            {canStatutory && (
              <ActionPill
                variant="secondary"
                className="mt-auto self-start"
                iconRight={<ArrowRight size={16} />}
                onClick={() => navigate("/payroll/statutory")}
              >
                Generate challans
              </ActionPill>
            )}
          </div>
        </Tile>
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Employees"
          value={totalEmployees}
          icon={<Users size={19} />}
          hint={`${empWithPayroll.length} configured for payroll`}
        />
        <StatTile
          label="Last locked run"
          value={lastRunNet > 0 ? formatINRCompact(lastRunNet) : "—"}
          icon={<IndianRupee size={19} />}
          hint={lockedPeriods ? lockedPeriods : "No locked run yet"}
        />
        <StatTile
          label="Pending approval"
          value={pendingRun ? 1 : 0}
          icon={<Hourglass size={19} />}
          delta={pendingRun ? "Draft" : undefined}
          deltaTone="warning"
          hint={pendingRun ? `${pendingRun.period} ${pendingRun.type}` : "No pending runs"}
        />
        <StatTile
          label="Runs"
          value={runs.length}
          icon={<CheckCircle2 size={19} />}
          hint={`${lockedRuns.length} locked · ${approvedRuns.length} approved`}
        />
      </div>

      {/* ── Workforce mix + shortcuts ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Tile
          title="Workforce by pay type"
          subtitle="How salaries are worked out"
          className="lg:col-span-3"
        >
          <ul className="m-0 list-none space-y-3.5 p-0">
            {categories.map((cat) => (
              <li
                key={cat.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5"
              >
                <span className="text-sm font-medium text-ink">{cat.label}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {cat.count} <span className="font-normal text-ink-subtle">employees</span>
                </span>
                <span
                  className="col-span-2 h-2 overflow-hidden rounded-full bg-card-2"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(cat.count ? 4 : 0, (cat.count / categoryMax) * 100)}%`,
                      background: `var(--chart-series-${cat.series})`,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </Tile>

        <div className="lg:col-span-2">
          <SectionLabel>Go to</SectionLabel>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {shortcuts.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => navigate(s.path)}
                className="sl-tile sl-tile-hover flex min-h-[76px] flex-col items-start justify-between gap-2 p-3.5 text-left text-sm font-semibold text-ink"
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-chip text-accent"
                  aria-hidden="true"
                >
                  <s.icon size={16} />
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Payroll runs ── */}
      <section aria-labelledby="payroll-runs-heading" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 id="payroll-runs-heading" className="sl-h2 m-0">
              Payroll runs
            </h2>
            <Chip size="sm" tone="muted">
              {runs.length}
            </Chip>
            {runsLoading && <span className="sl-spinner" aria-label="Loading" />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="payroll-month">
              Month
            </label>
            <input
              id="payroll-month"
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="sl-input h-10 w-auto text-sm"
            />
            {selectedMonth !== getCurrentMonth() && (
              <Chip
                icon={<RotateCcw size={13} />}
                onClick={() => setSelectedMonth(getCurrentMonth())}
                title="Reset to current month"
              >
                Current month
              </Chip>
            )}
            <Chip
              selected={selectedMonth === ""}
              onClick={() => setSelectedMonth("")}
              title="Show all payroll runs"
            >
              All months
            </Chip>
          </div>
        </div>

        {runs.length === 0 ? (
          <div className="sl-tile">
            <EmptyState
              icon={<Receipt size={28} strokeWidth={1.75} />}
              title={
                selectedMonth
                  ? `No payroll runs for ${periodLabel(selectedMonth)}`
                  : "No payroll runs yet"
              }
              description="A run works out attendance, earnings and deductions for everyone in one go."
              action={
                canCreateRun ? (
                  <ActionPill
                    variant="secondary"
                    onClick={() => navigate("/payroll/run")}
                    iconRight={<ArrowRight size={16} />}
                  >
                    Start your first run
                  </ActionPill>
                ) : null
              }
            />
          </div>
        ) : (
          <DataTable
            columns={runColumns}
            data={runs.slice(0, 10)}
            rowKey={(r) => r.id}
            ariaLabel="Payroll runs"
          />
        )}
      </section>

      <CommonConfirmModal
        isOpen={deleteRunId !== null}
        onClose={() => setDeleteRunId(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Payroll Run"
        message="Are you sure you want to delete this payroll run? This action cannot be undone."
        confirmText="Delete Run"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </PageShell>
  );
};

export default PayrollDashboard;
