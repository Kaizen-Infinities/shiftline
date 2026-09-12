import { jobWorkService } from "../modules/job-work/job-work.service";

/**
 * Daily: warn before goods sent for job work run out of time to come back. Past the deadline
 * the credit taken on them is treated as a supply made on the day they left, with interest
 * (P1-14).
 */
export const jobWorkReturnHandler = async () => jobWorkService.sweepAllTenants();
