import React, { useEffect, useState, useCallback } from "react";
import { AlertTriangle, FileDown, Users, FileText } from "lucide-react";
import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import { usePermission } from "../../../hooks/usePermission";
import IconButton from "../../../components/ui/IconButton/IconButton";
import { FiRefreshCw } from "react-icons/fi";
import CustomButton from "../../../components/ui/custombutton/CustomButton";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import CommonLoader from "../../../components/ui/Loader/CommonLoader";
import { StatusBadge } from "../../../components/ui/StatusBadge/Badge";
import { Chip, PageHeader } from "../../../components/ui/v2";
import { Notice } from "../components/peopleUi";
import { useSocket } from "../../../providers/SocketProvider";
import { payrollService } from "../../../services/payrollService";
import type { ApiPayrollRun, ApiPayrollResult } from "../../../services/payrollService";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import PayslipModal from "../components/PayslipModal";
import FilterPopover from "../../../components/ui/FilterPopover/FilterPopover";

const ITEMS_PER_PAGE = 15;

const MONTH_OPTIONS = [
  { value: "ALL", label: "All Months" },
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const YEAR_OPTIONS = [
  { value: "ALL", label: "All Years" },
  { value: "2027", label: "2027" },
  { value: "2026", label: "2026" },
  { value: "2025", label: "2025" },
  { value: "2024", label: "2024" },
];

const WEEK_OPTIONS = [
  { value: "ALL", label: "All Weeks" },
  ...Array.from({ length: 52 }, (_, i) => {
    const w = `W${String(i + 1).padStart(2, "0")}`;
    return { value: w, label: `Week ${i + 1} (${w})` };
  }),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString("en-IN");

const STATUS_COLOR: Record<string, string> = {
  DRAFT:
    "bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] text-[color:var(--color-warning)]",
  APPROVED: "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent",
  LOCKED: "bg-card-2 text-ink-muted",
};

// ─── Component ────────────────────────────────────────────────────────────────
const WeeklyPayrollReport: React.FC = () => {
  const { can } = usePermission();
  const canViewRun = can("payroll-run.view");
  const { socket } = useSocket();
  const [selectedYear, setSelectedYear] = useState<string>("ALL");
  const [selectedMonth, setSelectedMonth] = useState<string>("ALL");
  const [selectedWeek, setSelectedWeek] = useState<string>("ALL");
  const [draftYear, setDraftYear] = useState<string>("ALL");
  const [draftMonth, setDraftMonth] = useState<string>("ALL");
  const [draftWeek, setDraftWeek] = useState<string>("ALL");

  const hasActiveFilters =
    selectedWeek !== "ALL" || selectedMonth !== "ALL" || selectedYear !== "ALL";
  const activeFilterCount =
    (selectedWeek !== "ALL" ? 1 : 0) +
    (selectedMonth !== "ALL" ? 1 : 0) +
    (selectedYear !== "ALL" ? 1 : 0);

  const handleOpenFilter = () => {
    setDraftWeek(selectedWeek);
    setDraftMonth(selectedMonth);
    setDraftYear(selectedYear);
  };

  const handleApplyFilters = () => {
    setSelectedWeek(draftWeek);
    setSelectedMonth(draftMonth);
    setSelectedYear(draftYear);
  };

  const handleClearFilters = () => {
    setDraftWeek("ALL");
    setDraftMonth("ALL");
    setDraftYear("ALL");
    setSelectedWeek("ALL");
    setSelectedMonth("ALL");
    setSelectedYear("ALL");
  };
  const [runs, setRuns] = useState<ApiPayrollRun[]>([]);
  const [runIdx, setRunIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "BANK" | "CASH">("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ITEMS_PER_PAGE);
  const [pdfLoadingIds, setPdfLoadingIds] = useState<Set<number>>(new Set());
  const [payslipTarget, setPayslipTarget] = useState<{
    runId: number;
    resultId: number;
    period: string;
    type: "MONTHLY" | "WEEKLY";
  } | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await payrollService.listRuns({
        type: "WEEKLY",
        year: selectedYear !== "ALL" ? selectedYear : undefined,
        month: selectedMonth !== "ALL" ? selectedMonth : undefined,
        week: selectedWeek !== "ALL" ? selectedWeek : undefined,
        limit: 100,
      });
      const sorted = [...(res.runs ?? [])].sort(
        (a, b) => new Date(b.period).getTime() - new Date(a.period).getTime()
      );
      setRuns(sorted);
      setRunIdx(0);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load weekly payroll runs.");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedMonth, selectedWeek]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // ── Socket: refresh when any payroll run changes ──────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onRefresh = () => fetchRuns();
    socket.on("payroll:completed", onRefresh);
    socket.on("payroll:approved", onRefresh);
    socket.on("payroll:locked", onRefresh);
    socket.on("payroll:deleted", onRefresh);
    return () => {
      socket.off("payroll:completed", onRefresh);
      socket.off("payroll:approved", onRefresh);
      socket.off("payroll:locked", onRefresh);
      socket.off("payroll:deleted", onRefresh);
    };
  }, [socket, fetchRuns]);

  const run: ApiPayrollRun | undefined = runs[runIdx];

  // Reset table page when run or filter changes
  useEffect(() => {
    setPage(1);
  }, [runIdx, filter]);

  // Ensure full run details with results are loaded for the selected run
  useEffect(() => {
    if (run?.id && (!run.results || run.results.length === 0)) {
      payrollService
        .getRun(run.id)
        .then((fullRun) => {
          if (fullRun && fullRun.results) {
            setRuns((prev) => prev.map((r) => (r.id === fullRun.id ? fullRun : r)));
          }
        })
        .catch(() => {});
    }
  }, [run?.id]);
  // Direct PDF download for a row — guarded against double-click
  const handleDirectPdf = async (r: ApiPayrollResult) => {
    if (!run || pdfLoadingIds.has(r.id)) return;
    setPdfLoadingIds((prev) => new Set(prev).add(r.id));
    try {
      const data = await payrollService.getPayslip(run.id, r.id);
      const { default: PayslipDocumentComp } = await import("../components/PayslipDocument");
      const { default: ReactDOMServer } = await import("react-dom/server");
      const React2 = await import("react");
      const html = ReactDOMServer.renderToStaticMarkup(
        React2.createElement(PayslipDocumentComp, { data })
      );
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const container = document.createElement("div");
      container.style.cssText = "position:fixed;left:-9999px;top:0;background:#fff;";
      container.innerHTML = html;
      document.body.appendChild(container);
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      document.body.removeChild(container);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = pageW / canvas.width;
      const imgH = canvas.height * ratio;
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      let yPos = 0;
      let remaining = imgH;
      while (remaining > 0) {
        pdf.addImage(imgData, "JPEG", 0, -yPos, pageW, imgH);
        remaining -= pageH;
        yPos += pageH;
        if (remaining > 0) pdf.addPage();
      }
      const code = r.employeeCode.replace(/\s+/g, "");
      const period = run.period;
      const wMatch = period.match(/^(\d{4})-W(\d{2})$/);
      const filename = wMatch
        ? `PAYSLIP_${code}_WEEK${wMatch[2]}_${wMatch[1]}.pdf`
        : `PAYSLIP_${code}_${period}.pdf`;
      pdf.save(filename);
    } catch (err) {
      console.error("PDF generation failed", err);
    } finally {
      setPdfLoadingIds((prev) => {
        const s = new Set(prev);
        s.delete(r.id);
        return s;
      });
    }
  };

  const allResults: ApiPayrollResult[] = run?.results ?? [];
  const filtered =
    filter === "ALL" ? allResults : allResults.filter((r) => r.paymentMode === filter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedData = filtered.slice((page - 1) * pageSize, page * pageSize);

  const totals = filtered.reduce(
    (acc, r) => ({
      earnedSalary: acc.earnedSalary + Number(r.earnedSalary || 0),
      otPay: acc.otPay + Number(r.otPay || 0),
      salaryAdvance: acc.salaryAdvance + Number(r.salaryAdvance || 0),
      permissionDeduction: acc.permissionDeduction + Number(r.permissionDeduction || 0),
      netSalary: acc.netSalary + Number(r.netSalary || 0),
      presentDays: acc.presentDays + Number(r.presentDays || 0),
      absentDays: acc.absentDays + Number(r.absentDays || 0),
      halfDays: acc.halfDays + Number(r.halfDays || 0),
    }),
    {
      earnedSalary: 0,
      otPay: 0,
      salaryAdvance: 0,
      permissionDeduction: 0,
      netSalary: 0,
      presentDays: 0,
      absentDays: 0,
      halfDays: 0,
    }
  );

  const totalCashInHand = allResults.reduce((s, r) => s + Number(r.cashInHand || 0), 0);

  const varianceCount = filtered.filter((r) => r.hasVariance).length;

  // ── Loading ──
  if (loading) return <CommonLoader text="Loading weekly payroll reports…" />;

  // ── Error ──
  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4">
          <AlertTriangle size={36} className="text-[color:var(--color-danger)] mx-auto" />
          <p className="text-ink font-semibold">{error}</p>
          <CustomButton text="Retry" icon={FiRefreshCw} onClick={fetchRuns} variant="outline" />
        </div>
      </div>
    );
  }

  // ── Empty ──
  if (runs.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1480px] space-y-5 py-1 sm:py-2">
        {/* Header */}
        <PageHeader
          className="print:hidden"
          title="Weekly Payroll Report"
          icon={<FileText size={20} />}
          back="/payroll"
          backLabel="Back to payroll"
          breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Weekly Payroll Report" }]}
          subtitle={"No payroll runs found for selected filters."}
          meta={undefined}
          actions={
            <>
              <FilterPopover
                activeFilterCount={activeFilterCount}
                hasActiveFilters={hasActiveFilters}
                onApply={handleApplyFilters}
                onClear={handleClearFilters}
                onOpen={handleOpenFilter}
              >
                <div className="mb-3">
                  <label className="sl-label">Week</label>
                  <select
                    className="sl-input h-10 text-sm"
                    value={draftWeek}
                    onChange={(e) => setDraftWeek(e.target.value)}
                  >
                    {WEEK_OPTIONS.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="sl-label">Month</label>
                  <select
                    className="sl-input h-10 text-sm"
                    value={draftMonth}
                    onChange={(e) => setDraftMonth(e.target.value)}
                  >
                    {MONTH_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mb-3">
                  <label className="sl-label">Year</label>
                  <select
                    className="sl-input h-10 text-sm"
                    value={draftYear}
                    onChange={(e) => setDraftYear(e.target.value)}
                  >
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y.value} value={y.value}>
                        {y.label}
                      </option>
                    ))}
                  </select>
                </div>
              </FilterPopover>
            </>
          }
        />

        <div className="sl-tile p-12 text-center" role="status">
          <p className="text-ink font-semibold text-lg">No weekly payroll runs found</p>
          <p className="text-ink-muted text-sm mt-1">
            Try selecting a different week, month, or year filter using the Filters button.
          </p>
        </div>
      </div>
    );
  }

  // ── CSV data with index accessor ──
  const csvData = filtered.map((r, i) => ({ ...r, _idx: i + 1 }));
  const csvColsIndexed = [
    { header: "S.No", accessor: (r: (typeof csvData)[0]) => r._idx },
    { header: "Emp Code", accessor: (r: (typeof csvData)[0]) => r.employeeCode },
    { header: "Name", accessor: (r: (typeof csvData)[0]) => r.employeeName },
    { header: "Department", accessor: (r: (typeof csvData)[0]) => r.department },
    { header: "Salary/Day (₹)", accessor: (r: (typeof csvData)[0]) => r.dailyRate },
    { header: "Present Days", accessor: (r: (typeof csvData)[0]) => r.presentDays },
    { header: "Absent Days", accessor: (r: (typeof csvData)[0]) => r.absentDays },
    { header: "Half Days", accessor: (r: (typeof csvData)[0]) => r.halfDays },
    { header: "Earned Salary (₹)", accessor: (r: (typeof csvData)[0]) => r.earnedSalary },
    { header: "OT Hours", accessor: (r: (typeof csvData)[0]) => r.otHours },
    { header: "OT Pay (₹)", accessor: (r: (typeof csvData)[0]) => r.otPay },
    { header: "Advance (₹)", accessor: (r: (typeof csvData)[0]) => r.salaryAdvance },
    { header: "Perm. Deduction (₹)", accessor: (r: (typeof csvData)[0]) => r.permissionDeduction },
    { header: "Net Salary (₹)", accessor: (r: (typeof csvData)[0]) => r.netSalary },
    { header: "Cash in Hand (₹)", accessor: (r: (typeof csvData)[0]) => r.cashInHand || 0 },
    { header: "Payment Mode", accessor: (r: (typeof csvData)[0]) => r.paymentMode },
  ];

  const reportColumns: DataTableColumn<ApiPayrollResult>[] = [
    {
      header: "S.NO",
      align: "left",
      render: (_, idx) => <span className="text-ink-subtle">{idx + 1}</span>,
    },
    {
      header: "EMP CODE",
      align: "left",
      render: (r) => <span className="tabular-nums text-xs text-ink-muted">{r.employeeCode}</span>,
    },
    {
      header: "EMPLOYEE NAME",
      align: "left",
      render: (r) => (
        <div className="font-semibold text-ink flex items-center gap-1">
          {r.hasVariance && (
            <AlertTriangle size={12} className="text-[color:var(--color-warning)] shrink-0" />
          )}
          <span>{r.employeeName}</span>
        </div>
      ),
    },
    {
      header: "DEPARTMENT",
      align: "left",
      render: (r) => <span className="text-ink-muted">{r.department}</span>,
    },
    {
      header: "SALARY/DAY (₹)",
      align: "right",
      render: (r) => <span className="tabular-nums">₹{fmt(Number(r.dailyRate))}</span>,
    },
    {
      header: "PRESENT",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-[color:var(--color-success)] font-semibold">
          {r.presentDays}
        </span>
      ),
    },
    {
      header: "ABSENT",
      align: "right",
      render: (r) => (
        <span
          className={`tabular-nums ${Number(r.absentDays) > 0 ? "text-[color:var(--color-danger)] font-semibold" : "text-ink-subtle"}`}
        >
          {Number(r.absentDays) > 0 ? r.absentDays : "—"}
        </span>
      ),
    },
    {
      header: "HALF",
      align: "right",
      render: (r) => (
        <span
          className={`tabular-nums ${Number(r.halfDays) > 0 ? "text-[color:var(--color-warning)] font-semibold" : "text-ink-subtle"}`}
        >
          {Number(r.halfDays) > 0 ? r.halfDays : "—"}
        </span>
      ),
    },
    {
      header: "EARNED (₹)",
      align: "right",
      render: (r) => <span className="tabular-nums">₹{fmt(Number(r.earnedSalary))}</span>,
    },
    {
      header: "OT PAY (₹)",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-[color:var(--color-success)]">
          {Number(r.otPay) > 0 ? `₹${fmt(Number(r.otPay))}` : "—"}
        </span>
      ),
    },
    {
      header: "ADVANCE (₹)",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-[color:var(--color-warning)]">
          {Number(r.salaryAdvance) > 0 ? `₹${fmt(Number(r.salaryAdvance))}` : "—"}
        </span>
      ),
    },
    {
      header: "PERM. DED. (₹)",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-[color:var(--color-danger)]">
          {Number(r.permissionDeduction) > 0 ? `₹${fmt(Number(r.permissionDeduction))}` : "—"}
        </span>
      ),
    },
    {
      header: "NET SALARY (₹)",
      align: "right",
      render: (r) => {
        const cashAmt = Number(r.cashInHand || 0);
        return (
          <div className="flex flex-col items-end">
            <span className="tabular-nums font-bold text-ink">₹{fmt(Number(r.netSalary))}</span>
            {cashAmt > 0 && (
              <span className="text-[10px] text-accent font-semibold bg-[color-mix(in_srgb,var(--color-accent)_9%,transparent)] px-1 rounded">
                Cash in Hand ₹{fmt(cashAmt)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      header: "MODE",
      align: "center",
      render: (r) => (
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            r.paymentMode === "BANK"
              ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent"
              : "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[color:var(--color-success)]"
          }`}
        >
          {r.paymentMode}
        </span>
      ),
    },
    {
      header: "ACTIONS",
      align: "center",
      render: (r) => (
        <div className="flex items-center justify-center gap-1">
          {canViewRun && (
            <ViewButton
              onClick={() =>
                run &&
                setPayslipTarget({
                  runId: run.id,
                  resultId: r.id,
                  period: run.period,
                  type: "WEEKLY",
                })
              }
            />
          )}
          <IconButton
            icon={FileDown}
            variant="success"
            title={pdfLoadingIds.has(r.id) ? "Generating…" : "Download PDF"}
            disabled={pdfLoadingIds.has(r.id)}
            onClick={() => handleDirectPdf(r)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1480px] space-y-5 py-1 sm:py-2 print:p-0">
      {/* Header */}
      <PageHeader
        className="print:hidden"
        title="Weekly Payroll Report"
        icon={<FileText size={20} />}
        back="/payroll"
        backLabel="Back to payroll"
        breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Weekly Payroll Report" }]}
        subtitle={`${run.runCode} · ${run.period}`}
        meta={<StatusBadge status={run.status} />}
        actions={
          <>
            {/* Run Selector if multiple runs exist */}
            {runs.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="sl-label !mb-0">Run</span>
                <select
                  value={runIdx}
                  onChange={(e) => setRunIdx(Number(e.target.value))}
                  className="sl-input h-10 w-auto text-sm"
                  aria-label="Payroll run"
                >
                  {runs.map((r, i) => (
                    <option key={r.id} value={i}>
                      {r.runCode} ({r.period})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <FilterPopover
              activeFilterCount={activeFilterCount}
              hasActiveFilters={hasActiveFilters}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
              onOpen={handleOpenFilter}
            >
              <div className="mb-3">
                <label className="sl-label">Week</label>
                <select
                  className="sl-input h-10 text-sm"
                  value={draftWeek}
                  onChange={(e) => setDraftWeek(e.target.value)}
                >
                  {WEEK_OPTIONS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label className="sl-label">Month</label>
                <select
                  className="sl-input h-10 text-sm"
                  value={draftMonth}
                  onChange={(e) => setDraftMonth(e.target.value)}
                >
                  {MONTH_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-3">
                <label className="sl-label">Year</label>
                <select
                  className="sl-input h-10 text-sm"
                  value={draftYear}
                  onChange={(e) => setDraftYear(e.target.value)}
                >
                  {YEAR_OPTIONS.map((y) => (
                    <option key={y.value} value={y.value}>
                      {y.label}
                    </option>
                  ))}
                </select>
              </div>
            </FilterPopover>

            {run && (can("payroll.export") || can("payroll-run.export")) && (
              <ExportCSVButton
                data={csvData}
                columns={csvColsIndexed}
                filename={`weekly-payroll-${run.period}.csv`}
                text="Export CSV"
              />
            )}
          </>
        }
      />

      {/* Variance alert */}
      {varianceCount > 0 && (
        <Notice tone="danger" className="print:hidden">
          <div>
            <span className="font-bold">
              Variance detected in {varianceCount} employee{varianceCount > 1 ? "s" : ""}.
            </span>
            <span className="ml-1">
              Engine-computed values differ from expected. Review before locking.
            </span>
            {filtered
              .filter((r) => r.hasVariance)
              .map((r) => (
                <p key={r.employeeCode} className="mt-1 text-xs">
                  • <b>{r.employeeName}</b>: {r.varianceNote ?? "Variance flagged"}
                </p>
              ))}
          </div>
        </Notice>
      )}

      {/* Filters */}
      <div
        className="flex flex-wrap items-center gap-2 print:hidden"
        role="group"
        aria-label="Payment mode"
      >
        {(
          [
            ["ALL", "All Employees"],
            ["BANK", "Bank Transfer"],
            ["CASH", "Cash"],
          ] as const
        ).map(([v, l]) => (
          <Chip key={v} size="lg" selected={filter === v} onClick={() => setFilter(v)}>
            {l}
          </Chip>
        ))}
        <span className="ml-auto text-sm text-ink-subtle">
          {filtered.length} employee{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table using reusable DataTable component */}
      <div className="sl-tile overflow-hidden">
        <DataTable
          columns={reportColumns}
          data={pagedData}
          rowKey={(r) => r.id}
          emptyMessage="No employees match the selected filter."
          rowClassName={(r) =>
            r.hasVariance ? "bg-[color-mix(in_srgb,var(--color-warning)_9%,transparent)]" : ""
          }
          density="compact"
          pagination={{ currentPage: page, totalPages, onPageChange: setPage }}
        />

        {/* Footer Summary Bar matching PayrollRun design */}
        {filtered.length > 0 && (
          <div className="bg-card border-t border-line-soft overflow-hidden flex flex-col xl:flex-row items-stretch justify-between">
            {/* Left side: TOTAL EMPLOYEES */}
            <div className="px-6 py-4 flex items-center xl:border-r border-line-soft xl:min-w-[180px] w-full xl:w-auto border-b xl:border-b-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-card-2 text-ink-muted font-bold">
                  <Users size={16} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-widest">
                    TOTAL EMPLOYEES
                  </p>
                  <p className="text-sm font-bold text-ink">{filtered.length}</p>
                </div>
              </div>
            </div>

            {/* Middle: EARNED | OT | GROSS | DEDUCTIONS */}
            <div className="flex-1 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 px-6 py-4 text-xs border-b xl:border-b-0 border-line-soft">
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-widest mb-0.5">
                  EARNED
                </span>
                <span className="tabular-nums font-semibold text-ink">
                  ₹{fmt(totals.earnedSalary)}
                </span>
              </div>
              <div className="h-7 w-px bg-line-soft hidden sm:block"></div>

              <div className="flex flex-col items-center">
                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-widest mb-0.5">
                  OT
                </span>
                <span className="tabular-nums font-semibold text-[color:var(--color-success)]">
                  ₹{fmt(totals.otPay)}
                </span>
              </div>
              <div className="h-7 w-px bg-line-soft hidden sm:block"></div>

              <div className="flex flex-col items-center">
                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-widest mb-0.5">
                  GROSS
                </span>
                <span className="tabular-nums font-bold text-ink">
                  ₹{fmt(totals.earnedSalary + totals.otPay)}
                </span>
              </div>
              <div className="h-7 w-px bg-line-soft hidden sm:block"></div>

              <div className="flex flex-col items-center">
                <span className="text-[10px] font-bold text-[color:var(--color-danger)] uppercase tracking-widest mb-0.5">
                  DEDUCTIONS
                </span>
                <span className="tabular-nums font-semibold text-[color:var(--color-danger)]">
                  ADV ₹{fmt(totals.salaryAdvance)} · PERM ₹{fmt(totals.permissionDeduction)}
                </span>
              </div>
            </div>

            {/* Right side: NET PAY & CASH IN HAND */}
            <div className="flex items-stretch xl:border-l border-line-soft bg-card-2 w-full xl:w-auto">
              <div className="px-6 py-4 flex flex-col items-end justify-center border-r border-line-soft flex-1 xl:flex-none">
                <span className="text-[10px] font-bold text-[color:var(--color-success)] uppercase tracking-widest mb-0.5">
                  NET PAY
                </span>
                <span className="tabular-nums text-lg font-black text-[color:var(--color-success)]">
                  ₹{fmt(totals.netSalary)}
                </span>
              </div>

              {totalCashInHand > 0 && (
                <div className="px-6 py-4 flex flex-col items-end justify-center bg-[color-mix(in_srgb,var(--color-accent)_24%,transparent)] flex-1 xl:flex-none">
                  <span className="text-[10px] font-bold text-accent uppercase tracking-widest mb-0.5">
                    CASH IN HAND
                  </span>
                  <span className="tabular-nums text-lg font-black text-accent">
                    ₹{fmt(totalCashInHand)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4 print:hidden">
        {[
          {
            label: "Total Gross",
            value: `₹${fmt(totals.earnedSalary + totals.otPay)}`,
            color: "text-ink",
          },
          {
            label: "Total Deductions",
            value: `₹${fmt(totals.salaryAdvance + totals.permissionDeduction)}`,
            color: "text-[color:var(--color-danger)]",
          },
          {
            label: "Total Net Payable",
            value: `₹${fmt(totals.netSalary)}`,
            color: "text-primary font-bold",
          },
          ...(totalCashInHand > 0
            ? [
                {
                  label: "Cash in Hand",
                  value: `₹${fmt(totalCashInHand)}`,
                  color: "text-accent font-bold",
                },
              ]
            : []),
          {
            label: "Employees",
            value: String(filtered.length),
            color: "text-ink",
          },
        ].map((c) => (
          <div key={c.label} className="sl-tile p-4">
            <p className="text-xs text-ink-subtle uppercase tracking-wider font-semibold">
              {c.label}
            </p>
            <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Payslip Modal */}
      {payslipTarget && (
        <PayslipModal
          runId={payslipTarget.runId}
          resultId={payslipTarget.resultId}
          period={payslipTarget.period}
          type={payslipTarget.type}
          onClose={() => setPayslipTarget(null)}
        />
      )}
    </div>
  );
};

export default WeeklyPayrollReport;
