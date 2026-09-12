import { fxService } from "../modules/currency/fx.service";

/**
 * Daily: pull the day's exchange rates for every tenant. The provider is behind an interface and
 * the fixture one is the default, so a deployment without a rate feed configured simply gets
 * nothing rather than a made-up number in the books (P1-17).
 */
export const fxRatesHandler = async () => fxService.sweepAllTenants();
