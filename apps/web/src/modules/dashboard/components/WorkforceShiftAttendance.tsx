import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { LuMoon, LuRefreshCw, LuSun, LuUserCheck, LuUserX, LuUsers } from "react-icons/lu";
import { employeeService } from "../../../services/employeeService";
import { shiftService } from "../../../services/shiftService";
import { payrollService } from "../../../services/payrollService";
import { usePageSocketSync } from "../../../hooks/usePageSocketSync";
import { DashTile, TileHeader } from "./DashboardPrimitives";

/** Which of this tile's feeds the signed-in role may read; a feed it may not read is not requested. */
export interface WorkforceAccess {
  /** Payroll employees and monthly attendance (any payroll view key). */
  payroll: boolean;
  /** Shift list (shifts.view). */
  shifts: boolean;
}

interface WorkforceShiftAttendanceProps {
  employeesCount?: number;
  dailyPlans?: any[];
  weeklyPrograms?: any[];
  className?: string;
  access: WorkforceAccess;
}

export const WorkforceShiftAttendance: React.FC<WorkforceShiftAttendanceProps> = ({
  employeesCount: initialEmpCount = 0,
  className = "",
  access,
}) => {
  const canPayroll = access.payroll;
  const canShifts = access.shifts;
  const navigate = useNavigate();

  const [liveEmployees, setLiveEmployees] = useState<any[]>([]);
  const [liveShifts, setLiveShifts] = useState<any[]>([]);
  const [liveAttendanceRecords, setLiveAttendanceRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Current period in format "YYYY-MM" (e.g. "2026-09")
  const { currentPeriod, todayStr } = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return {
      currentPeriod: `${y}-${m}`,
      todayStr: `${y}-${m}-${d}`,
    };
  }, []);

  // Prevent concurrent fetches triggered by rapid socket bursts
  const fetchingRef = useRef(false);

  const fetchLiveWorkforceData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      setIsLoading(true);
      const [empRes, shiftRes, attRes] = await Promise.allSettled([
        canPayroll
          ? payrollService.listEmployees
            ? payrollService.listEmployees()
            : employeeService.fetchAll({ limit: 100 })
          : Promise.resolve(null),
        canShifts && shiftService.fetchAll ? shiftService.fetchAll() : Promise.resolve([]),
        canPayroll && payrollService.getAttendance
          ? payrollService.getAttendance(currentPeriod)
          : Promise.resolve([]),
      ]);

      if (empRes.status === "fulfilled" && empRes.value) {
        const data = Array.isArray(empRes.value)
          ? empRes.value
          : (empRes.value as any)?.data || (empRes.value as any)?.employees || [];
        if (data.length > 0) setLiveEmployees(data);
      }

      if (shiftRes.status === "fulfilled" && shiftRes.value) {
        const data = Array.isArray(shiftRes.value) ? shiftRes.value : [];
        if (data.length > 0) setLiveShifts(data.filter((s: any) => s.isActive !== false));
      }

      if (attRes.status === "fulfilled" && attRes.value) {
        const data = Array.isArray(attRes.value) ? attRes.value : (attRes.value as any)?.data || [];
        setLiveAttendanceRecords(data);
      }
    } catch (err) {
      console.warn("Live workforce fetch fallback:", err);
    } finally {
      setIsLoading(false);
      fetchingRef.current = false;
    }
  }, [currentPeriod, canPayroll, canShifts]);

  useEffect(() => {
    fetchLiveWorkforceData();
  }, [fetchLiveWorkforceData]);

  // Real-time socket sync — ONE shared 300ms debounce across all 4 modules.
  // Replaces 4 separate useSocketSync calls that each had independent 50ms
  // timers, causing up to 4 concurrent refetches on a single save event.
  usePageSocketSync(["employee", "shift", "attendance", "dailyPlan"], fetchLiveWorkforceData);

  // Accurate Workforce Calculations
  const totalStaff = useMemo(() => {
    if (liveEmployees.length > 0) return liveEmployees.length;
    return initialEmpCount;
  }, [liveEmployees, initialEmpCount]);

  // Calculate Today's Real Attendance without any fake estimates
  const { presentCount, leaveCount, absentCount, notMarkedCount, isMarkedToday, turnoverRate } =
    useMemo(() => {
      const todayRecords = liveAttendanceRecords.filter((r: any) => {
        if (!r.date) return false;
        const d = String(r.date).split("T")[0];
        return d === todayStr;
      });

      let present = 0;
      let leave = 0;
      let absent = 0;

      if (todayRecords.length > 0) {
        todayRecords.forEach((r: any) => {
          const st = String(r.status || "").toUpperCase();
          if (st === "PRESENT" || st === "P" || st === "HALF_DAY") {
            present++;
          } else if (
            st === "LEAVE" ||
            st === "L" ||
            st === "CASUAL_LEAVE" ||
            st === "MEDICAL_LEAVE" ||
            st === "WEEKLY_OFF" ||
            st === "HOLIDAY"
          ) {
            leave++;
          } else if (st === "ABSENT" || st === "A") {
            absent++;
          }
        });
      }

      const isMarked = todayRecords.length > 0;
      const notMarked = Math.max(0, totalStaff - (present + leave + absent));
      const rate = isMarked && totalStaff > 0 ? Math.round((present / totalStaff) * 100) : 0;

      return {
        presentCount: present,
        leaveCount: leave,
        absentCount: absent,
        notMarkedCount: notMarked,
        isMarkedToday: isMarked,
        turnoverRate: rate,
      };
    }, [liveAttendanceRecords, totalStaff, todayStr]);

  // Shift Allocation based on today's real attendance and shifts
  const { shift1Name, shift1Count, shift1Time, shift2Name, shift2Count, shift2Time } =
    useMemo(() => {
      const s1 = liveShifts[0];
      const s2 = liveShifts[1];

      const shift1Title = s1?.shiftName || "Shift 1 (Day)";
      const shift1Hours = s1 ? `${s1.startTime} – ${s1.endTime}` : "08:00 AM – 04:30 PM";

      const shift2Title = s2?.shiftName || "Shift 2 (Night)";
      const shift2Hours = s2 ? `${s2.startTime} – ${s2.endTime}` : "08:00 PM – 04:30 AM";

      if (!isMarkedToday) {
        return {
          shift1Name: shift1Title,
          shift1Count: 0,
          shift1Time: shift1Hours,
          shift2Name: shift2Title,
          shift2Count: 0,
          shift2Time: shift2Hours,
        };
      }

      const todayRecords = liveAttendanceRecords.filter((r: any) => {
        if (!r.date) return false;
        const d = String(r.date).split("T")[0];
        return d === todayStr;
      });

      const s1Active = todayRecords.filter((r: any) => {
        const isPresent =
          String(r.status || "").toUpperCase() === "PRESENT" ||
          String(r.status || "").toUpperCase() === "HALF_DAY";
        return isPresent && (r.shiftId === s1?.id || !r.shiftId);
      }).length;

      const s2Active = todayRecords.filter((r: any) => {
        const isPresent =
          String(r.status || "").toUpperCase() === "PRESENT" ||
          String(r.status || "").toUpperCase() === "HALF_DAY";
        return isPresent && r.shiftId === s2?.id;
      }).length;

      return {
        shift1Name: shift1Title,
        shift1Count: s1Active,
        shift1Time: shift1Hours,
        shift2Name: shift2Title,
        shift2Count: s2Active,
        shift2Time: shift2Hours,
      };
    }, [liveShifts, liveAttendanceRecords, isMarkedToday, todayStr]);

  const stats: {
    key: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    value: React.ReactNode;
    note: React.ReactNode;
    to: string;
    title: string;
  }[] = [
    {
      key: "present",
      label: "Present today",
      icon: LuUserCheck,
      value: (
        <>
          {presentCount}
          <span className="ml-1 text-sm font-medium text-ink-subtle">/ {totalStaff}</span>
        </>
      ),
      note: isMarkedToday ? (
        <span className="sl-chip sl-chip-success px-2 py-0 text-[11px]">
          {turnoverRate}% present
        </span>
      ) : (
        <span className="sl-chip sl-chip-warning px-2 py-0 text-[11px]">Not marked yet</span>
      ),
      to: "/payroll/attendance",
      title: "View and mark today's attendance",
    },
    {
      key: "leave",
      label: "On leave / off",
      icon: LuUserX,
      value: (
        <>
          {leaveCount}
          {absentCount > 0 && (
            <span className="ml-1 text-sm font-medium text-ink-subtle">+{absentCount} absent</span>
          )}
        </>
      ),
      note: (
        <span className="sl-muted text-[11px]">
          {isMarkedToday ? "Leave, holiday and weekly off" : "Nothing recorded yet"}
        </span>
      ),
      to: "/payroll/attendance",
      title: "View approved leave and absences",
    },
    {
      key: "shift1",
      label: shift1Name,
      icon: LuSun,
      value: shift1Count,
      note: <span className="sl-muted text-[11px]">{shift1Time}</span>,
      to: "/shift-execution",
      title: `View ${shift1Name} on the shift execution board`,
    },
    {
      key: "shift2",
      label: shift2Name,
      icon: LuMoon,
      value: shift2Count,
      note: <span className="sl-muted text-[11px]">{shift2Time}</span>,
      to: "/shift-execution",
      title: `View ${shift2Name} on the shift execution board`,
    },
  ];

  return (
    <DashTile labelledBy="dash-workforce" className={className}>
      <TileHeader
        id="dash-workforce"
        icon={LuUsers}
        title="Workforce today"
        subtitle={
          <>
            Attendance and shifts · {totalStaff} staff
            {isLoading && (
              <LuRefreshCw
                aria-label="Refreshing"
                className="ml-1.5 inline animate-spin align-[-2px] motion-reduce:animate-none"
              />
            )}
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => navigate("/payroll/attendance")}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-chip"
            title="Open the attendance sheet"
          >
            Attendance →
          </button>
        }
      />
      <div className="grid flex-1 grid-cols-2 gap-3 px-5 pb-5">
        {stats.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => navigate(s.to)}
            title={s.title}
            className="flex min-w-0 flex-col gap-1.5 rounded-[14px] bg-card-2 p-3.5 text-left transition-colors hover:bg-nav-active"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-ink-muted">
              <s.icon className="shrink-0 text-accent" aria-hidden="true" />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="text-2xl leading-none font-bold text-ink tabular-nums">{s.value}</span>
            <span className="min-w-0 truncate">{s.note}</span>
          </button>
        ))}
      </div>
    </DashTile>
  );
};
