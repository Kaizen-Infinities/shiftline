import { ewayBillService } from "../modules/eway-bill/eway-bill.service";

/** Hourly: expire e-way bills past validity and warn on the ones lapsing within 12 hours (P1-12). */
export const ewayBillExpiryHandler = async () => ewayBillService.sweepAllTenants();
