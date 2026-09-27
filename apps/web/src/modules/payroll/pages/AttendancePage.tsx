import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Save, RefreshCw, Users, PlayCircle, CalendarDays, Lock } from "lucide-react";
import CommonLoader from "../../../components/ui/Loader/CommonLoader";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  Tile,
} from "../../../components/ui/v2";
import { Notice, periodLabel } from "../components/peopleUi";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { payrollService } from "../../../services/payrollService";
import type { ApiEmployeePayroll, ApiPayrollConfig } from "../../../services/payrollService";
import { shiftService } from "../../../services/shiftService";
import type { Shift } from "../../../features/shifts/types";
import { usePermission } from "../../../hooks/usePermission";

// ─── Status Config ────────────────────────────────────────────────────────────
const STATUSES = [
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "WEEKLY_OFF",
  "HOLIDAY",
  "LEAVE_PAID",
  "LEAVE_UNPAID",
] as const;
type AttStatus = (typeof STATUSES)[number];

const S: Record<AttStatus, { abbr: string; label: string; cell: string }> = {
  PRESENT: {
    abbr: "P",
    label: "Present",
    cell: "bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[color:var(--color-success)]",
  },
  ABSENT: {
    abbr: "A",
    label: "Absent",
    cell: "bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[color:var(--color-danger)]",
  },
  HALF_DAY: {
    abbr: "HD",
    label: "Half Day",
    cell: "bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] text-[color:var(--color-warning)]",
  },
  WEEKLY_OFF: { abbr: "WO", label: "Weekly Off", cell: "bg-line-soft text-ink-muted" },
  HOLIDAY: {
    abbr: "H",
    label: "Holiday",
    cell: "bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-[color:var(--color-accent)]",
  },
  LEAVE_PAID: {
    abbr: "LP",
    label: "Leave (Paid)",
    cell: "bg-[color-mix(in_srgb,var(--chart-series-4)_18%,transparent)] text-[color:var(--chart-series-4)]",
  },
  LEAVE_UNPAID: {
    abbr: "LU",
    label: "Leave (Unpaid)",
    cell: "bg-[color-mix(in_srgb,var(--color-warning)_32%,transparent)] text-[color:var(--color-warning)]",
  },
};

const CYCLE: (AttStatus | null)[] = [
  null,
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "WEEKLY_OFF",
  "HOLIDAY",
  "LEAVE_PAID",
  "LEAVE_UNPAID",
];

// ─── Types ────────────────────────────────────────────────────────────────────
type CellData = {
  status: AttStatus | null;
  otHours: number;
  lateMinutes: number;
  permissionMinutes: number;
  shiftId: number | null;
};
type GridState = Record<string, CellData>;

const EMPTY_CELL: CellData = {
  status: null,
  otHours: 0,
  lateMinutes: 0,
  permissionMinutes: 0,
  shiftId: null,
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthDates(year: number, month: number): string[] {
  const totalDays = new Date(year, month, 0).getDate();
  return Array.from({ length: totalDays }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getDay();
}

function cycleStatus(cur: AttStatus | null): AttStatus | null {
  if (cur === "WEEKLY_OFF") return "PRESENT";
  const i = CYCLE.indexOf(cur);
  return CYCLE[(i + 1) % CYCLE.length];
}

function cellKey(empId: number, date: string) {
  return `${empId}_${date}`;
}

/** ISO week number of a date */
function isoWeekOf(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dow);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** ISO week-year (year the ISO week belongs to) */
function isoWeekYear(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dow);
  return d.getFullYear();
}

/** ISO week period string e.g. "2026-W32" */
function isoPeriod(dateStr: string): string {
  return `${isoWeekYear(dateStr)}-W${String(isoWeekOf(dateStr)).padStart(2, "0")}`;
}

/** All "weeks of month" – groups of 7 days starting from day 1 */
type WeekOfMonth = { num: number; dates: string[]; label: string; period: string };

function weeksOfMonth(year: number, month: number): WeekOfMonth[] {
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const lastDayOfMonth = new Date(year, month, 0);

  const firstDow = firstDayOfMonth.getDay() || 7; // Mon=1 ... Sun=7
  const firstMonday = new Date(firstDayOfMonth);
  firstMonday.setDate(firstDayOfMonth.getDate() - (firstDow - 1));

  const result: WeekOfMonth[] = [];
  const currentMonday = new Date(firstMonday);
  let w = 1;

  while (currentMonday <= lastDayOfMonth) {
    const dates: string[] = [];
    const sun = new Date(currentMonday);
    sun.setDate(currentMonday.getDate() + 6);

    for (let i = 0; i < 7; i++) {
      const d = new Date(currentMonday);
      d.setDate(currentMonday.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      dates.push(`${yyyy}-${mm}-${dd}`);
    }

    const period = isoPeriod(dates[0]);
    const startFmt = `${MONTHS[currentMonday.getMonth()].slice(0, 3)} ${currentMonday.getDate()}`;
    const endFmt = `${MONTHS[sun.getMonth()].slice(0, 3)} ${sun.getDate()}`;

    result.push({
      num: w,
      dates,
      period,
      label: `Week ${w} (${startFmt} – ${endFmt})`,
    });

    currentMonday.setDate(currentMonday.getDate() + 7);
    w++;
  }

  return result;
}

// ─── Status Cell ──────────────────────────────────────────────────────────────
const StatusCell: React.FC<{
  cell: CellData;
  isLocked?: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}> = ({ cell, isLocked, onClick, onContextMenu }) => {
  const hasExtra = cell.otHours > 0 || cell.lateMinutes > 0 || cell.permissionMinutes > 0;
  return (
    <div className="relative inline-flex">
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={isLocked}
        className={`w-[32px] h-[28px] rounded flex items-center justify-center font-bold text-[9px] transition-all select-none ${
          isLocked
            ? cell.status
              ? `${S[cell.status].cell} opacity-90 cursor-not-allowed border border-line`
              : "bg-line-soft text-ink-muted cursor-not-allowed opacity-90 border border-line"
            : cell.status
              ? S[cell.status].cell
              : "bg-card-2 text-ink-subtle hover:bg-line-soft"
        }`}
        title={
          isLocked
            ? `Locked (Payroll Approved) — ${cell.status ? S[cell.status].label : "Unset"}`
            : "Left-click: cycle status | Right-click: edit OT / Late / Perm / Shift"
        }
      >
        {cell.status ? S[cell.status].abbr : "—"}
      </button>
      {hasExtra && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] pointer-events-none" />
      )}
    </div>
  );
};

// ─── Cell Edit Panel ──────────────────────────────────────────────────────────
const CellEditPanel: React.FC<{
  empName: string;
  date: string;
  cell: CellData;
  isLocked?: boolean;
  shifts: Shift[];
  onChange: (c: CellData) => void;
  onClose: () => void;
}> = ({ empName, date, cell, isLocked, shifts, onChange, onClose }) => {
  const showExtras = cell.status === "PRESENT" || cell.status === "HALF_DAY";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-ink text-sm">{empName}</p>
            <p className="text-xs text-ink-subtle">
              {date} · {DAY_FULL[dayOfWeek(date)]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-lg text-ink-subtle hover:text-ink"
          >
            ×
          </button>
        </div>

        {isLocked && (
          <div className="flex items-center gap-2 bg-[color-mix(in_srgb,var(--color-warning)_9%,transparent)] border border-[color-mix(in_srgb,var(--color-warning)_32%,transparent)] text-[color:var(--color-warning)] text-xs px-3 py-2 rounded-xl font-medium">
            <Lock size={14} className="shrink-0" />
            <span>This date is locked because payroll has been approved. Editing is disabled.</span>
          </div>
        )}

        {/* Status grid */}
        <div>
          <p className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-2">
            Status
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {STATUSES.map((st) => (
              <button
                key={st}
                disabled={isLocked}
                onClick={() => onChange({ ...cell, status: cell.status === st ? null : st })}
                className={`py-1.5 rounded-lg text-[10px] font-bold transition-all border-2 ${
                  cell.status === st
                    ? `${S[st].cell} border-transparent`
                    : "bg-card text-ink-subtle border-line-soft hover:border-line"
                } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {S[st].abbr}
              </button>
            ))}
            <button
              disabled={isLocked}
              onClick={() => onChange({ ...cell, status: null })}
              className={`py-1.5 rounded-lg text-[10px] font-bold border-2 transition-all ${
                cell.status === null
                  ? "bg-ink text-page border-transparent"
                  : "bg-card text-ink-subtle border-line-soft hover:border-line"
              } ${isLocked ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              —
            </button>
          </div>
        </div>

        {/* Shift selector — only for Present or Half Day */}
        {showExtras && shifts.length > 0 && (
          <SelectInput
            label="Shift"
            name="shiftId"
            value={cell.shiftId ?? ""}
            defaultOptionLabel="— No Shift —"
            disabled={isLocked}
            noMargin
            searchable={false}
            options={shifts.map((sh) => ({
              value: sh.id,
              label: `${sh.shiftName} (${sh.startTime} – ${sh.endTime})`,
            }))}
            onChange={(e) =>
              onChange({ ...cell, shiftId: e.target.value ? Number(e.target.value) : null })
            }
          />
        )}

        {/* OT / Late / Permission — only for Present or Half Day */}
        {showExtras && (
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { label: "OT Hours", field: "otHours", step: 0.5 },
                { label: "Late (min)", field: "lateMinutes", step: 1 },
                { label: "Perm (min)", field: "permissionMinutes", step: 1 },
              ] as const
            ).map((f) => (
              <div key={f.field}>
                <label className="block text-xs font-semibold text-ink-subtle mb-1">
                  {f.label}
                </label>
                <input
                  type="number"
                  min={0}
                  step={f.step}
                  disabled={isLocked}
                  value={cell[f.field]}
                  onChange={(e) => onChange({ ...cell, [f.field]: Number(e.target.value) })}
                  className="w-full border border-line-soft rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:bg-card-2 disabled:text-ink-muted disabled:cursor-not-allowed"
                />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-2.5 bg-primary text-[color:var(--color-on-primary)] rounded-xl font-semibold text-sm hover:bg-[var(--color-danger)] transition-colors"
        >
          {isLocked ? "Close" : "Done"}
        </button>
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────
const AttendancePage: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const canEditAttendance = can("payroll-attendance.edit");
  const now = new Date();

  // ── Period state ──────────────────────────────────────────────────────────
  const [runType, setRunType] = useState<"MONTHLY" | "WEEKLY">("MONTHLY");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [weekOfMonth, setWeekOfMonth] = useState(1); // 1-5, week within selected month
  const [fullMonthMode, setFullMonthMode] = useState(false); // show all days of month in WEEKLY view

  // ── Data state ────────────────────────────────────────────────────────────
  const [employees, setEmployees] = useState<ApiEmployeePayroll[]>([]);
  const [payrollCfg, setPayrollCfg] = useState<ApiPayrollConfig | null>(null);
  const [grid, setGrid] = useState<GridState>({});
  const [loading, setLoading] = useState(true);
  const [loadingAtt, setLoadingAtt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState("");
  const [hasSavedData, setHasSavedData] = useState(false);
  const [lockedPeriods, setLockedPeriods] = useState<string[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);

  // ── Cell panel ────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<{ empId: number; empName: string; date: string } | null>(
    null
  );

  // ── Derived: employees filtered by salary type ────────────────────────────
  const isWeeklyEmployee = (e: ApiEmployeePayroll) =>
    e.payrollConfig?.salaryType === "DAILY_WEEKLY" ||
    e.payrollConfig?.salaryType === "WEEKLY" ||
    e.salaryType === "daily" ||
    e.salaryType === "weekly";

  const filteredEmployees = useMemo((): ApiEmployeePayroll[] => {
    if (runType === "MONTHLY") {
      // Monthly view: all employees EXCEPT daily/weekly wage
      return employees.filter((e) => !isWeeklyEmployee(e));
    } else {
      // Weekly view: only daily/weekly wage employees
      return employees.filter((e) => isWeeklyEmployee(e));
    }
  }, [employees, runType]);

  // ── Derived: weeks within the selected month ──────────────────────────────
  const monthWeeks = useMemo(() => weeksOfMonth(year, month), [year, month]);

  // ── Derived: active dates to display ─────────────────────────────────────
  const dates = useMemo(() => {
    if (runType === "MONTHLY") return getMonthDates(year, month);
    if (fullMonthMode) return getMonthDates(year, month); // all days, weekly employees
    const wk = monthWeeks.find((w) => w.num === weekOfMonth) ?? monthWeeks[0];
    return wk?.dates ?? [];
  }, [runType, year, month, weekOfMonth, monthWeeks, fullMonthMode]);

  // ── Derived: period string (used for single-week save & load) ─────────────
  const period = useMemo(() => {
    if (runType === "MONTHLY") return `${year}-${String(month).padStart(2, "0")}`;
    if (fullMonthMode) return `${year}-${String(month).padStart(2, "0")}`; // date-range query
    const wk = monthWeeks.find((w) => w.num === weekOfMonth) ?? monthWeeks[0];
    return wk?.period ?? `${year}-W01`;
  }, [runType, year, month, weekOfMonth, monthWeeks, fullMonthMode]);

  const weeklyOffDays: number[] = payrollCfg?.weeklyOffDays ?? [];

  // Helper to check if a date is locked by an approved/locked payroll run
  // Only check locks matching the current run type so a weekly lock doesn't block monthly editing and vice-versa
  const isDateLocked = useCallback(
    (dateStr: string): boolean => {
      if (lockedPeriods.length === 0) return false;
      if (runType === "MONTHLY") {
        const monthP = dateStr.slice(0, 7);
        return lockedPeriods.includes(monthP);
      }
      const weekP = isoPeriod(dateStr);
      return lockedPeriods.includes(weekP);
    },
    [lockedPeriods, runType]
  );

  const allDatesLocked = useMemo(
    () => dates.length > 0 && dates.every((d) => isDateLocked(d)),
    [dates, isDateLocked]
  );
  const someDatesLocked = useMemo(() => dates.some((d) => isDateLocked(d)), [dates, isDateLocked]);

  // ── Load employees + config + shifts ───────────────────────────────────────
  useEffect(() => {
    Promise.all([
      payrollService.listEmployees(),
      payrollService.getConfig(),
      shiftService.fetchAll(),
    ])
      .then(([emps, cfg, allShifts]) => {
        setEmployees(emps);
        setPayrollCfg(cfg);
        setShifts(allShifts.filter((s) => s.isActive));
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  // ── Rebuild grid when dates / filtered employees change ───────────────────
  useEffect(() => {
    if (filteredEmployees.length === 0) return;
    setGrid((prev) => {
      const next: GridState = {};
      filteredEmployees.forEach((emp) => {
        dates.forEach((date) => {
          const k = cellKey(Number(emp.id), date);
          const isSun = dayOfWeek(date) === 0 || weeklyOffDays.includes(dayOfWeek(date));
          if (prev[k]) {
            next[k] = prev[k];
          } else {
            next[k] = { ...EMPTY_CELL, status: isSun ? "WEEKLY_OFF" : null };
          }
        });
      });
      return next;
    });
    setHasSavedData(false);
    setSaveOk(false);
  }, [dates, filteredEmployees, weeklyOffDays]);

  // ── Reset weekOfMonth to 1 when month/year changes ───────────────────────
  useEffect(() => {
    setWeekOfMonth(1);
  }, [month, year]);

  // ── Load saved attendance from API ────────────────────────────────────────
  const loadSaved = useCallback(async () => {
    setLoadingAtt(true);
    setSaveOk(false);
    setError("");
    try {
      const records: any[] = await payrollService.getAttendance(period);
      if (records.length > 0) {
        setGrid((prev) => {
          const next = { ...prev };
          records.forEach((r) => {
            const k = cellKey(Number(r.employeeId), r.date);
            if (k in next) {
              next[k] = {
                status: r.status as AttStatus,
                otHours: Number(r.otHours),
                lateMinutes: Number(r.lateMinutes),
                permissionMinutes: Number(r.permissionMinutes),
                shiftId: r.shiftId ?? null,
              };
            }
          });
          return next;
        });
        setHasSavedData(true);
      } else {
        setHasSavedData(false);
      }

      // Check if period or month is locked/approved
      try {
        const monthQuery = `${year}-${String(month).padStart(2, "0")}`;
        const runRes = await payrollService.listRuns({ period: monthQuery });
        const lockedList = runRes.runs
          .filter((r) => r.status === "APPROVED" || r.status === "LOCKED")
          .map((r) => r.period);
        setLockedPeriods(lockedList);
      } catch {
        setLockedPeriods([]);
      }
    } catch {
      // No saved records is fine
    } finally {
      setLoadingAtt(false);
    }
  }, [period, year, month]);

  useEffect(() => {
    if (!loading) loadSaved();
  }, [period, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cell helpers ──────────────────────────────────────────────────────────
  const getCell = (empId: number, date: string): CellData =>
    grid[cellKey(empId, date)] ?? EMPTY_CELL;

  const setCell = (empId: number, date: string, data: CellData) => {
    if (isDateLocked(date)) return;
    setGrid((prev) => ({ ...prev, [cellKey(empId, date)]: data }));
    setSaveOk(false);
  };

  const cycleCell = (empId: number, date: string) => {
    if (isDateLocked(date)) return;
    const cur = getCell(empId, date);
    setCell(empId, date, { ...cur, status: cycleStatus(cur.status) });
  };

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const applyCompanySchedule = () => {
    setGrid((prev) => {
      const next = { ...prev };
      filteredEmployees.forEach((emp) => {
        dates.forEach((date) => {
          if (!isDateLocked(date)) {
            const k = cellKey(Number(emp.id), date);
            const isOff = dayOfWeek(date) === 0 || weeklyOffDays.includes(dayOfWeek(date));
            next[k] = { ...(next[k] ?? EMPTY_CELL), status: isOff ? "WEEKLY_OFF" : "PRESENT" };
          }
        });
      });
      return next;
    });
    setSaveOk(false);
  };

  const clearAll = () => {
    setGrid((prev) => {
      const next = { ...prev };
      filteredEmployees.forEach((emp) => {
        dates.forEach((date) => {
          if (!isDateLocked(date)) {
            const k = cellKey(Number(emp.id), date);
            const isOff = dayOfWeek(date) === 0 || weeklyOffDays.includes(dayOfWeek(date));
            next[k] = { ...EMPTY_CELL, status: isOff ? "WEEKLY_OFF" : null };
          }
        });
      });
      return next;
    });
    setSaveOk(false);
  };

  const markEmployeeRow = (empId: number, status: AttStatus) => {
    setGrid((prev) => {
      const next = { ...prev };
      dates.forEach((date) => {
        if (!isDateLocked(date)) {
          const k = cellKey(empId, date);
          const isOff = dayOfWeek(date) === 0 || weeklyOffDays.includes(dayOfWeek(date));
          if (status === "PRESENT" && isOff) {
            next[k] = { ...(next[k] ?? EMPTY_CELL), status: "WEEKLY_OFF" };
          } else {
            next[k] = { ...(next[k] ?? EMPTY_CELL), status };
          }
        }
      });
      return next;
    });
    setSaveOk(false);
  };

  // ── Build records for a given set of dates / period ───────────────────────
  const buildRecords = (empList: ApiEmployeePayroll[], dayList: string[], p: string) =>
    empList
      .flatMap((emp) =>
        dayList
          .map((date) => {
            if (isDateLocked(date)) return null;
            const c = getCell(Number(emp.id), date);
            if (!c.status) return null;
            return {
              employeeId: Number(emp.id),
              date,
              status: c.status,
              otHours: c.otHours,
              lateMinutes: c.lateMinutes,
              permissionMinutes: c.permissionMinutes,
              salaryAdvance: 0,
              shiftId: c.shiftId,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null)
      )
      .map((r) => ({ ...r, _period: p })); // carry period for multi-save

  // ── Build list of cleared (null status) cells to delete from DB ─────────
  const buildClearedDates = (empList: ApiEmployeePayroll[], dayList: string[]) =>
    empList.flatMap((emp) =>
      dayList
        .filter((date) => !isDateLocked(date) && !getCell(Number(emp.id), date).status)
        .map((date) => ({ employeeId: Number(emp.id), date }))
    );

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaveOk(false);
    try {
      if (allDatesLocked) {
        setError(
          "Cannot save attendance. Payroll for this period has already been approved or locked."
        );
        return;
      }

      // Collect cleared cells to delete from DB
      const clearedDates = buildClearedDates(
        filteredEmployees,
        dates.filter((d) => !isDateLocked(d))
      );

      if (runType === "WEEKLY" && fullMonthMode) {
        // ── Full-month save for weekly employees ─────────────────────────
        const weekGroups = new Map<string, string[]>();
        dates.forEach((date) => {
          if (!isDateLocked(date)) {
            const wp = isoPeriod(date);
            if (!weekGroups.has(wp)) weekGroups.set(wp, []);
            weekGroups.get(wp)!.push(date);
          }
        });

        let totalSaved = 0;
        for (const [wp, wDates] of weekGroups) {
          const records = buildRecords(filteredEmployees, wDates, wp);
          if (records.length > 0) {
            await payrollService.bulkUpsertAttendance(wp, records as any, clearedDates);
            totalSaved += records.length;
          }
        }
        if (totalSaved === 0 && clearedDates.length === 0) {
          setError("No editable attendance data to save. Mark at least one unlocked cell.");
          return;
        }
        if (totalSaved === 0 && clearedDates.length > 0) {
          // Only clearing — still need to send the delete request
          await payrollService.bulkUpsertAttendance(period, [], clearedDates);
        }
        setSaveOk(true);
        setHasSavedData(true);
      } else {
        // ── Normal single-period save ─────────────────────────────────────
        const editableDates = dates.filter((d) => !isDateLocked(d));
        const records = buildRecords(filteredEmployees, editableDates, period);
        if (records.length === 0 && clearedDates.length === 0) {
          setError("No editable attendance data to save. Mark at least one unlocked cell.");
          return;
        }
        await payrollService.bulkUpsertAttendance(period, records as any, clearedDates);
        setSaveOk(true);
        setHasSavedData(true);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  // ── Summary per employee ──────────────────────────────────────────────────
  const summary = (empId: number) => {
    let P = 0,
      A = 0,
      HD = 0,
      WO = 0,
      OT = 0,
      Late = 0;
    dates.forEach((date) => {
      const c = getCell(empId, date);
      if (c.status === "PRESENT") P++;
      if (c.status === "ABSENT") A++;
      if (c.status === "HALF_DAY") HD++;
      if (c.status === "WEEKLY_OFF") WO++;
      OT += c.otHours;
      Late += c.lateMinutes;
    });
    return { P, A, HD, WO, OT, Late };
  };

  const totalMarked = useMemo(() => {
    let count = 0;
    filteredEmployees.forEach((emp) => {
      dates.forEach((date) => {
        if (getCell(Number(emp.id), date).status !== null) count++;
      });
    });
    return count;
  }, [grid, filteredEmployees, dates]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCells = filteredEmployees.length * dates.length;

  // ─────────────────────────────────────────────────────────────────────────
  if (loading) return <CommonLoader text="Loading employees and payroll settings…" />;

  const statusTotals = filteredEmployees.reduce(
    (acc, emp) => {
      const sm = summary(Number(emp.id));
      return { P: acc.P + sm.P, A: acc.A + sm.A, HD: acc.HD + sm.HD, WO: acc.WO + sm.WO };
    },
    { P: 0, A: 0, HD: 0, WO: 0 }
  );

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 py-1 sm:py-2">
      <PageHeader
        className="!mb-1"
        title="Attendance Entry"
        back="/payroll"
        backLabel="Back to payroll"
        breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Attendance" }]}
        subtitle={
          <>
            {periodLabel(period)} · {filteredEmployees.length} employees
            {totalCells > 0 && (
              <span className="text-ink-subtle">
                {" "}
                · {totalMarked}/{totalCells} cells marked
              </span>
            )}
          </>
        }
        actions={
          <>
            <ActionPill
              variant="secondary"
              onClick={loadSaved}
              disabled={loadingAtt}
              icon={<RefreshCw size={15} className={loadingAtt ? "animate-spin" : ""} />}
            >
              Load Saved
            </ActionPill>
            <ActionPill
              variant="secondary"
              icon={<PlayCircle size={15} />}
              onClick={() =>
                navigate(`/payroll/run?type=${runType === "MONTHLY" ? "monthly" : "weekly"}`)
              }
            >
              Run Payroll
            </ActionPill>
          </>
        }
        primaryAction={
          canEditAttendance ? (
            <ActionPill
              onClick={handleSave}
              disabled={allDatesLocked}
              loading={saving}
              loadingText="Saving…"
              icon={<Save size={16} />}
            >
              {runType === "WEEKLY" && fullMonthMode ? "Save Full Month" : "Save Attendance"}
            </ActionPill>
          ) : undefined
        }
      />

      {allDatesLocked ? (
        <Notice tone="danger" title={`Attendance for ${period} is locked`}>
          Payroll has been approved or locked, so attendance cannot be edited for this period.
        </Notice>
      ) : someDatesLocked ? (
        <Notice tone="warning" title="Some dates are locked">
          Period(s) <strong>{lockedPeriods.join(", ")}</strong> have approved payroll. Locked dates
          cannot be edited; unlocked dates remain editable.
        </Notice>
      ) : null}

      {saveOk && (
        <Notice tone="success">
          Attendance saved for <strong>{period}</strong>.
          {runType === "WEEKLY" && fullMonthMode && " (Split across weekly periods automatically.)"}
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      {/* ── Controls ── */}
      <Tile padding="sm">
        <div className="flex flex-wrap items-center gap-3">
          <ChipTabs
            ariaLabel="Pay frequency"
            value={runType}
            onChange={(t) => {
              setRunType(t);
              setFullMonthMode(false);
              setSaveOk(false);
            }}
            items={[
              { key: "MONTHLY", label: "Monthly" },
              { key: "WEEKLY", label: "Weekly" },
            ]}
          />

          <div className="flex items-center gap-2">
            <div className="w-36">
              <SelectInput
                name="month"
                value={String(month)}
                options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                noMargin
                onChange={(e) => setMonth(Number(e.target.value))}
              />
            </div>
            <div className="w-28">
              <SelectInput
                name="year"
                value={String(year)}
                options={[2024, 2025, 2026, 2027].map((y) => ({
                  value: String(y),
                  label: String(y),
                }))}
                noMargin
                onChange={(e) => setYear(Number(e.target.value))}
              />
            </div>
          </div>

          {runType === "WEEKLY" && (
            <>
              {!fullMonthMode && (
                <div className="w-52">
                  <SelectInput
                    name="weekOfMonth"
                    value={String(weekOfMonth)}
                    options={monthWeeks.map((w) => ({ value: String(w.num), label: w.label }))}
                    noMargin
                    onChange={(e) => setWeekOfMonth(Number(e.target.value))}
                  />
                </div>
              )}
              <Chip
                icon={<CalendarDays size={14} />}
                selected={fullMonthMode}
                onClick={() => {
                  setFullMonthMode((f) => !f);
                  setSaveOk(false);
                }}
              >
                {fullMonthMode ? "Full Month ON" : "Full Month"}
              </Chip>
              {fullMonthMode && (
                <Chip tone="warning" size="sm">
                  All {dates.length} days · saves into {monthWeeks.length} weekly periods
                </Chip>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <ActionPill
              variant="secondary"
              size="sm"
              onClick={applyCompanySchedule}
              disabled={allDatesLocked}
            >
              Auto-Fill Schedule
            </ActionPill>
            <ActionPill variant="ghost" size="sm" onClick={clearAll} disabled={allDatesLocked}>
              Clear All
            </ActionPill>
          </div>
        </div>

        {/* Counts + legend */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
          <Chip tone="success" size="sm" count={statusTotals.P}>
            Present
          </Chip>
          <Chip tone="danger" size="sm" count={statusTotals.A}>
            Absent
          </Chip>
          <Chip tone="warning" size="sm" count={statusTotals.HD}>
            Half-day
          </Chip>
          <Chip tone="muted" size="sm" count={statusTotals.WO}>
            Weekly off
          </Chip>
          <span className="mx-1 hidden h-4 w-px bg-line-soft sm:block" aria-hidden="true" />
          {STATUSES.map((st) => (
            <span key={st} className="flex items-center gap-1">
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${S[st].cell}`}>
                {S[st].abbr}
              </span>
              <span className="text-[11px] text-ink-muted">{S[st].label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="rounded-md border border-line-soft bg-card-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">
              —
            </span>
            <span className="text-[11px] text-ink-subtle">Unset</span>
          </span>
          <span className="flex items-center gap-1">
            <Lock size={11} className="text-ink-subtle" aria-hidden="true" />
            <span className="text-[11px] text-ink-subtle">Payroll approved</span>
          </span>
          <span className="ml-auto text-[11px] text-ink-subtle">
            Click to cycle · right-click for OT / late / permission
          </span>
        </div>
      </Tile>

      {hasSavedData && (
        <Notice tone="info">
          Showing saved attendance for <strong>{period}</strong>. Changes overwrite it on the next
          save.
        </Notice>
      )}

      {/* ── Week divider labels in full-month mode ── */}
      {runType === "WEEKLY" && fullMonthMode && (
        <div className="flex flex-wrap gap-2">
          {monthWeeks.map((w) => {
            const isWkLocked =
              lockedPeriods.includes(w.period) ||
              lockedPeriods.includes(`${year}-${String(month).padStart(2, "0")}`);
            return (
              <span
                key={w.num}
                className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-md px-2 py-0.5 ${
                  isWkLocked
                    ? "bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] text-[color:var(--color-warning)] border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)]"
                    : "bg-card text-ink-muted border-line-soft"
                }`}
              >
                <span className="w-3 h-3 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[8px] font-bold">
                  {w.num}
                </span>
                {w.label.replace(`Week ${w.num}  `, "")} →{" "}
                <span className="text-primary font-bold">{w.period}</span>
                {isWkLocked && (
                  <Lock size={10} className="text-[color:var(--color-warning)] ml-0.5" />
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Grid ── */}
      <div className="flex-1 overflow-hidden">
        {filteredEmployees.length === 0 ? (
          <div className="sl-tile">
            <EmptyState
              icon={<Users size={28} strokeWidth={1.75} />}
              title={employees.length === 0 ? "No employees yet" : "Nobody on this pay frequency"}
              description={
                employees.length === 0
                  ? "No employees found."
                  : runType === "MONTHLY"
                    ? "No monthly employees found. Switch to Weekly tab for daily-wage employees."
                    : "No daily-wage (DAILY_WEEKLY) employees found. Switch to Monthly tab for monthly employees."
              }
            />
          </div>
        ) : (
          <div className="sl-tile overflow-hidden h-full">
            <div className="overflow-auto h-full">
              <table
                className="text-xs border-collapse"
                style={{ minWidth: `${220 + dates.length * 40 + 200}px` }}
              >
                {/* THEAD */}
                <thead className="sticky top-0 z-20">
                  <tr className="bg-card-2">
                    <th
                      className="sticky left-0 z-30 bg-card-2 text-left px-4 py-2.5 font-semibold text-ink-muted uppercase tracking-wider border-b border-r border-line-soft"
                      style={{ minWidth: 220 }}
                    >
                      Employee
                    </th>
                    {dates.map((date, idx) => {
                      const day = parseInt(date.split("-")[2], 10);
                      const dow = dayOfWeek(date);
                      const isOff = weeklyOffDays.includes(dow);
                      const isSun = dow === 0;
                      const isWeekStart =
                        fullMonthMode &&
                        runType === "WEEKLY" &&
                        (day === 8 || day === 15 || day === 22 || day === 29);
                      const locked = isDateLocked(date);
                      return (
                        <th
                          key={date}
                          className={`px-0 py-2 text-center font-semibold border-b border-r border-line-soft ${
                            isWeekStart ? "border-l-2 border-l-primary/40" : ""
                          } ${locked ? "bg-card-2/80" : isOff ? (isSun ? "bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]" : "bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)]") : "bg-card-2"}`}
                          style={{ width: 38, minWidth: 38 }}
                          title={
                            locked
                              ? "Payroll Approved/Locked"
                              : isWeekStart
                                ? `Week ${Math.ceil(day / 7)} starts`
                                : undefined
                          }
                        >
                          <div
                            className={`text-[11px] font-bold flex items-center justify-center gap-0.5 ${locked ? "text-ink-subtle" : isOff ? (isSun ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-warning)]") : "text-ink"}`}
                          >
                            {day}
                            {locked && <Lock size={8} className="text-ink-subtle" />}
                          </div>
                          <div
                            className={`text-[9px] ${locked ? "text-ink-subtle" : isOff ? (isSun ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-warning)]") : "text-ink-subtle"}`}
                          >
                            {DAY_ABBR[dow]}
                          </div>
                          {isWeekStart && (
                            <div className="text-[8px] text-primary font-bold">
                              W{Math.ceil(day / 7)}
                            </div>
                          )}
                        </th>
                      );
                    })}
                    {/* Summary */}
                    <th className="px-2 py-2 text-center font-bold text-[color:var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] border-b border-r border-line-soft">
                      P
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-[color:var(--color-danger)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] border-b border-r border-line-soft">
                      A
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-[color:var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] border-b border-r border-line-soft">
                      HD
                    </th>
                    <th className="px-2 py-2 text-center font-bold text-ink-muted bg-card-2 border-b border-r border-line-soft">
                      WO
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-ink-subtle bg-card-2 border-b border-r border-line-soft whitespace-nowrap">
                      OT h
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-ink-subtle bg-card-2 border-b border-line-soft whitespace-nowrap">
                      Late
                    </th>
                  </tr>
                </thead>

                {/* TBODY */}
                <tbody>
                  {filteredEmployees.map((emp, idx) => {
                    const empId = Number(emp.id);
                    const sum = summary(empId);
                    const rowBg = idx % 2 === 0 ? "bg-card" : "bg-card-2/40";
                    return (
                      <tr
                        key={emp.id}
                        className={`${rowBg} hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] transition-colors`}
                      >
                        {/* Employee sticky col */}
                        <td
                          className={`sticky left-0 z-10 px-3 py-1.5 border-b border-r border-line-soft ${rowBg}`}
                          style={{ minWidth: 220 }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-ink text-xs truncate">
                                {emp.fullName}
                              </p>
                              <p className="text-[10px] text-ink-subtle">
                                {emp.empCode} ·{" "}
                                {(emp.payrollConfig?.salaryType ?? "—").replace(/_/g, " ")}
                              </p>
                            </div>
                            <div className="flex gap-0.5 shrink-0">
                              <button
                                onClick={() => markEmployeeRow(empId, "PRESENT")}
                                title="All Present"
                                disabled={allDatesLocked}
                                className="w-5 h-5 rounded text-[8px] font-bold bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] text-[color:var(--color-success)] hover:bg-[color-mix(in_srgb,var(--color-success)_30%,transparent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                P
                              </button>
                              <button
                                onClick={() => markEmployeeRow(empId, "ABSENT")}
                                title="All Absent"
                                disabled={allDatesLocked}
                                className="w-5 h-5 rounded text-[8px] font-bold bg-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] text-[color:var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                A
                              </button>
                            </div>
                          </div>
                        </td>

                        {/* Status cells */}
                        {dates.map((date) => {
                          const cell = getCell(empId, date);
                          const isCompanyOff = weeklyOffDays.includes(dayOfWeek(date));
                          const day = parseInt(date.split("-")[2], 10);
                          const isWeekStart =
                            fullMonthMode &&
                            runType === "WEEKLY" &&
                            (day === 8 || day === 15 || day === 22 || day === 29);
                          const locked = isDateLocked(date);
                          return (
                            <td
                              key={date}
                              className={`px-0.5 py-0.5 border-b border-r border-line-soft text-center ${
                                isWeekStart ? "border-l-2 border-l-primary/30" : ""
                              } ${locked ? "bg-card-2/80" : isCompanyOff && !cell.status ? "bg-card-2/40" : ""}`}
                            >
                              <StatusCell
                                cell={cell}
                                isLocked={locked}
                                onClick={() => setSelected({ empId, empName: emp.fullName, date })}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setSelected({ empId, empName: emp.fullName, date });
                                }}
                              />
                            </td>
                          );
                        })}

                        {/* Summary */}
                        <td className="px-2 py-1.5 text-center font-bold text-[color:var(--color-success)] border-b border-r border-line-soft">
                          {sum.P > 0 ? sum.P : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center font-bold text-[color:var(--color-danger)]   border-b border-r border-line-soft">
                          {sum.A > 0 ? sum.A : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center font-bold text-[color:var(--color-warning)] border-b border-r border-line-soft">
                          {sum.HD > 0 ? sum.HD : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center font-semibold text-ink-muted border-b border-r border-line-soft">
                          {sum.WO > 0 ? sum.WO : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center text-ink-subtle border-b border-r border-line-soft">
                          {sum.OT > 0 ? sum.OT.toFixed(1) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center text-ink-muted border-b border-line-soft">
                          {sum.Late > 0 ? `${sum.Late}m` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Cell Edit Panel ── */}
      {selected && (
        <CellEditPanel
          empName={selected.empName}
          date={selected.date}
          cell={getCell(selected.empId, selected.date)}
          isLocked={isDateLocked(selected.date)}
          shifts={shifts}
          onChange={(c) => setCell(selected.empId, selected.date, c)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
};

export default AttendancePage;
