import apiClient from "../api/apiClient";
import config from "../api/config";

/** Audit trail (P1-09d): the trigger-written change log, read per tenant. */
export interface AuditEntity {
  table: string;
  model: string;
  label: string;
}

export interface AuditUser {
  userId: string;
  fullName: string;
  username: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  action: "CREATE" | "UPDATE" | "DELETE" | string;
  changedAt: string;
  actor: { type: string; id: string | null; name: string };
  impersonatedBy: string | null;
  requestId: string | null;
  changes: FieldChange[];
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  requestId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  data: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export interface AuditFilters {
  entities: AuditEntity[];
  actions: string[];
  users: AuditUser[];
}

const clean = (q: AuditQuery) =>
  Object.fromEntries(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );

export const auditTrailService = {
  list: async (q: AuditQuery): Promise<AuditPage> => {
    const res = await apiClient.get(config.auditTrail.base, { params: clean(q) });
    return res.data.data as AuditPage;
  },

  filters: async (): Promise<AuditFilters> => {
    const res = await apiClient.get(config.auditTrail.filters);
    return res.data.data as AuditFilters;
  },

  exportCsv: async (q: AuditQuery): Promise<Blob> => {
    const res = await apiClient.get(config.auditTrail.export, {
      params: clean(q),
      responseType: "blob",
    });
    return res.data as Blob;
  },
};
