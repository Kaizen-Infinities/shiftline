import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { AUDITED_MODELS } from "../../lib/audited-models";
import type { AuditTrailQuery } from "./audit-trail.types";

/**
 * Audit trail viewer (P1-09d, MCA Companies (Accounts) Rules 3(1)). Reads the append-only
 * `audit_log` written by database trigger: who changed which row, when, under which request,
 * with the before/after values. Rows are tenant-scoped by the Prisma extension and RLS; the
 * service never writes.
 */
export interface AuditEntity {
  /** Table name as stored in `audit_log.entityName`. */
  table: string;
  model: string;
  label: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditActor {
  type: "user" | "admin" | "system" | string;
  id: string | null;
  name: string;
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  action: string;
  changedAt: Date;
  actor: AuditActor;
  impersonatedBy: string | null;
  requestId: string | null;
  changes: FieldChange[];
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

const humanize = (model: string) => {
  const words = model.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ");
};

const ENTITIES: AuditEntity[] = AUDITED_MODELS.flatMap((name) => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
  return model ? [{ table: model.dbName ?? model.name, model: name, label: humanize(name) }] : [];
}).sort((a, b) => a.label.localeCompare(b.label));

const labelFor = (table: string) => ENTITIES.find((e) => e.table === table)?.label ?? table;

/** The trigger already drops password hashes and tokens; anything secret-shaped goes too. */
const SECRET_KEY = /(password|secret|token|api_?key|hash)/i;
/** Bookkeeping columns are listed after the business changes. */
const NOISE = new Set([
  "updatedAt",
  "updated_at",
  "updatedOn",
  "updated_on",
  "updatedBy",
  "updated_by",
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export const redact = (v: unknown): Record<string, unknown> | null => {
  if (!isRecord(v)) return null;
  return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET_KEY.test(k)));
};

export const diffValues = (oldV: unknown, newV: unknown): FieldChange[] => {
  const o = redact(oldV) ?? {};
  const n = redact(newV) ?? {};
  const out: FieldChange[] = [];
  for (const field of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (JSON.stringify(o[field] ?? null) !== JSON.stringify(n[field] ?? null)) {
      out.push({ field, from: o[field] ?? null, to: n[field] ?? null });
    }
  }
  return out.sort(
    (a, b) =>
      Number(NOISE.has(a.field)) - Number(NOISE.has(b.field)) || a.field.localeCompare(b.field)
  );
};

const utcDay = (s: string) => new Date(`${s}T00:00:00.000Z`);
const nextDay = (d: Date) => new Date(d.getTime() + 24 * 60 * 60 * 1000);

const include = {
  changedByUser: { select: { userId: true, fullName: true, username: true } },
  changedByAdminRel: { select: { id: true, username: true } },
} satisfies Prisma.AuditLogInclude;

type Row = Prisma.AuditLogGetPayload<{ include: typeof include }>;

const present = (row: Row): AuditEntry => {
  const actor: AuditActor = row.changedByUser
    ? { type: "user", id: row.changedByUser.userId, name: row.changedByUser.fullName }
    : row.changedByAdminRel
      ? {
          type: "admin",
          id: String(row.changedByAdminRel.id),
          name: `Platform admin ${row.changedByAdminRel.username}`,
        }
      : row.changedBy
        ? { type: row.actorType ?? "user", id: row.changedBy, name: row.changedBy }
        : { type: row.actorType ?? "system", id: null, name: "System" };
  return {
    id: row.id.toString(),
    entity: row.entityName,
    entityLabel: labelFor(row.entityName),
    entityId: row.entityId,
    action: row.action,
    changedAt: row.changedAt,
    actor,
    impersonatedBy: row.impersonatedBy,
    requestId: row.requestId,
    changes: row.action === "UPDATE" ? diffValues(row.oldValues, row.newValues) : [],
    oldValues: redact(row.oldValues),
    newValues: redact(row.newValues),
  };
};

const whereFor = (q: AuditTrailQuery): Prisma.AuditLogWhereInput => ({
  ...(q.entity && { entityName: q.entity }),
  ...(q.entityId && { entityId: q.entityId }),
  ...(q.action && { action: q.action }),
  ...(q.userId && { changedBy: q.userId }),
  ...(q.requestId && { requestId: q.requestId }),
  ...((q.from || q.to) && {
    changedAt: {
      ...(q.from && { gte: utcDay(q.from) }),
      ...(q.to && { lt: nextDay(utcDay(q.to)) }),
    },
  }),
});

const orderBy = [
  { changedAt: "desc" },
  { id: "desc" },
] satisfies Prisma.AuditLogOrderByWithRelationInput[];

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fmt = (v: unknown) =>
  v === null || v === undefined ? "∅" : typeof v === "string" ? v : JSON.stringify(v);

export const EXPORT_LIMIT = 10_000;

class AuditTrailService {
  entities(): AuditEntity[] {
    return ENTITIES;
  }

  async filters() {
    const users = await prisma.user.findMany({
      select: { userId: true, fullName: true, username: true },
      orderBy: { fullName: "asc" },
    });
    return { entities: ENTITIES, actions: ["CREATE", "UPDATE", "DELETE"], users };
  }

  async list(q: AuditTrailQuery) {
    const where = whereFor(q);
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include,
      }),
    ]);
    return {
      data: rows.map(present),
      page: q.page,
      pageSize: q.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  /** CSV of the filtered trail, newest first, capped at EXPORT_LIMIT rows. */
  async exportCsv(q: AuditTrailQuery): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const rows = await prisma.auditLog.findMany({
      where: whereFor(q),
      orderBy,
      take: EXPORT_LIMIT + 1,
      include,
    });
    const truncated = rows.length > EXPORT_LIMIT;
    const entries = rows.slice(0, EXPORT_LIMIT).map(present);
    const header = [
      "Changed at",
      "Entity",
      "Record",
      "Action",
      "By",
      "Actor type",
      "Impersonated by",
      "Request id",
      "Details",
    ];
    const lines = entries.map((e) => {
      const details =
        e.action === "UPDATE"
          ? e.changes.map((c) => `${c.field}: ${fmt(c.from)} → ${fmt(c.to)}`).join("; ")
          : JSON.stringify(e.action === "DELETE" ? e.oldValues : e.newValues);
      return [
        e.changedAt.toISOString(),
        e.entityLabel,
        e.entityId,
        e.action,
        e.actor.name,
        e.actor.type,
        e.impersonatedBy,
        e.requestId,
        details,
      ]
        .map(csvCell)
        .join(",");
    });
    return {
      csv: [header.join(","), ...lines].join("\r\n") + "\r\n",
      rows: entries.length,
      truncated,
    };
  }
}

export const auditTrailService = new AuditTrailService();
