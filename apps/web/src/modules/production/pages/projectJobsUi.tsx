import React from "react";

import { Chip, type ChipTone } from "../../../components/ui/v2";
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
