import { env } from "../../../config/env";
import { logger } from "../../../lib/logger";
import type { ExchangeRateProvider, RateQuote } from "./index";

/**
 * The RBI reference rate (P1-17).
 *
 * Two things about it are worth knowing before anyone trusts the number. It is published once a
 * day around 13:30 IST and **not at all on a holiday**, so a Sunday has no rate and the caller
 * must fall back to the last one rather than treating the gap as zero. And it is a *reference*
 * rate, not a dealing rate: the bank's rate on the same day will differ, which is exactly why
 * realised gain and loss exists.
 *
 * Without a URL configured this provider returns nothing rather than inventing a rate — a made-up
 * rate would flow straight into the books.
 */
export const rbiRateProvider: ExchangeRateProvider = {
  name: "RBI",
  async fetch(on: Date, currencies: string[]): Promise<RateQuote[]> {
    const base = env.RBI_RATE_URL?.trim();
    if (!base) {
      logger.warn(
        { on: on.toISOString().slice(0, 10) },
        "No RBI rate feed is configured; rates have to be entered by hand"
      );
      return [];
    }
    const url = `${base}${base.includes("?") ? "&" : "?"}date=${on.toISOString().slice(0, 10)}`;
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "The rate feed refused the request");
        return [];
      }
      const body = (await res.json()) as { rates?: Record<string, number | string> };
      const rates = body.rates ?? {};
      return (
        currencies
          .filter((c) => rates[c] !== undefined)
          .map((c) => ({ currencyCode: c, rate: Number(rates[c]), on }))
          // A zero or a NaN from a feed is worse than no rate at all.
          .filter((q) => Number.isFinite(q.rate) && q.rate > 0)
      );
    } catch (err) {
      logger.warn({ err }, "The rate feed could not be reached");
      return [];
    }
  },
};
