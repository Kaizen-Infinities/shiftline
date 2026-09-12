import { complianceService } from "../modules/gst-returns/compliance.service";

/**
 * Daily: nudge whoever prepares the filings 7 and 2 days before each statutory due date.
 * The service decides which dates fall in the window and will not send the same nudge twice
 * (P1-13d).
 */
export const complianceCalendarHandler = async () => complianceService.sweepAllTenants();
