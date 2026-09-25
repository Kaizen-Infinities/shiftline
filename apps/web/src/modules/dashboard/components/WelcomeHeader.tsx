import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { LuBuilding2, LuCalendarDays, LuRefreshCw, LuTv } from "react-icons/lu";
import { useAppSelector } from "../../../hooks/reduxHooks";
import { ChipToggle } from "./DashboardPrimitives";

export type DashPeriod = "day" | "week" | "month" | "year";

const PERIOD_OPTIONS: { value: DashPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

/** "RIYA SHARMA" → "Riya"; "Riya Sharma" → "Riya"; empty → null. */
const firstNameOf = (fullName?: string | null, username?: string | null): string | null => {
  const raw = (fullName || username || "").trim();
  if (!raw) return null;
  const first = raw.split(/[\s@._-]+/)[0];
  if (!first) return null;
  // Seeded and imported names are often all caps; greet people like people.
  return first === first.toUpperCase() && first.length > 1
    ? first.charAt(0) + first.slice(1).toLowerCase()
    : first;
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/**
 * "Welcome Riya": light slate greeting, bold blue name, next to the company's
 * blue brand tile. Today's date and the company sit beneath as chips; the
 * period switcher and the TV-dashboard link sit on the right.
 */
export const WelcomeHeader: React.FC<{
  period: DashPeriod;
  onPeriodChange: (p: DashPeriod) => void;
  syncing: boolean;
}> = ({ period, onPeriodChange, syncing }) => {
  const user = useAppSelector((s) => s.auth.user);
  const company = useAppSelector((s) => s.company.data);

  const firstName = firstNameOf(user?.fullName, user?.username);
  const companyName = company?.shortName || company?.companyName || null;

  const today = useMemo(
    () =>
      new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    []
  );

  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        {company?.logoUrl ? (
          <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line-soft bg-card p-1.5 shadow-[var(--shadow-sm)]">
            <img src={company.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="sl-brand-tile h-14 w-14 shrink-0 rounded-2xl text-lg font-bold tracking-tight"
          >
            {companyName ? initialsOf(companyName) : "S"}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="sl-welcome leading-tight">
            Welcome <strong>{firstName ?? "back"}</strong>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="sl-chip sl-chip-muted">
              <LuCalendarDays aria-hidden="true" />
              {today}
            </span>
            {companyName && (
              <span className="sl-chip max-w-[18rem] truncate" title={company?.companyName}>
                <LuBuilding2 aria-hidden="true" className="shrink-0" />
                <span className="truncate">{companyName}</span>
              </span>
            )}
            {syncing && (
              <span className="sl-chip sl-chip-muted" role="status">
                <LuRefreshCw
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
                Syncing…
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ChipToggle
          label="Dashboard period"
          value={period}
          options={PERIOD_OPTIONS}
          onChange={onPeriodChange}
        />
        <Link
          to="/tv-dashboard"
          className="sl-btn min-h-11 px-3.5 text-sm sm:px-5"
          title="Open the full-screen TV dashboard"
          aria-label="TV dashboard"
        >
          <LuTv aria-hidden="true" className="text-base" />
          <span className="hidden sm:inline">TV dashboard</span>
        </Link>
      </div>
    </header>
  );
};
