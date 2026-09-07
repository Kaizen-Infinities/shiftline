import { z } from "zod";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { logger } from "../../lib/logger";
import { generatePdfFromHtml } from "../../utils/pdfGenerator";
import { sendEmail } from "../../utils/mailer";
import companyService from "../company/company.service";
import { WhatsappService } from "../whatsappservice/whatsapp.service";
import { accountsService } from "./accounts.service";
import { ageingService, type AgeingRow } from "./ageing.service";
import { renderStatementHtml } from "../../templates/statementTemplate";

/**
 * Statement of account for a customer or supplier (P1-10c): the party ledger for a period
 * (opening, entries, closing) plus the ageing of what is still unpaid, as JSON, as a PDF, or
 * sent to the party by email or WhatsApp. Sending uses the contact on the party record unless
 * the caller names another.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD");
export const statementQuerySchema = z.object({
  startDate: day.optional(),
  endDate: day.optional(),
});
export const sendStatementSchema = statementQuerySchema.extend({
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().trim().min(3).max(120).optional(),
  message: z.string().trim().max(500).optional(),
});
export type PartyType = "customer" | "supplier";
export type StatementQuery = z.infer<typeof statementQuerySchema>;
export type SendStatementInput = z.infer<typeof sendStatementSchema>;

const firstPhone = (raw: unknown): string | null => {
  if (Array.isArray(raw)) return raw.length ? String(raw[0]) : null;
  return typeof raw === "string" && raw ? raw : null;
};
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface StatementParty {
  type: PartyType;
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
}

class StatementService {
  async party(partyType: PartyType, id: string): Promise<StatementParty & { ledgerId: number }> {
    if (partyType === "customer") {
      if (!z.string().uuid().safeParse(id).success) throw new ApiError(404, "Customer not found");
      const c = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
      if (!c) throw new ApiError(404, "Customer not found");
      const ledger = await accountsService.ensureCustomerLedger(c);
      return {
        type: "customer",
        id: c.id,
        code: c.customerCode,
        name: c.firmName,
        email: c.email ?? null,
        phone: firstPhone(c.mobile),
        gstin: c.gstin ?? null,
        address: null,
        ledgerId: ledger.id,
      };
    }
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new ApiError(404, "Supplier not found");
    const s = await prisma.supplier.findFirst({ where: { id: numeric, deletedAt: null } });
    if (!s) throw new ApiError(404, "Supplier not found");
    const ledger = await accountsService.ensureSupplierLedger(s);
    return {
      type: "supplier",
      id: String(s.id),
      code: s.supplierCode,
      name: s.legalName,
      email: s.email ?? null,
      phone: s.whatsapp || firstPhone(s.mobile),
      gstin: s.gstin ?? null,
      address: [s.billingAddressLine1, s.billingCity, s.billingState, s.billingPincode]
        .filter(Boolean)
        .join(", "),
      ledgerId: ledger.id,
    };
  }

  async statement(partyType: PartyType, id: string, q: StatementQuery) {
    const endDate = q.endDate ?? todayIso();
    if (q.startDate && q.startDate > endDate) {
      throw new ApiError(400, "startDate must not be after endDate");
    }
    const party = await this.party(partyType, id);
    const [company, ledger, ageing] = await Promise.all([
      companyService.getCompany(),
      accountsService.getLedgerStatement(party.ledgerId, { startDate: q.startDate, endDate }),
      partyType === "customer"
        ? ageingService.receivable({ asOnDate: endDate, customerId: party.id })
        : ageingService.payable({ asOnDate: endDate, supplierId: party.id }),
    ]);
    const ageingRow: AgeingRow | null = ageing.rows[0] ?? null;
    const { ledgerId: _ledgerId, ...partyOut } = party;
    return {
      company: {
        name: company?.companyName ?? "",
        gstin: company?.gstin ?? null,
        address: [company?.addressLine1, company?.city, company?.state, company?.zipcode]
          .filter(Boolean)
          .join(", "),
        email: company?.email ?? null,
        phone: company?.phone ?? null,
        logoUrl: company?.logoUrl ?? null,
      },
      party: partyOut,
      startDate: q.startDate ?? null,
      endDate,
      openingBalance: ledger.openingBalance,
      closingBalance: ledger.closingBalance,
      entries: ledger.entries,
      ageing: ageingRow
        ? {
            buckets: ageingRow.buckets,
            total: ageingRow.total,
            overdue: ageingRow.overdue,
            interest: ageingRow.interest,
            documents: ageingRow.documents ?? [],
          }
        : null,
    };
  }

  async pdf(partyType: PartyType, id: string, q: StatementQuery) {
    const data = await this.statement(partyType, id, q);
    const buffer = await generatePdfFromHtml(renderStatementHtml(data));
    const filename = `Statement-${data.party.code}-${data.endDate}.pdf`.replace(/[^\w.-]+/g, "_");
    return { buffer, filename, data };
  }

  async send(partyType: PartyType, id: string, input: SendStatementInput) {
    const party = await this.party(partyType, id);
    const to = input.to ?? (input.channel === "email" ? party.email : party.phone);
    if (!to) {
      throw new ApiError(
        400,
        input.channel === "email"
          ? "The party has no email address; give one"
          : "The party has no phone number; give one"
      );
    }
    if (input.channel === "email" && !z.string().email().safeParse(to).success) {
      throw new ApiError(400, "That is not a valid email address");
    }
    if (input.channel === "whatsapp" && !/^\+?\d{10,15}$/.test(to.replace(/[\s-]/g, ""))) {
      throw new ApiError(400, "Phone numbers are 10 to 15 digits with the country code");
    }
    const { buffer, filename, data } = await this.pdf(partyType, id, {
      startDate: input.startDate,
      endDate: input.endDate,
    });
    const period = data.startDate
      ? `${data.startDate} to ${data.endDate}`
      : `up to ${data.endDate}`;
    const text =
      input.message ?? `Statement of account from ${data.company.name} for ${period} is attached.`;
    try {
      if (input.channel === "email") {
        await sendEmail({
          to,
          subject: `Statement of account ${period} — ${data.company.name}`,
          text,
          attachments: [{ filename, content: buffer }],
        });
      } else {
        const mediaId = await WhatsappService.uploadMedia(buffer, filename, "application/pdf");
        await WhatsappService.sendDocumentMessage(
          to.replace(/[\s-]/g, ""),
          mediaId,
          filename,
          text
        );
      }
    } catch (err) {
      logger.error({ err, channel: input.channel }, "statement send failed");
      throw new ApiError(
        502,
        input.channel === "email"
          ? "The email could not be sent; check the email settings"
          : "The WhatsApp message could not be sent; check the WhatsApp settings"
      );
    }
    return { channel: input.channel, to, filename };
  }
}

export const statementService = new StatementService();
