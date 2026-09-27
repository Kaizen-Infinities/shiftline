import type { CostType, JobStatus, StageStatus } from "../../../services/projectJobsService";

/** Labels and formatters shared by the job costing screens (TN-09). */
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  QUOTED: "Quoted",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  SKIPPED: "Skipped",
};

export const COST_TYPE_LABEL: Record<CostType, string> = {
  MATERIAL: "Material",
  LABOUR: "Labour",
  SUBCONTRACT: "Subcontract",
  OVERHEAD: "Overhead",
};

export const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);

export const todayIso = () => new Date().toISOString().slice(0, 10);

/** Compact rupees for stat tiles: ₹4.50L, ₹1.20Cr, ₹85,000. */
export const shortInr = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  return `${sign}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(abs)}`;
};
