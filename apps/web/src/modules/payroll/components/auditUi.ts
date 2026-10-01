import type { ChipTone } from "../../../components/ui/v2";
import type { AuditStatus } from "../../../services/buyerAuditsService";

/** Status chips shared by the audit readiness and buyer audit screens (TN-08). */
export const AUDIT_STATUS_TONE: Record<AuditStatus, ChipTone> = {
  PLANNED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "muted",
};

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
