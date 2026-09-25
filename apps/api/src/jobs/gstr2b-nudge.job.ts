import { gstr2bNudgeService } from "../modules/gst-returns/gstr2b-nudge.service";

/**
 * Daily: flag whichever GSTR-2B MISSING_IN_2B/MISMATCH record has sat unfollowed longest, so a
 * mismatch does not just wait for someone to notice it in the workbench (P2-18).
 */
export const gstr2bNudgeHandler = async () => gstr2bNudgeService.sweepAllTenants();
