import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** Buyer social-compliance audits and audit readiness (TN-08). */
export type AuditStandard =
  "BSCI" | "WRAP" | "SMETA" | "SA8000" | "SEDEX" | "HIGG" | "CUSTOMER_COC" | "OTHER";
export type AuditStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type FindingArea =
  | "WORKING_HOURS"
  | "WAGES"
  | "HEALTH_SAFETY"
  | "CHILD_LABOUR"
  | "DOCUMENTATION"
  | "ENVIRONMENT"
  | "OTHER";
export type Severity = "CRITICAL" | "MAJOR" | "MINOR" | "OBSERVATION";
export type ActionStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "VERIFIED";
export type CheckStatus = "PASS" | "WARN" | "FAIL" | "NOT_CONFIGURED";

export const STANDARD_LABEL: Record<AuditStandard, string> = {
  BSCI: "amfori BSCI",
  WRAP: "WRAP",
  SMETA: "SMETA",
  SA8000: "SA8000",
  SEDEX: "Sedex",
  HIGG: "Higg FSLM",
  CUSTOMER_COC: "Buyer code of conduct",
  OTHER: "Other",
};

export const AREA_LABEL: Record<FindingArea, string> = {
  WORKING_HOURS: "Working hours",
  WAGES: "Wages",
  HEALTH_SAFETY: "Health & safety",
  CHILD_LABOUR: "Child & young labour",
  DOCUMENTATION: "Documentation",
  ENVIRONMENT: "Environment",
  OTHER: "Other",
};

export interface AuditRow {
  id: string;
  auditNo: string;
  standard: AuditStandard;
  customerId: string | null;
  customerName: string | null;
  auditorFirm: string | null;
  auditorName: string | null;
  scheduledDate: string;
  actualDate: string | null;
  status: AuditStatus;
  rating: string | null;
  nextAuditDue: string | null;
  remarks: string | null;
  cancelReason: string | null;
  daysToGo: number | null;
  findingCount: number;
  openFindings: Record<Severity, number>;
  openActions: number;
  overdueActions: number;
}

export interface CorrectiveAction {
  id: string;
  findingId: string;
  action: string;
  ownerUserId: string | null;
  ownerEmployeeId: string | null;
  ownerName: string | null;
  dueDate: string;
  status: ActionStatus;
  evidenceNote: string | null;
  closedOn: string | null;
  overdue: boolean;
  dueSoon: boolean;
}

export interface Finding {
  id: string;
  seq: number;
  area: FindingArea;
  severity: Severity;
  clauseRef: string | null;
  description: string;
  open: boolean;
  actions: CorrectiveAction[];
}

export interface AuditDetail extends AuditRow {
  findings: Finding[];
}

export interface ReadinessCheck {
  key: string;
  title: string;
  status: CheckStatus;
  count: number | null;
  detail: string;
  items: { ref: string; label: string; value: string }[];
}

export interface Readiness {
  from: string;
  to: string;
  percent: number | null;
  band: "READY" | "AT_RISK" | "NOT_READY" | null;
  counts: { pass: number; warn: number; fail: number; notConfigured: number };
  checks: ReadinessCheck[];
  nextAudit: AuditRow | null;
}

export interface ActionOwner {
  kind: "USER" | "EMPLOYEE";
  id: string;
  name: string;
}

export interface PlanAudit {
  auditNo?: string;
  standard: AuditStandard;
  customerId?: string;
  auditorFirm?: string;
  auditorName?: string;
  scheduledDate: string;
  nextAuditDue?: string;
  remarks?: string;
}

const p = API_PATHS.buyerAudits;

export const buyerAuditsService = {
  readiness: async (range: { from?: string; to?: string }): Promise<Readiness> =>
    (await apiClient.get(p.readiness, { params: range })).data.data,

  /** Streams the readiness CSV through the signed-in session and hands it to the browser. */
  exportReadiness: async (range: { from: string; to: string }) => {
    const res = await apiClient.get(p.readinessExport, { params: range, responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-readiness-${range.from}-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  list: async (filters: { status?: AuditStatus } = {}): Promise<AuditRow[]> =>
    (await apiClient.get(p.base, { params: filters })).data.data,

  get: async (id: string): Promise<AuditDetail> =>
    (await apiClient.get(`${p.base}/${id}`)).data.data,

  create: async (body: PlanAudit): Promise<AuditDetail> =>
    (await apiClient.post(p.base, body)).data.data,

  update: async (
    id: string,
    body: Partial<{
      status: "IN_PROGRESS" | "COMPLETED";
      actualDate: string | null;
      rating: string | null;
      nextAuditDue: string | null;
      scheduledDate: string;
      auditorFirm: string | null;
      remarks: string | null;
    }>
  ): Promise<AuditDetail> => (await apiClient.patch(`${p.base}/${id}`, body)).data.data,

  cancel: async (id: string, reason: string): Promise<AuditDetail> =>
    (await apiClient.post(`${p.base}/${id}/cancel`, { reason })).data.data,

  addFinding: async (
    id: string,
    body: { area: FindingArea; severity: Severity; clauseRef?: string; description: string }
  ): Promise<AuditDetail> => (await apiClient.post(`${p.base}/${id}/findings`, body)).data.data,

  addAction: async (
    id: string,
    findingId: string,
    body: { action: string; ownerUserId?: string; ownerEmployeeId?: string; dueDate: string }
  ): Promise<AuditDetail> =>
    (await apiClient.post(`${p.base}/${id}/findings/${findingId}/actions`, body)).data.data,

  updateAction: async (
    id: string,
    actionId: string,
    body: { status?: ActionStatus; evidenceNote?: string | null; closedOn?: string }
  ): Promise<AuditDetail> =>
    (await apiClient.patch(`${p.base}/${id}/actions/${actionId}`, body)).data.data,

  owners: async (q?: string): Promise<ActionOwner[]> =>
    (await apiClient.get(p.owners, { params: q ? { q } : {} })).data.data,
};
