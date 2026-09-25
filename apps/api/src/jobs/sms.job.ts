import type PgBoss from "pg-boss";

import type { TenantJobData } from "../lib/jobs";
import { runAsTenant } from "../lib/tenant-context";
import { smsService } from "../modules/sms/sms.service";

/**
 * One SMS send per job (P1-22, P2-01): `smsService.sendTemplateQueued()` writes the message row
 * and enqueues this; `deliverQueued` is idempotent on the row's own status, so a pg-boss
 * redelivery never sends the same message twice.
 */
export interface SmsSendJobData extends TenantJobData {
  messageId: string;
}

export const smsSendHandler = async (job: PgBoss.Job<SmsSendJobData>) => {
  const { companyId, messageId } = job.data;
  const row = await runAsTenant(companyId, () => smsService.deliverQueued(messageId));
  return { id: row.id, status: row.status };
};
