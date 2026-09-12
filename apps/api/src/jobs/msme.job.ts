import { msmeService } from "../modules/msme/msme.service";

/**
 * Daily: nudge whoever pays the bills before a micro or small supplier's invoice runs past the
 * section 15 date. Late by a day and the deduction moves to the year the money is actually paid
 * (section 43B(h)), so the warning is worth more than the payment run's own reminder (P1-07).
 */
export const msmeClockHandler = async () => msmeService.sweepAllTenants();
