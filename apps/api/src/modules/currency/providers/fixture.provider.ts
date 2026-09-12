import type { ExchangeRateProvider, RateQuote } from "./index";

/**
 * Rates without a network (P1-17): the same shape the real provider returns, with figures that
 * move a little day to day so a test of gain and loss has something to work with.
 */
const BASE: Record<string, number> = {
  USD: 83.5,
  EUR: 90.25,
  GBP: 105.4,
  AED: 22.73,
  SGD: 61.8,
  JPY: 0.56,
  AUD: 55.1,
};

export const fixtureRateProvider: ExchangeRateProvider = {
  name: "FIXTURE",
  async fetch(on: Date, currencies: string[]): Promise<RateQuote[]> {
    // A deterministic wobble of up to ±0.5%, so the same day always gives the same rate.
    const seed = Number(on.toISOString().slice(0, 10).replace(/-/g, "")) % 97;
    return currencies
      .filter((c) => BASE[c] !== undefined)
      .map((c) => ({
        currencyCode: c,
        rate: Math.round(BASE[c] * (1 + ((seed % 11) - 5) / 1000) * 1e6) / 1e6,
        on,
      }));
  },
};
