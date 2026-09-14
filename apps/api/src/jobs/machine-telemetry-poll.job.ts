import type PgBoss from "pg-boss";

import { prisma } from "../config/prisma";
import { QUEUES, sendTenantJob, type TenantJobData } from "../lib/jobs";
import { logger } from "../lib/logger";
import { runAsTenant, withoutTenant } from "../lib/tenant-context";
import { machineTelemetryService } from "../modules/machine-telemetry/machine-telemetry.service";

export interface MachineTelemetryPollJobData extends TenantJobData {
  gatewayId: string;
}

/**
 * Fan-out (P2-01): every minute, enqueue one poll job for every active MachineGateway whose
 * poll interval has elapsed since its last successful poll (or that has never polled). Cadence
 * is minute-granular regardless of a gateway's configured `pollIntervalSeconds` -- the same
 * limit every other cron-driven fan-out in this codebase has.
 */
export const machineTelemetryFanoutHandler = async (
  _job: PgBoss.Job<Record<string, never>>
): Promise<{ enqueued: number }> => {
  const gateways = await withoutTenant(() =>
    prisma.machineGateway.findMany({
      where: { isActive: true },
      select: { id: true, companyId: true, pollIntervalSeconds: true, lastSeenAt: true },
    })
  );
  const now = Date.now();
  let enqueued = 0;
  for (const gw of gateways) {
    const due = !gw.lastSeenAt || now - gw.lastSeenAt.getTime() >= gw.pollIntervalSeconds * 1000;
    if (!due) continue;
    const id = await sendTenantJob<MachineTelemetryPollJobData>(
      QUEUES.MACHINE_TELEMETRY_POLL,
      { companyId: gw.companyId, gatewayId: gw.id },
      { singletonKey: `${gw.companyId}:${gw.id}`, expireInSeconds: 120 }
    );
    if (id) enqueued += 1;
  }
  return { enqueued };
};

/**
 * Per-gateway handler. `pollGateway()` already records a failure on the gateway row (lastError,
 * consecutiveFailures) and notifies once it crosses the threshold, so a business/adapter
 * failure here is swallowed rather than re-thrown -- re-throwing would hand it to pg-boss's own
 * retry policy on top of that, firing the notification threshold in one fan-out cycle instead
 * of across several. Genuine job-infrastructure failures (a crash mid-poll) still leave the
 * batch write idempotent: `MachineSignal.createMany` skips duplicates on
 * (companyId, machineId, signal, timestamp), so a pg-boss redelivery after a crash adds nothing
 * twice.
 */
export const machineTelemetryPollHandler = async (
  job: PgBoss.Job<MachineTelemetryPollJobData>
): Promise<{ ok: boolean }> => {
  const { companyId, gatewayId } = job.data;
  try {
    await runAsTenant(companyId, () => machineTelemetryService.pollGateway(gatewayId));
    return { ok: true };
  } catch (err) {
    logger.warn({ err, companyId, gatewayId }, "machine-telemetry: poll failed");
    return { ok: false };
  }
};
