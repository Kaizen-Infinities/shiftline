import React from "react";

import { Chip, cx, type ChipTone } from "../../../components/ui/v2";
import type { JobStatus, JobSummary, MarginBand } from "../../../services/projectJobsService";
import { JOB_STATUS_LABEL, pct } from "./projectJobsFormat";

/** Status and margin chips shared by the job costing screens (TN-09). */
const JOB_STATUS_TONE: Record<JobStatus, ChipTone> = {
  QUOTED: "muted",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  DELIVERED: "default",
  CANCELLED: "danger",
};

export const JobStatusChip: React.FC<{ status: JobStatus }> = ({ status }) => (
  <Chip size="sm" dot tone={JOB_STATUS_TONE[status]}>
    {JOB_STATUS_LABEL[status]}
  </Chip>
);

const MARGIN_TONE: Record<MarginBand, ChipTone> = {
  HEALTHY: "success",
  THIN: "warning",
  LOSS: "danger",
};

export const MarginChip: React.FC<{ summary: JobSummary }> = ({ summary }) => (
  <Chip
    size="sm"
    tone={MARGIN_TONE[summary.marginBand]}
    title={summary.overQuote ? "Cost has run past the quote" : "Margin against the quote"}
  >
    {summary.marginPct === null ? "No quote" : `${pct(summary.marginPct)} margin`}
  </Chip>
);

/** Job progress: blue while under way, green once complete (never amber: slow is not late). */
export const JobProgress: React.FC<{ pct: number; label: string; className?: string }> = ({
  pct: value,
  label,
  className,
}) => (
  <div
    className={cx("h-2.5 overflow-hidden rounded-full bg-card-2", className)}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value)}
  >
    <div
      className={cx(
        "h-full rounded-full transition-all",
        value >= 100 ? "bg-[color:var(--color-success)]" : "bg-accent"
      )}
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);
