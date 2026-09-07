import { z } from "zod";
import { isValidGstin } from "@shiftline/shared";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";

/** Transporter master (P1-12): who carries the goods; the id goes on the e-way bill. */
const transporterId = z
  .string()
  .trim()
  .toUpperCase()
  .max(15)
  .refine(
    (v) =>
      v === "" ||
      isValidGstin(v) ||
      /^88[0-9]{2}[A-Z]{3}[0-9]{4}[A-Z0-9]{1}[Z]{1}[A-Z0-9]{1}$/.test(v) ||
      /^[0-9]{2}[A-Z0-9]{13}$/.test(v),
    "Transporter id must be a GSTIN or a 15-character TRANSIN"
  );
export const transporterSchema = z.object({
  code: z.string().trim().min(1).max(20).toUpperCase(),
  name: z.string().trim().min(1).max(120),
  transporterId: transporterId.optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email().max(120).optional().nullable(),
  isActive: z.boolean().default(true),
});
export const transporterUpdateSchema = transporterSchema.partial();

class TransporterService {
  list(q: { includeInactive?: boolean } = {}) {
    return prisma.transporter.findMany({
      where: q.includeInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
    });
  }

  async get(id: string) {
    const row = await prisma.transporter.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Transporter not found");
    return row;
  }

  async create(input: z.infer<typeof transporterSchema>) {
    const clash = await prisma.transporter.findFirst({ where: { code: input.code } });
    if (clash) throw new ApiError(409, `Transporter code ${input.code} already exists`);
    return prisma.transporter.create({
      data: { ...input, transporterId: input.transporterId || null },
    });
  }

  async update(id: string, input: z.infer<typeof transporterUpdateSchema>) {
    await this.get(id);
    if (input.code) {
      const clash = await prisma.transporter.findFirst({
        where: { code: input.code, id: { not: id } },
      });
      if (clash) throw new ApiError(409, `Transporter code ${input.code} already exists`);
    }
    return prisma.transporter.update({
      where: { id },
      data: {
        ...input,
        ...(input.transporterId !== undefined && { transporterId: input.transporterId || null }),
      },
    });
  }

  /** Masters are never deleted; a transporter is retired. */
  async retire(id: string) {
    await this.get(id);
    return prisma.transporter.update({ where: { id }, data: { isActive: false } });
  }
}

export const transporterService = new TransporterService();
