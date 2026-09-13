import type PgBoss from "pg-boss";

import { runAsTenant } from "../lib/tenant-context";
import { smsService, type SmsSendJobData } from "../modules/sms/sms.service";

/** One SMS delivery per job (P2-T), so a slow gateway never blocks the request that queued it. */
export const smsSendHandler = async (job: PgBoss.Job<SmsSendJobData>) => {
  const { companyId, smsMessageId } = job.data;
  return runAsTenant(companyId, () => smsService.sendQueuedMessage(smsMessageId));
};
