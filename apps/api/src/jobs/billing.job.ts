import { billingService } from "../modules/payments/billing.service";

/**
 * Monthly, on the 1st: raise the subscription invoice for every tenant whose subscription is
 * not cancelled, through the same `billingService.raise()` the platform console uses by hand
 * (P1-21). Idempotent on `SubscriptionInvoice`'s `@@unique([companyId, periodStart])` — running
 * this twice in a month changes nothing (P2-01).
 */
export const billingSweepHandler = async () => billingService.sweepAllTenants();
