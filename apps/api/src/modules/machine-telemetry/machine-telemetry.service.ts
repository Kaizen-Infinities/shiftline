import { z } from "zod";
import type { GatewayAdapterKind, MachineSignalName, Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { byCode } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { decryptText, encryptText } from "../../utils/crypto";
import { notify } from "../notifications/notify";
import { CANONICAL_SIGNALS, MACHINE_SIGNAL_NAMES } from "./machine-telemetry.types";
import type {
  CanonicalSample,
  GatewayConnectionConfig,
  GatewayCredentials,
} from "./machine-telemetry.types";
import { PROVIDERS, providerFor } from "./providers";

/**
 * Machine telemetry (P2-01): gateway configuration, the signal-map translation, ingestion, and
 * the read side (recent signals, cycle roll-ups, gateway health). See P2-00 for the write path
 * this module's ingestion follows and the adapter pattern its providers follow.
 */
const jsonRecord = z.record(z.string(), z.unknown());

export const gatewayBodySchema = z.object({
  code: z.string().trim().min(1).max(20),
  machineId: z.string().trim().min(1).max(20),
  adapterKind: z.enum(PROVIDERS as [GatewayAdapterKind, ...GatewayAdapterKind[]]),
  connectionSettings: jsonRecord.optional(),
  credentials: jsonRecord.optional().nullable(),
  pollIntervalSeconds: z.coerce.number().int().min(5).max(3600).optional(),
  isActive: z.boolean().optional(),
});
export const createGatewaySchema = gatewayBodySchema;
export const updateGatewaySchema = gatewayBodySchema
  .omit({
    code: true,
    machineId: true,
    adapterKind: true,
  })
  .partial();
export type CreateGatewayInput = z.infer<typeof createGatewaySchema>;
export type UpdateGatewayInput = z.infer<typeof updateGatewaySchema>;

export const signalMapRowSchema = z.object({
  vendorTag: z.string().trim().min(1).max(100),
  canonicalSignal: z.enum(MACHINE_SIGNAL_NAMES as [string, ...string[]]),
  unit: z.string().trim().max(20).optional().nullable(),
  dataType: z.enum(["NUMERIC", "TEXT"]).optional(),
});
export const replaceSignalMapSchema = z.object({ rows: z.array(signalMapRowSchema).max(200) });
export type ReplaceSignalMapInput = z.infer<typeof replaceSignalMapSchema>;

export const listSignalsSchema = z.object({
  machineId: z.string().trim().max(20).optional(),
  gatewayId: z.string().uuid().optional(),
  signal: z.enum(MACHINE_SIGNAL_NAMES as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type ListSignalsInput = z.infer<typeof listSignalsSchema>;

export const listCyclesSchema = z.object({
  machineId: z.string().trim().max(20).optional(),
  gatewayId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type ListCyclesInput = z.infer<typeof listCyclesSchema>;

/** A gateway that fails this many polls in a row gets one notification, not one per poll. */
export const FAILURE_NOTIFY_THRESHOLD = 3;
const DEFAULT_POLL_INTERVAL_SECONDS = 30;

export interface PublicGateway {
  id: string;
  code: string;
  machineId: string;
  adapterKind: GatewayAdapterKind;
  connectionSettings: Prisma.JsonValue;
  hasCredentials: boolean;
  pollIntervalSeconds: number;
  isActive: boolean;
  lastSeenAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

const toPublic = (g: {
  id: string;
  code: string;
  machineId: string;
  adapterKind: GatewayAdapterKind;
  connectionSettings: Prisma.JsonValue;
  credentialsEncrypted: string | null;
  pollIntervalSeconds: number;
  isActive: boolean;
  lastSeenAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}): PublicGateway => ({
  id: g.id,
  code: g.code,
  machineId: g.machineId,
  adapterKind: g.adapterKind,
  connectionSettings: g.connectionSettings,
  hasCredentials: Boolean(g.credentialsEncrypted),
  pollIntervalSeconds: g.pollIntervalSeconds,
  isActive: g.isActive,
  lastSeenAt: g.lastSeenAt,
  lastError: g.lastError,
  lastErrorAt: g.lastErrorAt,
  consecutiveFailures: g.consecutiveFailures,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
});

type Actor = { userId?: string };
const actorId = (a: Actor) => a.userId?.slice(0, 36) ?? null;

/**
 * `samplesWritten`/`cyclesRolledUp` count what this poll *processed* (translated into a
 * canonical sample, or derived a cycle from), not how many rows were genuinely new after
 * `skipDuplicates` -- a replayed poll reports the same counts again even though nothing was
 * actually inserted the second time. Read the tables directly when the distinction matters.
 */
export interface PollResult {
  skipped?: "inactive";
  samplesWritten: number;
  droppedUnmapped: number;
  cyclesRolledUp: number;
}

class MachineTelemetryService {
  /** Reference data for the signal-map editor: every canonical signal, its unit and datatype. */
  canonicalSignals() {
    return MACHINE_SIGNAL_NAMES.map((signal) => ({ signal, ...CANONICAL_SIGNALS[signal] }));
  }

  // ── Gateways ────────────────────────────────────────────────────────────────

  async createGateway(input: CreateGatewayInput, actor: Actor): Promise<PublicGateway> {
    const machine = await prisma.machine.findUnique({
      where: byCode("machineId", input.machineId),
    });
    if (!machine) throw new ApiError(404, `Machine ${input.machineId} not found`);
    const existing = await prisma.machineGateway.findFirst({ where: { code: input.code } });
    if (existing) throw new ApiError(409, `Gateway ${input.code} already exists`);
    const row = await prisma.machineGateway.create({
      data: {
        code: input.code,
        machineId: input.machineId,
        adapterKind: input.adapterKind,
        connectionSettings: (input.connectionSettings ?? {}) as Prisma.InputJsonValue,
        credentialsEncrypted: input.credentials
          ? encryptText(JSON.stringify(input.credentials))
          : null,
        pollIntervalSeconds: input.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS,
        isActive: input.isActive ?? true,
        createdBy: actorId(actor),
        updatedBy: actorId(actor),
      },
    });
    return toPublic(row);
  }

  async listGateways(): Promise<PublicGateway[]> {
    const rows = await prisma.machineGateway.findMany({ orderBy: { code: "asc" } });
    return rows.map(toPublic);
  }

  private async row(id: string) {
    const row = await prisma.machineGateway.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Gateway not found");
    return row;
  }

  async getGateway(id: string): Promise<PublicGateway> {
    return toPublic(await this.row(id));
  }

  async updateGateway(id: string, input: UpdateGatewayInput, actor: Actor): Promise<PublicGateway> {
    await this.row(id);
    const data: Prisma.MachineGatewayUpdateInput = { updatedBy: actorId(actor) };
    if (input.connectionSettings !== undefined) {
      data.connectionSettings = input.connectionSettings as Prisma.InputJsonValue;
    }
    if (input.credentials !== undefined) {
      data.credentialsEncrypted = input.credentials
        ? encryptText(JSON.stringify(input.credentials))
        : null;
    }
    if (input.pollIntervalSeconds !== undefined)
      data.pollIntervalSeconds = input.pollIntervalSeconds;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const row = await prisma.machineGateway.update({ where: { id }, data });
    return toPublic(row);
  }

  async deleteGateway(id: string): Promise<void> {
    await this.row(id);
    await prisma.machineGateway.delete({ where: { id } });
  }

  /** Connects and disconnects once, writing nothing -- proves reachability without ingesting. */
  async testConnection(id: string): Promise<{ ok: boolean; detail: string }> {
    const gateway = await this.row(id);
    const adapter = providerFor(gateway.adapterKind);
    try {
      await adapter.connect(
        gateway.connectionSettings as GatewayConnectionConfig,
        this.credentialsOf(gateway.credentialsEncrypted)
      );
      await adapter.disconnect();
      return { ok: true, detail: `Connected via ${adapter.describe().kind}` };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : "Connection failed" };
    }
  }

  private credentialsOf(credentialsEncrypted: string | null): GatewayCredentials {
    if (!credentialsEncrypted) return {};
    try {
      return JSON.parse(decryptText(credentialsEncrypted));
    } catch {
      return {};
    }
  }

  // ── Signal map ──────────────────────────────────────────────────────────────

  async listSignalMap(gatewayId: string) {
    await this.row(gatewayId);
    return prisma.machineSignalMap.findMany({
      where: { gatewayId },
      orderBy: { vendorTag: "asc" },
    });
  }

  /**
   * Replaces the gateway's active mapping with exactly the given rows: each is upserted active,
   * and any existing row not named here is retired (isActive: false, never deleted -- P2-00's
   * reason-master convention).
   */
  async replaceSignalMap(gatewayId: string, input: ReplaceSignalMapInput) {
    await this.row(gatewayId);
    const companyId = requireTenantId();
    const keep = new Set(input.rows.map((r) => r.vendorTag));
    await prisma.$transaction(async (tx) => {
      for (const row of input.rows) {
        const canonicalSignal = row.canonicalSignal as MachineSignalName;
        await tx.machineSignalMap.upsert({
          where: {
            companyId_gatewayId_vendorTag: { companyId, gatewayId, vendorTag: row.vendorTag },
          },
          update: {
            canonicalSignal,
            unit: row.unit ?? null,
            dataType: row.dataType ?? "NUMERIC",
            isActive: true,
          },
          create: {
            gatewayId,
            vendorTag: row.vendorTag,
            canonicalSignal,
            unit: row.unit ?? null,
            dataType: row.dataType ?? "NUMERIC",
          },
        });
      }
      const existing = await tx.machineSignalMap.findMany({ where: { gatewayId } });
      const toRetire = existing.filter((e) => e.isActive && !keep.has(e.vendorTag));
      if (toRetire.length > 0) {
        await tx.machineSignalMap.updateMany({
          where: { id: { in: toRetire.map((r) => r.id) } },
          data: { isActive: false },
        });
      }
    });
    return this.listSignalMap(gatewayId);
  }

  // ── Ingestion ───────────────────────────────────────────────────────────────

  /**
   * Polls one gateway once: connect, poll, translate through the signal map (dropping unmapped
   * tags with a counter, never throwing on them), write the batch, roll up completed cycles,
   * and update the gateway's health fields. Assumes tenant context is already set -- the pg-boss
   * handler wraps its call in `runAsTenant`; an HTTP caller already has request-scoped context.
   */
  async pollGateway(gatewayId: string): Promise<PollResult> {
    const gateway = await this.row(gatewayId);
    if (!gateway.isActive)
      return { skipped: "inactive", samplesWritten: 0, droppedUnmapped: 0, cyclesRolledUp: 0 };

    // Every poll gets a fresh adapter instance (pg-boss jobs are short-lived, not a held-open
    // connection), so an adapter that needs to resume where it left off reads its position back
    // out of connectionSettings._cursor and reports the advanced position via cursor().
    const adapter = providerFor(gateway.adapterKind);
    let raw;
    let cursorUpdate: Record<string, unknown>;
    try {
      await adapter.connect(
        gateway.connectionSettings as GatewayConnectionConfig,
        this.credentialsOf(gateway.credentialsEncrypted)
      );
      raw = await adapter.poll();
      cursorUpdate = adapter.cursor();
      await adapter.disconnect();
    } catch (err) {
      await this.recordFailure(gateway.id, err);
      throw err;
    }

    const maps = await prisma.machineSignalMap.findMany({
      where: { gatewayId, isActive: true },
    });
    const byTag = new Map(maps.map((m) => [m.vendorTag, m]));
    const canonical: CanonicalSample[] = [];
    let droppedUnmapped = 0;
    for (const s of raw) {
      const map = byTag.get(s.vendorTag);
      if (!map) {
        droppedUnmapped += 1;
        continue;
      }
      canonical.push({
        signal: map.canonicalSignal,
        timestamp: s.timestamp,
        numericValue: s.numericValue,
        textValue: s.textValue,
      });
    }

    const cycles = await this.cyclesFor(gateway.machineId, gateway.id, canonical);

    await prisma.$transaction(async (tx) => {
      if (canonical.length > 0) {
        await tx.machineSignal.createMany({
          data: canonical.map((c) => ({
            machineId: gateway.machineId,
            gatewayId: gateway.id,
            signal: c.signal,
            timestamp: c.timestamp,
            numericValue: c.numericValue ?? null,
            textValue: c.textValue ?? null,
          })),
          skipDuplicates: true,
        });
      }
      if (cycles.length > 0) {
        // companyId_gatewayId_endedAt: the same idempotency guarantee as MachineSignal, for a
        // replayed poll that re-derives the same cycle.
        await tx.machineCycle.createMany({ data: cycles, skipDuplicates: true });
      }
      await tx.machineGateway.update({
        where: { id: gateway.id },
        data: {
          connectionSettings: {
            ...(gateway.connectionSettings as object),
            ...cursorUpdate,
          } as Prisma.InputJsonValue,
          lastSeenAt: new Date(),
          lastError: null,
          lastErrorAt: null,
          consecutiveFailures: 0,
        },
      });
    });

    return { samplesWritten: canonical.length, droppedUnmapped, cyclesRolledUp: cycles.length };
  }

  /** Best-effort: the most recently started IN_PRODUCTION order on this machine, if any. */
  private async currentProductionOrder(machineId: string): Promise<string | null> {
    const order = await prisma.productionOrder.findFirst({
      where: { machineMachineId: machineId, status: "IN_PRODUCTION" },
      orderBy: { updatedAt: "desc" },
      select: { productionOrderId: true },
    });
    return order?.productionOrderId ?? null;
  }

  /**
   * Groups this poll's canonical samples by timestamp and turns every CYCLE_COMPLETE tick into
   * a MachineCycle row: duration from the CYCLE_TIME sample in the same group (falling back to
   * the gap since the previous tick this poll, or the gateway's poll interval for the very
   * first), parts produced defaulting to 1 per cycle (multi-cavity aggregation is future work).
   */
  private async cyclesFor(
    machineId: string,
    gatewayId: string,
    canonical: CanonicalSample[]
  ): Promise<Prisma.MachineCycleUncheckedCreateInput[]> {
    const completes = canonical.filter((c) => c.signal === "CYCLE_COMPLETE");
    if (completes.length === 0) return [];
    const productionOrderId = await this.currentProductionOrder(machineId);
    const byTimestamp = new Map<number, CanonicalSample[]>();
    for (const c of canonical) {
      const key = c.timestamp.getTime();
      const list = byTimestamp.get(key) ?? [];
      list.push(c);
      byTimestamp.set(key, list);
    }
    const ticks = [...new Set(completes.map((c) => c.timestamp.getTime()))].sort((a, b) => a - b);
    const rows: Prisma.MachineCycleUncheckedCreateInput[] = [];
    let previousEndMs: number | null = null;
    for (const tickMs of ticks) {
      const group = byTimestamp.get(tickMs) ?? [];
      const cycleTime = group.find((c) => c.signal === "CYCLE_TIME")?.numericValue;
      const fallbackSeconds = previousEndMs !== null ? (tickMs - previousEndMs) / 1000 : 30;
      const actualCycleSeconds = cycleTime ?? fallbackSeconds;
      rows.push({
        machineId,
        gatewayId,
        productionOrderId,
        startedAt: new Date(tickMs - actualCycleSeconds * 1000),
        endedAt: new Date(tickMs),
        actualCycleSeconds,
        partsProduced: 1,
      });
      previousEndMs = tickMs;
    }
    return rows;
  }

  private async recordFailure(gatewayId: string, err: unknown): Promise<void> {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const updated = await prisma.machineGateway.update({
      where: { id: gatewayId },
      data: { lastError: message, lastErrorAt: new Date(), consecutiveFailures: { increment: 1 } },
    });
    if (updated.consecutiveFailures === FAILURE_NOTIFY_THRESHOLD) {
      await notify({
        category: "machine-telemetry",
        level: "ERROR",
        title: `Gateway ${updated.code} is not responding`,
        body: `${FAILURE_NOTIFY_THRESHOLD} polls in a row have failed: ${message}`,
        link: "/settings/machine-gateways",
        to: { permission: "machine-telemetry.view" },
      });
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async recentSignals(input: ListSignalsInput) {
    return prisma.machineSignal.findMany({
      where: {
        machineId: input.machineId,
        gatewayId: input.gatewayId,
        signal: input.signal as MachineSignalName | undefined,
      },
      orderBy: { timestamp: "desc" },
      take: input.limit ?? 100,
    });
  }

  async listCycles(input: ListCyclesInput) {
    return prisma.machineCycle.findMany({
      where: { machineId: input.machineId, gatewayId: input.gatewayId },
      orderBy: { endedAt: "desc" },
      take: input.limit ?? 100,
    });
  }

  async gatewayHealth(): Promise<PublicGateway[]> {
    return this.listGateways();
  }
}

export const machineTelemetryService = new MachineTelemetryService();
