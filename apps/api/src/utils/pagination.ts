import { z } from "zod";

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 20;

/** Clamped pagination query: page >= 1, 1 <= limit <= MAX_PAGE_SIZE. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type Pagination = { page: number; limit: number; skip: number; take: number };

/** Parses page/limit from a raw query object; invalid values throw a 400 via ZodError. */
export const parsePagination = (query: Record<string, unknown>, fallbackLimit = DEFAULT_PAGE_SIZE): Pagination => {
  const { page, limit } = paginationQuerySchema.parse({
    page: query.page ?? 1,
    limit: query.limit ?? fallbackLimit,
  });
  return { page, limit, skip: (page - 1) * limit, take: limit };
};

/** Parses a route id into BigInt, rejecting non-numeric or out-of-range values with a 400. */
export const parseBigIntId = (raw: unknown): bigint => {
  const s = String(raw);
  if (!/^\d{1,18}$/.test(s)) throw new RangeError(`Invalid id: ${s}`);
  return BigInt(s);
};
