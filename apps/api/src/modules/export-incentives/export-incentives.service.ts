import type { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import type {
  CreateAuthorisationInput,
  CreateClaimInput,
  CreateEntryInput,
  FromInvoiceInput,
  ListClaimsQuery,
  UpdateAuthorisationInput,
  UpdateClaimInput,
} from "./export-incentives.validation";
import { CLAIM_STATUSES } from "./export-incentives.validation";

/**
 * Export incentives (TN-01): duty incentives per shipping bill from declaration to credit, and
 * EPCG / Advance Authorisation licences with their export-obligation progress.
 *
 * Every query goes through the tenant-scoped client, so a foreign company's row reads as absent.
 */
const DAY = 86_400_000;
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const asDate = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);
const optDate = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : asDate(v);
const addMonths = (d: Date, months: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
};
const today = () => asDate(new Date().toISOString());

/** Terminal states: nothing moves out of them. */
const TERMINAL = new Set(["CREDITED", "REJECTED"]);
const rank = (s: string) => CLAIM_STATUSES.indexOf(s as (typeof CLAIM_STATUSES)[number]);

class ExportIncentivesService {
  // ── Claims ──────────────────────────────────────────────────────────────────
  async listClaims(q: ListClaimsQuery) {
    const where: Prisma.ExportIncentiveClaimWhereInput = {};
    if (q.scheme) where.scheme = q.scheme;
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.shippingBillDate = {
        ...(q.from ? { gte: asDate(q.from) } : {}),
        ...(q.to ? { lte: asDate(q.to) } : {}),
      };
    }
    return prisma.exportIncentiveClaim.findMany({
      where,
      orderBy: [{ shippingBillDate: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  private async claim(id: string) {
    const row = await prisma.exportIncentiveClaim.findFirst({ where: { id } });
    if (!row) throw new ApiError(404, "That claim does not exist");
    return row;
  }

  private async assertUnique(scheme: string, shippingBillNo: string) {
    const clash = await prisma.exportIncentiveClaim.findFirst({
      where: { scheme: scheme as CreateClaimInput["scheme"], shippingBillNo },
      select: { id: true },
    });
    if (clash) {
      throw new ApiError(
        409,
        "A claim under this scheme already exists for that shipping bill",
        "DUPLICATE_CLAIM"
      );
    }
  }

  private expected(fob: number, rate?: number | null, entered?: number) {
    if (rate !== undefined && rate !== null) return n2((fob * rate) / 100);
    return n2(entered ?? 0);
  }

  async createClaim(input: CreateClaimInput, userId?: string) {
    await this.assertUnique(input.scheme, input.shippingBillNo);
    if (input.salesInvoiceId) await this.exportInvoice(input.salesInvoiceId);
    return prisma.exportIncentiveClaim.create({
      data: {
        scheme: input.scheme,
        shippingBillNo: input.shippingBillNo,
        shippingBillDate: asDate(input.shippingBillDate),
        portCode: input.portCode || null,
        salesInvoiceId: input.salesInvoiceId ?? null,
        fobValueInr: input.fobValueInr,
        ratePercent: input.ratePercent ?? null,
        expectedAmount: this.expected(input.fobValueInr, input.ratePercent, input.expectedAmount),
        notes: input.notes ?? null,
        createdBy: userId ?? null,
      } as Prisma.ExportIncentiveClaimUncheckedCreateInput,
    });
  }

  private async exportInvoice(id: string) {
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id },
      select: {
        id: true,
        exportType: true,
        shippingBillNo: true,
        shippingBillDate: true,
        portCode: true,
        invoiceDate: true,
        subTotal: true,
        totalDiscount: true,
      },
    });
    if (!invoice) throw new ApiError(404, "That sales invoice does not exist");
    return invoice;
  }

  async createFromInvoice(salesInvoiceId: string, input: FromInvoiceInput, userId?: string) {
    const invoice = await this.exportInvoice(salesInvoiceId);
    if (!invoice.exportType || !invoice.shippingBillNo) {
      throw new ApiError(
        422,
        "That invoice is not an export invoice with a shipping bill",
        "NOT_EXPORT_INVOICE"
      );
    }
    const fob = input.fobValueInr ?? n2(n2(invoice.subTotal) - n2(invoice.totalDiscount));
    if (!(fob > 0)) throw new ApiError(422, "Give the FOB value for this shipping bill");
    return this.createClaim(
      {
        scheme: input.scheme,
        shippingBillNo: invoice.shippingBillNo.toUpperCase(),
        shippingBillDate: (invoice.shippingBillDate ?? invoice.invoiceDate).toISOString(),
        portCode: invoice.portCode ?? undefined,
        salesInvoiceId: invoice.id,
        fobValueInr: fob,
        ratePercent: input.ratePercent,
        expectedAmount: input.expectedAmount ?? (input.ratePercent === undefined ? 0 : undefined),
      },
      userId
    );
  }

  async updateClaim(id: string, input: UpdateClaimInput) {
    const row = await this.claim(id);
    if (input.status && input.status !== row.status) {
      if (TERMINAL.has(row.status)) {
        throw new ApiError(409, "This claim is closed and cannot change status", "CLAIM_CLOSED");
      }
      if (input.status !== "REJECTED" && rank(input.status) < rank(row.status)) {
        throw new ApiError(409, "A claim's status only moves forward", "STATUS_BACKWARD");
      }
    }
    const scripDate = input.scripDate !== undefined ? optDate(input.scripDate) : row.scripDate;
    if (scripDate && scripDate < row.shippingBillDate) {
      throw new ApiError(
        400,
        "The scrip date cannot be before the shipping bill date",
        "VALIDATION_ERROR"
      );
    }
    const scrolled = input.scrolledAmount !== undefined ? input.scrolledAmount : row.scrolledAmount;
    const utilised = input.utilisedAmount !== undefined ? input.utilisedAmount : row.utilisedAmount;
    if (n2(utilised) > 0 && (scrolled === null || n2(utilised) > n2(scrolled))) {
      throw new ApiError(
        400,
        "The utilised amount cannot exceed the scrolled amount",
        "VALIDATION_ERROR"
      );
    }
    const fob = input.fobValueInr ?? n2(row.fobValueInr);
    const rate = input.ratePercent !== undefined ? input.ratePercent : row.ratePercent;
    const data: Prisma.ExportIncentiveClaimUpdateInput = {
      status: input.status,
      portCode: input.portCode,
      fobValueInr: input.fobValueInr,
      ratePercent: input.ratePercent,
      scrolledAmount: input.scrolledAmount,
      scrolledOn: optDate(input.scrolledOn),
      scripNo: input.scripNo,
      scripDate: optDate(input.scripDate),
      utilisedAmount: input.utilisedAmount,
      transferredTo: input.transferredTo,
      realisedInr: input.realisedInr,
      creditedOn: optDate(input.creditedOn),
      notes: input.notes,
    };
    if (rate !== null && rate !== undefined) {
      if (input.fobValueInr !== undefined || input.ratePercent !== undefined) {
        data.expectedAmount = this.expected(fob, n2(rate));
      }
    } else if (input.expectedAmount !== undefined) {
      data.expectedAmount = n2(input.expectedAmount);
    }
    if (input.scripDate !== undefined) {
      data.scripExpiresOn = input.scripDate ? addMonths(asDate(input.scripDate), 12) : null;
    }
    return prisma.exportIncentiveClaim.update({ where: { id: row.id }, data });
  }

  async deleteClaim(id: string) {
    const row = await this.claim(id);
    if (row.status !== "DECLARED") {
      throw new ApiError(
        409,
        "Only a claim still in DECLARED can be deleted",
        "CLAIM_NOT_DECLARED"
      );
    }
    await prisma.exportIncentiveClaim.delete({ where: { id: row.id } });
    return { id: row.id };
  }

  async summary() {
    const rows = await prisma.exportIncentiveClaim.findMany({
      select: {
        id: true,
        scheme: true,
        status: true,
        shippingBillNo: true,
        expectedAmount: true,
        scrolledAmount: true,
        scrolledOn: true,
        scripNo: true,
        scripExpiresOn: true,
        utilisedAmount: true,
        realisedInr: true,
        creditedOn: true,
      },
    });
    const now = today();
    const fyStart = asDate(
      `${now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1}-04-01`
    );
    const byScheme: Record<string, Record<string, { count: number; expected: number }>> = {};
    let pendingReceivable = 0;
    let creditedThisFy = 0;
    const scrolledNoScrip: { id: string; shippingBillNo: string; scrolledOn: Date | null }[] = [];
    const expiringScrips: {
      id: string;
      scripNo: string | null;
      scripExpiresOn: Date | null;
      unutilised: number;
    }[] = [];
    for (const r of rows) {
      const cell = ((byScheme[r.scheme] ??= {})[r.status] ??= { count: 0, expected: 0 });
      cell.count += 1;
      cell.expected = n2(cell.expected + n2(r.expectedAmount));
      if (!TERMINAL.has(r.status) && r.status !== "TRANSFERRED") {
        pendingReceivable = n2(
          pendingReceivable + n2(r.scrolledAmount ?? r.expectedAmount) - n2(r.utilisedAmount)
        );
      }
      if (r.status === "CREDITED" && r.creditedOn && r.creditedOn >= fyStart) {
        creditedThisFy = n2(creditedThisFy + n2(r.realisedInr ?? r.expectedAmount));
      }
      if (
        r.status === "SCROLLED" &&
        !r.scripNo &&
        r.scrolledOn &&
        now.getTime() - r.scrolledOn.getTime() > 30 * DAY
      ) {
        scrolledNoScrip.push({
          id: r.id,
          shippingBillNo: r.shippingBillNo,
          scrolledOn: r.scrolledOn,
        });
      }
      if (
        r.scripExpiresOn &&
        !TERMINAL.has(r.status) &&
        r.status !== "TRANSFERRED" &&
        r.scripExpiresOn >= now &&
        r.scripExpiresOn.getTime() - now.getTime() <= 60 * DAY
      ) {
        expiringScrips.push({
          id: r.id,
          scripNo: r.scripNo,
          scripExpiresOn: r.scripExpiresOn,
          unutilised: n2(n2(r.scrolledAmount) - n2(r.utilisedAmount)),
        });
      }
    }
    return {
      byScheme,
      pendingReceivable,
      creditedThisFy,
      scrolledNoScrip,
      expiringScrips,
    };
  }

  // ── Authorisations ─────────────────────────────────────────────────────────
  async listAuthorisations() {
    const rows = await prisma.exportAuthorisation.findMany({
      orderBy: [{ eoDueDate: "asc" }],
      include: { entries: { select: { fobValueInr: true, realisedOn: true } } },
      take: 500,
    });
    return rows.map(({ entries, ...a }) => ({ ...a, progress: this.progress(a, entries) }));
  }

  private progress(
    a: { exportObligationAmount: unknown; eoDueDate: Date; block1DueDate: Date | null },
    entries: { fobValueInr: unknown; realisedOn: Date | null }[]
  ) {
    const eo = n2(a.exportObligationAmount);
    const shippedFob = n2(entries.reduce((s, e) => s + n2(e.fobValueInr), 0));
    const realisedFob = n2(
      entries.filter((e) => e.realisedOn).reduce((s, e) => s + n2(e.fobValueInr), 0)
    );
    const eoPercent = eo > 0 ? n2((realisedFob / eo) * 100) : 0;
    const block1Percent = a.block1DueDate && eo > 0 ? n2((realisedFob / (eo / 2)) * 100) : null;
    const daysToDue = Math.round((a.eoDueDate.getTime() - today().getTime()) / DAY);
    return { shippedFob, realisedFob, eoPercent, block1Percent, daysToDue };
  }

  private async authorisation(id: string) {
    const row = await prisma.exportAuthorisation.findFirst({
      where: { id },
      include: { entries: { orderBy: { shippingBillDate: "asc" } } },
    });
    if (!row) throw new ApiError(404, "That authorisation does not exist");
    return row;
  }

  async getAuthorisation(id: string) {
    const row = await this.authorisation(id);
    return { ...row, progress: this.progress(row, row.entries) };
  }

  async createAuthorisation(input: CreateAuthorisationInput) {
    const clash = await prisma.exportAuthorisation.findFirst({
      where: { authNo: input.authNo },
      select: { id: true },
    });
    if (clash) {
      throw new ApiError(409, "That authorisation number is already recorded", "DUPLICATE_AUTH");
    }
    const epcg = input.authType === "EPCG";
    const eoMultiple = input.eoMultiple ?? 6;
    const eoAmount =
      input.exportObligationAmount ?? (epcg ? n2(input.dutySaved * eoMultiple) : undefined);
    if (!eoAmount || eoAmount <= 0) {
      throw new ApiError(
        400,
        "Give the export obligation amount for an Advance Authorisation",
        "VALIDATION_ERROR"
      );
    }
    const months = input.eoPeriodMonths ?? (epcg ? 72 : 18);
    const issue = asDate(input.issueDate);
    const created = await prisma.exportAuthorisation.create({
      data: {
        authType: input.authType,
        authNo: input.authNo,
        issueDate: issue,
        rlaOffice: input.rlaOffice || null,
        dutySaved: input.dutySaved,
        eoMultiple,
        exportObligationAmount: eoAmount,
        eoPeriodMonths: months,
        eoDueDate: addMonths(issue, months),
        block1DueDate: epcg ? addMonths(issue, 48) : null,
        notes: input.notes ?? null,
      } as Prisma.ExportAuthorisationUncheckedCreateInput,
    });
    return this.getAuthorisation(created.id);
  }

  async updateAuthorisation(id: string, input: UpdateAuthorisationInput) {
    const row = await this.authorisation(id);
    if (row.status === "CANCELLED" || row.status === "REDEEMED") {
      throw new ApiError(409, "This authorisation is closed", "AUTH_CLOSED");
    }
    const data: Prisma.ExportAuthorisationUpdateInput = {
      status: input.status,
      rlaOffice: input.rlaOffice,
      exportObligationAmount: input.exportObligationAmount,
      eodcNo: input.eodcNo,
      eodcDate: optDate(input.eodcDate),
      notes: input.notes,
    };
    if (input.eoPeriodMonths !== undefined) {
      data.eoPeriodMonths = input.eoPeriodMonths;
      data.eoDueDate = addMonths(row.issueDate, input.eoPeriodMonths);
    }
    await prisma.exportAuthorisation.update({ where: { id: row.id }, data });
    return this.getAuthorisation(row.id);
  }

  async addEntry(authorisationId: string, input: CreateEntryInput) {
    const auth = await this.authorisation(authorisationId);
    if (auth.status === "CANCELLED" || auth.status === "REDEEMED") {
      throw new ApiError(409, "This authorisation is closed", "AUTH_CLOSED");
    }
    if (auth.entries.some((e) => e.shippingBillNo === input.shippingBillNo)) {
      throw new ApiError(
        409,
        "That shipping bill is already counted against this authorisation",
        "DUPLICATE_ENTRY"
      );
    }
    await prisma.exportObligationEntry.create({
      data: {
        authorisationId: auth.id,
        shippingBillNo: input.shippingBillNo,
        shippingBillDate: asDate(input.shippingBillDate),
        salesInvoiceId: input.salesInvoiceId ?? null,
        fobValueInr: input.fobValueInr,
        realisedOn: input.realisedOn ? asDate(input.realisedOn) : null,
        brcNo: input.brcNo ?? null,
      } as Prisma.ExportObligationEntryUncheckedCreateInput,
    });
    return this.getAuthorisation(auth.id);
  }

  async removeEntry(authorisationId: string, entryId: string) {
    const auth = await this.authorisation(authorisationId);
    const entry = auth.entries.find((e) => e.id === entryId);
    if (!entry) throw new ApiError(404, "That entry does not exist");
    await prisma.exportObligationEntry.delete({ where: { id: entry.id } });
    return this.getAuthorisation(auth.id);
  }
}

export const exportIncentivesService = new ExportIncentivesService();
