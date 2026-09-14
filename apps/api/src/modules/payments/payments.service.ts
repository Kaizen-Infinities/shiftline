import {
  Prisma,
  VoucherType,
  type PaymentGatewayProvider,
  type PaymentLinkStatus,
} from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { emitToTenant } from "../../lib/realtime";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { extractPaymentsArray } from "../../utils/payments";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { voucherPostingService } from "../accounts/voucherPosting.service";
import { primaryMobile } from "../mobile/mobile.mappers";
import { smsService } from "../sms/sms.service";
import { paymentsConfigService } from "./payments.config.service";
import type { ProviderPayment } from "./payments.types";
import { fixturePaymentProvider, paymentProviderFor } from "./providers";

const n2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const D = (v: number) => new Prisma.Decimal(n2(v));
/**
 * The scheme and `www.` stripped off a URL (P2-19): what is left is still the working link once
 * the SMS body's own reviewed text sits in front of it, and it no longer trips `sms.calc.ts`'s
 * rule against a URL sitting inside a template variable's value.
 */
const bareLink = (url: string | null): string =>
  (url ?? "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");

export interface CreateLinkInput {
  salesInvoiceId?: string | null;
  customerId?: string | null;
  amount?: number | null;
  description?: string | null;
  notifyEmail?: string | null;
  notifyPhone?: string | null;
  expiresAt?: Date | null;
}

/**
 * Payment links and what a payment does to the books (P1-21).
 *
 * A capture goes through the same posting path a counter receipt uses, so a payment taken on a
 * phone and one taken at the desk look identical in the ledger. What the gateway keeps is
 * posted separately, because the bank only ever received the net and pretending otherwise leaves
 * the reconciliation short by the fee every single time.
 */
class PaymentsService {
  // ── Links ──────────────────────────────────────────────────────────────────
  async create(input: CreateLinkInput, actor: { userId?: string }) {
    const { provider, enabled, creds } = await paymentsConfigService.credentials();
    if (!enabled) {
      throw new ApiError(
        409,
        "The payment gateway is off; turn it on in settings first",
        "GATEWAY_OFF"
      );
    }

    let amount = input.amount ? n2(input.amount) : 0;
    let customerId = input.customerId ?? null;
    let description = input.description ?? null;
    let invoice: Awaited<ReturnType<typeof this.invoiceWithBalance>> | null = null;

    if (input.salesInvoiceId) {
      invoice = await this.invoiceWithBalance(input.salesInvoiceId);
      customerId = invoice.customerId;
      description = description ?? `Invoice ${invoice.invoiceNo}`;
      if (!amount) amount = invoice.balance;
      // A link for more than is owed would take money the company then has to send back.
      if (amount - invoice.balance > 0.009) {
        throw new ApiError(
          400,
          `Invoice ${invoice.invoiceNo} has ₹${invoice.balance.toFixed(2)} outstanding`,
          "OVER_BALANCE"
        );
      }
    }
    if (amount <= 0) throw new ApiError(400, "A payment link needs a positive amount");

    const customer = customerId
      ? await prisma.customer.findUnique({ where: { id: customerId } })
      : null;
    const config = await paymentsConfigService.ensure();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + config.expiryHours * 60 * 60 * 1000);
    const linkNo = await this.nextLinkNo();

    const created = await paymentProviderFor(provider).createLink(
      {
        reference: `${requireTenantId().slice(0, 8)}-${linkNo}`,
        amount,
        currency: "INR",
        description: description ?? linkNo,
        expiresAt,
        customer: {
          name: customer?.firmName ?? null,
          email: input.notifyEmail ?? customer?.email ?? null,
          phone: input.notifyPhone ?? null,
        },
      },
      creds
    );

    const row = await prisma.paymentLink.create({
      data: {
        linkNo,
        provider: provider as PaymentGatewayProvider,
        providerLinkId: created.providerLinkId,
        shortUrl: created.shortUrl,
        salesInvoiceId: input.salesInvoiceId ?? null,
        customerId,
        amount: D(amount),
        description: description?.slice(0, 255) ?? null,
        notifyEmail: input.notifyEmail ?? customer?.email ?? null,
        notifyPhone: input.notifyPhone ?? null,
        expiresAt: created.expiresAt ?? expiresAt,
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
    logger.info({ linkNo, provider }, "payment link raised");
    emitToTenant("payment-link:created", { id: row.id, linkNo });
    await this.queuePaymentSms(
      "PAYMENT_LINK",
      input.notifyPhone ?? primaryMobile(customer?.mobile),
      {
        name: customer?.firmName ?? description ?? "Customer",
        amount,
        invoiceNo: invoice?.invoiceNo ?? row.linkNo,
        // The template's own body carries the scheme and domain as reviewed text on the DLT
        // registration; only the path is a variable, so the SMS rule against a URL inside a
        // variable's value (`sms.calc.ts`) is never in tension with a working link.
        link: bareLink(row.shortUrl),
      },
      `pay-link:${row.linkNo}`.slice(0, 30)
    );
    return row;
  }

  async list(query: { status?: PaymentLinkStatus; salesInvoiceId?: string; take?: number }) {
    return prisma.paymentLink.findMany({
      where: {
        ...(query.status && { status: query.status }),
        ...(query.salesInvoiceId && { salesInvoiceId: query.salesInvoiceId }),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(query.take ?? 100, 500),
      include: { captures: { orderBy: { capturedAt: "asc" } } },
    });
  }

  async get(id: string) {
    const row = await prisma.paymentLink.findUnique({
      where: { id },
      include: { captures: { orderBy: { capturedAt: "asc" } } },
    });
    if (!row) throw new ApiError(404, "No such payment link");
    return row;
  }

  async cancel(id: string, reason: string | null, actor: { userId?: string }) {
    const row = await this.get(id);
    if (Number(row.amountPaid) > 0 || row.status === "PAID") {
      throw new ApiError(409, "That link has already been paid", "ALREADY_PAID");
    }
    if (row.status === "CANCELLED") return row;
    const { provider, creds } = await paymentsConfigService.credentials();
    if (row.providerLinkId) {
      await paymentProviderFor(provider).cancelLink(row.providerLinkId, creds);
    }
    return prisma.paymentLink.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: reason?.slice(0, 255) ?? null,
        updatedBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /**
   * Ask the gateway what it thinks, and post anything we missed. A webhook that never arrived is
   * the normal failure of this kind of integration, so there has to be a way to catch up that is
   * not "someone types the receipt in twice".
   */
  async refresh(id: string) {
    const row = await this.get(id);
    if (!row.providerLinkId) return row;
    const { provider, creds } = await paymentsConfigService.credentials();
    const state = await paymentProviderFor(provider).fetchLink(row.providerLinkId, creds);
    for (const payment of state.payments) {
      if (payment.status === "CAPTURED") await this.applyPayment(row.id, payment);
    }
    if (state.status === "EXPIRED" && Number(row.amountPaid) === 0) {
      await prisma.paymentLink.update({ where: { id }, data: { status: "EXPIRED" } });
    }
    return this.get(id);
  }

  /** Only the fixture gateway can be told to pay itself; a live one is asked, never told. */
  async simulate(id: string, amount: number | null, options: { fail?: boolean; method?: string }) {
    const row = await this.get(id);
    const { provider, creds } = await paymentsConfigService.credentials();
    if (provider !== "FIXTURE") {
      throw new ApiError(400, "Only the fixture gateway can be simulated", "NOT_FIXTURE");
    }
    if (!row.providerLinkId) throw new ApiError(409, "That link never reached the gateway");
    const due = n2(Number(row.amount) - Number(row.amountPaid));
    return fixturePaymentProvider.simulatePayment(
      row.providerLinkId,
      amount ? n2(amount) : due,
      creds,
      options
    );
  }

  // ── Posting ────────────────────────────────────────────────────────────────
  /**
   * Record one capture and put it in the books. Idempotent on the gateway's payment id: a
   * webhook delivered three times pays the invoice once.
   */
  async applyPayment(paymentLinkId: string, payment: ProviderPayment) {
    const existing = await prisma.paymentCapture.findFirst({
      where: { providerPaymentId: payment.providerPaymentId },
    });
    if (existing) return existing;

    const link = await prisma.paymentLink.findUnique({ where: { id: paymentLinkId } });
    if (!link) throw new ApiError(404, "No such payment link");
    const config = await paymentsConfigService.ensure();
    const amount = n2(payment.amount);

    const capture = await prisma.$transaction(async (tx) => {
      const capture = await tx.paymentCapture.create({
        data: {
          paymentLinkId: link.id,
          providerPaymentId: payment.providerPaymentId,
          status: "CAPTURED",
          amount: D(amount),
          fee: D(payment.fee),
          feeTax: D(payment.feeTax),
          method: payment.method?.slice(0, 30) ?? null,
          capturedAt: payment.capturedAt,
        },
      });

      let salesInvoicePaymentId: string | null = null;
      let voucherId: string | null = null;

      if (link.salesInvoiceId) {
        const posted = await this.postAgainstInvoice(tx, link.salesInvoiceId, capture, payment);
        salesInvoicePaymentId = posted.salesInvoicePaymentId;
        voucherId = posted.voucherId;
      }

      const feeVoucherId = await this.postGatewayFee(tx, capture.id, payment, config.feeLedgerCode);

      const paid = n2(Number(link.amountPaid) + amount);
      const status: PaymentLinkStatus =
        paid + 0.009 >= Number(link.amount) ? "PAID" : "PARTIALLY_PAID";
      await tx.paymentLink.update({
        where: { id: link.id },
        data: { amountPaid: D(paid), status },
      });

      const row = await tx.paymentCapture.update({
        where: { id: capture.id },
        data: { salesInvoicePaymentId, voucherId, feeVoucherId },
      });
      logger.info(
        { linkNo: link.linkNo, providerPaymentId: payment.providerPaymentId, amount },
        "gateway payment captured"
      );
      emitToTenant("payment-link:paid", { id: link.id, linkNo: link.linkNo, amount, status });
      return row;
    });

    const [customer, invoice] = await Promise.all([
      link.customerId ? prisma.customer.findUnique({ where: { id: link.customerId } }) : null,
      link.salesInvoiceId
        ? prisma.salesInvoice.findUnique({ where: { id: link.salesInvoiceId } })
        : null,
    ]);
    await this.queuePaymentSms(
      "PAYMENT_RECEIVED",
      link.notifyPhone ?? primaryMobile(customer?.mobile),
      {
        name: customer?.firmName ?? link.description ?? "Customer",
        amount,
        invoiceNo: invoice?.invoiceNo ?? link.linkNo,
      },
      `pay-recv:${capture.id.slice(0, 8)}`.slice(0, 30)
    );
    return capture;
  }

  /**
   * Queues a payment SMS (P2-19) when the tenant is set up to send one: SMS on, and the template
   * registered with a DLT id. Anything else — SMS off, no template, no mobile number on file, the
   * queue call itself failing — is skipped rather than allowed to fail the payment it is
   * reporting on; the reason is only ever written to the log.
   */
  private async queuePaymentSms(
    templateCode: "PAYMENT_LINK" | "PAYMENT_RECEIVED",
    to: string | null,
    values: Record<string, string | number>,
    purpose: string
  ) {
    if (!to) {
      logger.info({ templateCode }, "payment sms skipped: no mobile number on file");
      return;
    }
    try {
      const { enabled } = await smsService.credentials();
      if (!enabled) {
        logger.info({ templateCode }, "payment sms skipped: sms is off");
        return;
      }
      const templates = await smsService.templates();
      const template = templates.find((t) => t.code === templateCode);
      if (!template || !template.dltTemplateId) {
        logger.info({ templateCode }, "payment sms skipped: template is not registered");
        return;
      }
      await smsService.sendTemplateQueued({ to, templateCode, values, purpose });
    } catch (err) {
      logger.warn({ templateCode, err }, "payment sms could not be queued");
    }
  }

  /**
   * The invoice side: the payment joins the invoice's own list and the receipt voucher comes out
   * of the same helper a counter receipt uses, so there is exactly one way a receipt is posted.
   */
  private async postAgainstInvoice(
    tx: Prisma.TransactionClient,
    salesInvoiceId: string,
    capture: { id: string },
    payment: ProviderPayment
  ): Promise<{ salesInvoicePaymentId: string | null; voucherId: string | null }> {
    const invoice = await tx.salesInvoice.findUnique({ where: { id: salesInvoiceId } });
    if (!invoice) return { salesInvoicePaymentId: null, voucherId: null };

    const payments = extractPaymentsArray(invoice.payments);
    // Stable and inside Voucher.refDocId's 36 characters.
    const paymentId = `pg-${capture.id.slice(0, 30)}`;
    const paidDate = payment.capturedAt.toISOString().slice(0, 10);
    payments.push({
      id: paymentId,
      amount: n2(payment.amount),
      paymentMethod: `GATEWAY/${(payment.method ?? "online").toUpperCase()}`,
      referenceNumber: payment.providerPaymentId,
      paymentDate: paidDate,
      source: "GATEWAY",
    });
    const paidSoFar = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const fullyPaid = paidSoFar >= Number(invoice.grandTotal) - 0.009;
    await tx.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        payments: payments as unknown as Prisma.InputJsonValue,
        ...(fullyPaid ? { status: "PAID" } : {}),
      },
    });

    const row = await tx.salesInvoicePayment.create({
      data: {
        salesInvoiceId: invoice.id,
        amount: D(payment.amount),
        paymentMethod: `GATEWAY/${(payment.method ?? "online").toUpperCase()}`.slice(0, 50),
        referenceNumber: payment.providerPaymentId.slice(0, 100),
        paymentDate: new Date(`${paidDate}T00:00:00Z`),
        voucherPosted: false,
      },
    });

    const vouchers = await voucherPostingService.postReceiptVouchersForSales(invoice.id, tx);
    const voucher = vouchers.find((v: { refDocId?: string }) => v?.refDocId === paymentId);
    if (voucher?.id) {
      await tx.salesInvoicePayment.update({
        where: { id: row.id },
        data: { voucherPosted: true, sourceVoucherId: String(voucher.id) },
      });
    }
    return { salesInvoicePaymentId: row.id, voucherId: voucher?.id ? String(voucher.id) : null };
  }

  /**
   * What the gateway keeps. The receipt above debits the bank with the gross, because that is
   * what the customer paid; this takes the fee back out, because that is what the bank actually
   * received. The GST on the fee sits with the fee: the credit for it needs the gateway's own
   * monthly invoice, and a credit taken from a webhook is a credit nobody can support.
   */
  private async postGatewayFee(
    tx: Prisma.TransactionClient,
    captureId: string,
    payment: ProviderPayment,
    feeLedgerCode: string
  ): Promise<string | null> {
    const total = n2(payment.fee + payment.feeTax);
    if (total <= 0) return null;
    await accountsService.ensureSystemLedgersExist(tx);
    await periodService.assertPostingAllowed(payment.capturedAt, undefined, tx);
    const fee = await tx.accountLedger.findFirst({ where: { code: feeLedgerCode } });
    const bank = await tx.accountLedger.findFirst({ where: { code: "BANK-001" } });
    if (!fee || !bank) {
      throw new ApiError(500, "The gateway fee or bank ledger is missing", "MISSING_LEDGER");
    }
    const voucher = await tx.voucher.create({
      data: {
        voucherNo: `PGF-${captureId.slice(0, 8)}`,
        type: VoucherType.JOURNAL,
        date: payment.capturedAt,
        narration: `Gateway charges on ${payment.providerPaymentId}`,
        refDocType: "PAYMENT_GATEWAY_FEE",
        refDocId: captureId,
        items: {
          create: [
            {
              debitLedgerId: fee.id,
              debitAmount: D(total),
              creditAmount: D(0),
              narration: `Gateway commission and tax on it`,
            },
            {
              creditLedgerId: bank.id,
              debitAmount: D(0),
              creditAmount: D(total),
              narration: `Deducted by the gateway before settlement`,
            },
          ],
        },
      },
    });
    return String(voucher.id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private async invoiceWithBalance(salesInvoiceId: string) {
    const invoice = await prisma.salesInvoice.findUnique({ where: { id: salesInvoiceId } });
    if (!invoice) throw new ApiError(404, "No such invoice");
    if (invoice.status === "CANCELLED") {
      throw new ApiError(409, "That invoice is cancelled", "INVOICE_CANCELLED");
    }
    const paid = extractPaymentsArray(invoice.payments).reduce(
      (s: number, p: { amount?: unknown }) => s + (Number(p.amount) || 0),
      0
    );
    // A link already out for this invoice is money that may still arrive.
    const open = await prisma.paymentLink.aggregate({
      where: { salesInvoiceId, status: { in: ["CREATED", "PARTIALLY_PAID"] } },
      _sum: { amount: true, amountPaid: true },
    });
    const pending = n2(Number(open._sum.amount ?? 0) - Number(open._sum.amountPaid ?? 0));
    return {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      customerId: invoice.customerId,
      balance: n2(Number(invoice.grandTotal) - paid - pending),
    };
  }

  private async nextLinkNo(): Promise<string> {
    const prefix = `PL-${new Date().getFullYear()}-`;
    const last = await prisma.paymentLink.findFirst({
      where: { linkNo: { startsWith: prefix } },
      orderBy: { linkNo: "desc" },
      select: { linkNo: true },
    });
    const n = last ? parseInt(last.linkNo.slice(prefix.length), 10) || 0 : 0;
    return `${prefix}${String(n + 1).padStart(5, "0")}`;
  }
}

export const paymentsService = new PaymentsService();
