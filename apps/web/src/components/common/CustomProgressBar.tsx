import React from "react";

interface CustomProgressBarProps {
  progressPercent: number;
}

/** Thin rounded progress track: green when done, blue past halfway, amber below. */
const CustomProgressBar: React.FC<CustomProgressBarProps> = ({ progressPercent }) => {
  const bgColor =
    progressPercent === 100
      ? "bg-[color:var(--color-success)]"
      : progressPercent > 50
        ? "bg-accent"
        : "bg-[color:var(--color-warning)]";
  const clamped = Math.min(100, Math.max(0, progressPercent));

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className="h-2.5 flex-1 overflow-hidden rounded-full bg-line-soft"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ease-in-out motion-reduce:transition-none ${bgColor}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs font-semibold tabular-nums text-ink" style={{ minWidth: "35px" }}>
        {progressPercent}%
      </span>
    </div>
  );
};

export default CustomProgressBar;
