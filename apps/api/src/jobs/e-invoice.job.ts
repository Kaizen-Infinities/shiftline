import type PgBoss from "pg-boss";

import { runAsTenant } from "../lib/tenant-context";
import type { TenantJobData } from "../lib/jobs";
import { eInvoiceService } from "../modules/e-invoice/e-invoice.service";

/** One IRN request per job; retried by pg-boss on transient portal errors (P1-11). */
export interface EInvoiceJobData extends TenantJobData {
  eInvoiceId: string;
}

export const eInvoiceHandler = async (job: PgBoss.Job<EInvoiceJobData>) => {
  const { companyId, eInvoiceId } = job.data;
  const row = await runAsTenant(companyId, () => eInvoiceService.generate(eInvoiceId));
  return { id: row.id, status: row.status };
};
