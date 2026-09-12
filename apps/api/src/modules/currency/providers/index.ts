import { fixtureRateProvider } from "./fixture.provider";
import { rbiRateProvider } from "./rbi.provider";

/**
 * Where the day's exchange rates come from (P1-17).
 *
 * Behind an interface for the usual reason — nothing else in the codebase should know a URL —
 * and because the two sources answer subtly different questions. The RBI publishes a *reference*
 * rate once a day; a bank gives the rate it will actually deal at. A tenant that cares about the
 * difference wires its bank in here rather than editing the service.
 */
export interface RateQuote {
  currencyCode: string;
  /** Rupees for one unit of the currency. */
  rate: number;
  on: Date;
}

export interface ExchangeRateProvider {
  name: string;
  /** The rates this provider publishes for a day. An empty list means it had none. */
  fetch(on: Date, currencies: string[]): Promise<RateQuote[]>;
}

export const RATE_PROVIDERS = ["FIXTURE", "RBI"] as const;
export type RateProviderName = (typeof RATE_PROVIDERS)[number];

export const rateProviderFor = (name: string): ExchangeRateProvider => {
  switch (name) {
    case "RBI":
      return rbiRateProvider;
    case "FIXTURE":
    default:
      return fixtureRateProvider;
  }
};
