import type { RateSource } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";

/**
 * The currency master and the daily rate table (P1-14).
 *
 * The books are kept in rupees, so a foreign-currency document is two numbers: what the customer
 * owes in their currency, and what it was worth in INR on the day it was raised. The second is
 * the one that posts, and it is frozen onto the document — a rate corrected next week does not
 * silently restate last week's sales.
 */
export const BASE_CURRENCY = "INR";
const n6 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 1e6) / 1e6;

/** A handful of currencies an Indian exporter actually bills in, seeded on first use. */
export const COMMON_CURRENCIES: { code: string; name: string; symbol: string; decimals: number }[] =
  [
    { code: "INR", name: "Indian Rupee", symbol: "₹", decimals: 2 },
    { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
    { code: "EUR", name: "Euro", symbol: "€", decimals: 2 },
    { code: "GBP", name: "Pound Sterling", symbol: "£", decimals: 2 },
    { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimals: 2 },
    { code: "SGD", name: "Singapore Dollar", symbol: "S$", decimals: 2 },
    { code: "JPY", name: "Japanese Yen", symbol: "¥", decimals: 0 },
    { code: "AUD", name: "Australian Dollar", symbol: "A$", decimals: 2 },
  ];

class CurrencyService {
  /** The tenant's currencies, seeding the common list the first time it is asked. */
  async list(includeInactive = false) {
    const existing = await prisma.currency.findMany({ orderBy: { code: "asc" } });
    if (existing.length === 0) {
      await prisma.currency.createMany({
        data: COMMON_CURRENCIES.map((c) => ({ ...c, companyId: requireTenantId() })),
        skipDuplicates: true,
      });
      return prisma.currency.findMany({ orderBy: { code: "asc" } });
    }
    return includeInactive ? existing : existing.filter((c) => c.isActive);
  }

  async upsert(input: {
    code: string;
    name: string;
    symbol?: string | null;
    decimals?: number;
    isActive?: boolean;
  }) {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new ApiError(400, "A currency code is three letters");
    if (code === BASE_CURRENCY && input.isActive === false) {
      throw new ApiError(
        400,
        "The rupee is the base currency and cannot be retired",
        "BASE_CURRENCY"
      );
    }
    const data = {
      name: input.name.trim().slice(0, 60),
      symbol: input.symbol?.trim().slice(0, 6) ?? null,
      decimals: input.decimals ?? 2,
      isActive: input.isActive ?? true,
    };
    return prisma.currency.upsert({
      where: { companyId_code: { companyId: requireTenantId(), code } },
      create: { code, ...data },
      update: data,
    });
  }

  /** Records a rate for a day. A second rate for the same day replaces it. */
  async setRate(input: {
    currencyCode: string;
    rateDate: Date;
    rate: number;
    source?: RateSource;
    userId?: string;
  }) {
    const code = input.currencyCode.trim().toUpperCase();
    if (code === BASE_CURRENCY) {
      throw new ApiError(400, "The rupee has no rate against itself", "BASE_CURRENCY");
    }
    if (!(input.rate > 0)) throw new ApiError(400, "A rate has to be greater than zero");
    await this.list(); // make sure the currency exists before a rate points at it
    const currency = await prisma.currency.findUnique({
      where: { companyId_code: { companyId: requireTenantId(), code } },
    });
    if (!currency) throw new ApiError(404, `${code} is not in the currency master`);
    const data = {
      rate: n6(input.rate),
      source: input.source ?? "MANUAL",
      createdBy: input.userId ?? null,
    };
    return prisma.exchangeRate.upsert({
      where: {
        companyId_currencyCode_rateDate: {
          companyId: requireTenantId(),
          currencyCode: code,
          rateDate: input.rateDate,
        },
      },
      create: { currencyCode: code, rateDate: input.rateDate, ...data },
      update: data,
    });
  }

  /**
   * The rate to use for a document. The rate *on or before* the document's date, because a
   * holiday has no rate of its own and the last published one is what a bank would have used.
   * A currency with no rate at all is an error rather than a silent 1:1 — posting a dollar
   * invoice as if a dollar were a rupee is the kind of mistake that survives to the audit.
   */
  async rateFor(currencyCode: string, on: Date): Promise<number> {
    const code = currencyCode.trim().toUpperCase();
    if (code === BASE_CURRENCY) return 1;
    const row = await prisma.exchangeRate.findFirst({
      where: { currencyCode: code, rateDate: { lte: on } },
      orderBy: { rateDate: "desc" },
    });
    if (!row) {
      throw new ApiError(
        409,
        `No exchange rate for ${code} on or before ${on.toISOString().slice(0, 10)}`,
        "NO_RATE",
        { currencyCode: code }
      );
    }
    return Number(row.rate);
  }

  async rates(currencyCode?: string, from?: Date, to?: Date) {
    return prisma.exchangeRate.findMany({
      where: {
        ...(currencyCode ? { currencyCode: currencyCode.toUpperCase() } : {}),
        ...(from || to
          ? { rateDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: [{ rateDate: "desc" }, { currencyCode: "asc" }],
      take: 500,
    });
  }

  /** Converts to rupees at a given rate, rounded the way the books are kept. */
  toInr(amount: number, rate: number): number {
    return Math.round((Number(amount) * Number(rate) + Number.EPSILON) * 100) / 100;
  }
}

export const currencyService = new CurrencyService();
