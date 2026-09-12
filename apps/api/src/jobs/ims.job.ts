import { imsService } from "../modules/gst-returns/ims.service";

/**
 * Daily: warn whoever prepares the returns that IMS records are still undecided and the 14th is
 * coming. A record left pending is accepted by the portal's own default, so the warning is
 * about credit the company will be treated as having claimed (P1-13c).
 */
export const imsDeadlineHandler = async () => imsService.sweepAllTenants();
