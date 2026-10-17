/**
 * Posts a field collection captured on the Field app into the ERP:
 *   1. appends a payment to each allocated Sales Invoice (payments JSON +
 *      sales_invoice_payments row) exactly like the web app's receipt flow,
 *   2. posts RECEIPT vouchers through the existing voucherPosting service
 *      (Cash → CASH-001, everything else → BANK-001, credit customer ledger),
 *   3. posts an "on account" RECEIPT voucher for any unallocated remainder,
 *   4. decrements customer.outstandingAmount,
 *   5. stores the MobileCollection row + idempotency record.
 * Everything runs in one transaction so a failure leaves nothing half-posted.
 * Collections are append-only: a device never updates or deletes one; the
 * office reverses through the books.
 */
import { Prisma, VoucherType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { emitToTenant } from "../../lib/realtime";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { periodService } from "../accounts/period.service";
import { safeCreateVoucher, voucherPostingService } from "../accounts/voucherPosting.service";
import { documentNumberService } from "../documents/document-number.service";
import { describeFailure } from "./mobile.errors";
import { extractPaymentsArray, num } from "./mobile.mappers";
import { AgentContext, CollectionRaw, DeviceInfo } from "./mobile.types";

const round2 = (n: number) => Math.round(n * 100) / 100;

class MobileCollectionService {
  /** Idempotent: returns the existing collection if this client id was seen before. */
  async post(agent: AgentContext, raw: CollectionRaw, device?: DeviceInfo | null) {
    const existing = await prisma.mobileCollection.findUnique({ where: { id: raw.id } });
    if (existing) return existing;

    const allocated = round2(raw.allocations.reduce((s, a) => s + a.amount, 0));
    if (allocated - raw.amount > 0.009) {
      throw new ApiError(400, `Allocated ₹${allocated} exceeds collected amount ₹${raw.amount}`);
    }
    const onAccount = round2(raw.amount - allocated);
    const collectedAt = new Date(raw.collected_at);
    const paymentDate = collectedAt.toISOString().slice(0, 10);

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.postOnce(
          agent,
          raw,
          { allocated, onAccount, collectedAt, paymentDate },
          device
        );
      } catch (err: unknown) {
        // Receipt numbers come from the atomic document series; a P2002 can still come from a
        // concurrent push of the same collection id — retry and the idempotency check wins.
        if ((err as { code?: string })?.code === "P2002" && attempt < 3) continue;
        throw err;
      }
    }
  }

  private async postOnce(
    agent: AgentContext,
    raw: CollectionRaw,
    ctx: { allocated: number; onAccount: number; collectedAt: Date; paymentDate: string },
    device?: DeviceInfo | null
  ) {
    const companyId = requireTenantId();
    const agentId = agent.userId.slice(0, 36);
    const collection = await prisma.$transaction(
      async (tx) => {
        // Period control: a collection dated in a closed or frozen period is rejected whole.
        await periodService.assertPostingAllowed(ctx.collectedAt, undefined, tx);

        const customer = await tx.customer.findUnique({ where: { id: raw.customer_id } });
        if (!customer) throw new ApiError(404, "Customer not found");
        if (customer.deletedAt) throw new ApiError(400, "Customer has been deleted");

        // ── 1. Invoice allocations ─────────────────────────────────────────
        const touchedInvoiceIds: string[] = [];
        const paymentRowIds: { invoiceId: string; paymentId: string; rowId: string }[] = [];

        for (const alloc of raw.allocations) {
          const inv = await tx.salesInvoice.findUnique({ where: { id: alloc.invoiceId } });
          if (!inv)
            throw new ApiError(404, `Invoice ${alloc.invoiceNo || alloc.invoiceId} not found`);
          if (inv.customerId !== raw.customer_id) {
            throw new ApiError(400, `Invoice ${inv.invoiceNo} does not belong to this customer`);
          }
          const payments = extractPaymentsArray(inv.payments);
          const paidSoFar = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const balance = round2(num(inv.grandTotal) - paidSoFar);
          if (alloc.amount - balance > 0.009) {
            throw new ApiError(
              400,
              `Invoice ${inv.invoiceNo}: allocation ₹${alloc.amount} exceeds balance ₹${balance}`
            );
          }

          // Stable per collection+invoice and short enough for Voucher.refDocId (36 chars).
          const paymentId = `mc-${raw.id.slice(0, 18)}-${inv.id.slice(0, 8)}`;
          payments.push({
            id: paymentId,
            amount: alloc.amount,
            paymentMethod: raw.payment_mode,
            referenceNumber: raw.reference_no || null,
            paymentDate: ctx.paymentDate,
            recordedBy: agent.userId,
            source: "MOBILE",
            mobileCollectionId: raw.id,
          });
          const nowPaid = round2(paidSoFar + alloc.amount);
          const fullyPaid = nowPaid >= num(inv.grandTotal) - 0.009;

          await tx.salesInvoice.update({
            where: { id: inv.id },
            data: {
              payments: payments as unknown as Prisma.InputJsonValue,
              ...(fullyPaid ? { status: "PAID" } : {}),
            },
          });

          const row = await tx.salesInvoicePayment.create({
            data: {
              salesInvoiceId: inv.id,
              amount: new Prisma.Decimal(alloc.amount),
              paymentMethod: raw.payment_mode,
              referenceNumber: raw.reference_no || null,
              paymentDate: new Date(ctx.paymentDate),
              recordedBy: agentId,
              voucherPosted: false,
            },
          });
          touchedInvoiceIds.push(inv.id);
          paymentRowIds.push({ invoiceId: inv.id, paymentId, rowId: row.id });
        }

        // ── 2. Receipt vouchers for the invoice payments (existing ERP logic) ─
        const voucherIds: number[] = [];
        for (const invoiceId of touchedInvoiceIds) {
          const vouchers = await voucherPostingService.postReceiptVouchersForSales(invoiceId, tx);
          for (const v of vouchers) {
            if (v?.id) voucherIds.push(Number(v.id));
            const match = paymentRowIds.find(
              (p) => p.invoiceId === invoiceId && v?.refDocId === p.paymentId
            );
            if (match && v?.id) {
              await tx.salesInvoicePayment.update({
                where: { id: match.rowId },
                data: { voucherPosted: true, sourceVoucherId: String(v.id) },
              });
            }
          }
        }

        // ── 3. Receipt number from the RECEIPT series (branch/FY aware, atomic) ─
        const receiptNo = await documentNumberService.next("RECEIPT", {
          date: ctx.collectedAt,
          tx,
        });

        // ── 4. On-account receipt (unallocated remainder) ──────────────────
        if (ctx.onAccount > 0) {
          await accountsService.ensureSystemLedgersExist(tx);
          const customerLedger = await accountsService.ensureCustomerLedger(customer, tx);
          const isCash = raw.payment_mode.toLowerCase().includes("cash");
          const moneyLedger = await tx.accountLedger.findUnique({
            where: { companyId_code: { companyId, code: isCash ? "CASH-001" : "BANK-001" } },
          });
          if (!moneyLedger) {
            throw new ApiError(500, "Cash/Bank ledger missing — open Accounts once in the web app");
          }
          const amountDec = new Prisma.Decimal(ctx.onAccount);
          const voucher = await safeCreateVoucher(
            tx,
            {
              voucherNo: receiptNo,
              type: VoucherType.RECEIPT,
              date: ctx.collectedAt,
              narration: `On-account receipt from ${customer.firmName} via ${raw.payment_mode}${
                raw.reference_no ? ` (Ref: ${raw.reference_no})` : ""
              } — mobile receipt ${receiptNo}`,
              refDocType: "MOBILE_COLLECTION",
              refDocId: raw.id,
              createdBy: agentId,
              items: {
                create: [
                  {
                    debitLedgerId: moneyLedger.id,
                    debitAmount: amountDec,
                    creditAmount: new Prisma.Decimal(0),
                    narration: `Received via ${raw.payment_mode}`,
                  },
                  {
                    creditLedgerId: customerLedger.id,
                    debitAmount: new Prisma.Decimal(0),
                    creditAmount: amountDec,
                    narration: `On-account receipt from ${customer.firmName}`,
                  },
                ],
              },
            },
            "MOBILE_COLLECTION",
            raw.id
          );
          voucherIds.push(voucher.id);
        }

        // ── 5. Customer outstanding + collection row + idempotency map ─────
        await tx.customer.update({
          where: { id: customer.id },
          data: { outstandingAmount: { decrement: new Prisma.Decimal(raw.amount) } },
        });

        const created = await tx.mobileCollection.create({
          data: {
            id: raw.id,
            receiptNo,
            agentUserId: agentId,
            customerId: raw.customer_id,
            visitId: raw.visit_id ?? null,
            amount: new Prisma.Decimal(raw.amount),
            paymentMode: raw.payment_mode,
            referenceNo: raw.reference_no ?? null,
            bankName: raw.bank_name ?? null,
            chequeDate: raw.cheque_date ? new Date(raw.cheque_date) : null,
            drawerName: raw.drawer_name ?? null,
            collectedAt: ctx.collectedAt,
            notes: raw.notes ?? null,
            allocations: raw.allocations as unknown as Prisma.InputJsonValue,
            attachments: raw.attachments as unknown as Prisma.InputJsonValue,
            voucherIds: voucherIds as unknown as Prisma.InputJsonValue,
            status: "POSTED",
            deviceId: device?.deviceId ?? null,
            appVersion: device?.appVersion ?? null,
          },
        });

        await tx.mobileSyncRecord.upsert({
          where: { companyId_clientId: { companyId, clientId: raw.id } },
          create: {
            companyId,
            clientId: raw.id,
            entityType: "COLLECTION",
            serverId: created.id,
            agentUserId: agentId,
            deviceId: device?.deviceId ?? null,
            status: "OK",
          },
          update: { serverId: created.id, status: "OK", error: null },
        });

        if (raw.visit_id) {
          await tx.mobileVisit.updateMany({
            where: { id: raw.visit_id, agentUserId: agentId },
            data: { outcome: "COLLECTION" },
          });
        }

        return created;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    emitToTenant("salesInvoice:updated", { source: "mobile", collectionId: collection.id });
    emitToTenant("payment:created", { source: "mobile", collectionId: collection.id });
    emitToTenant("voucher:created", { source: "mobile" });
    emitToTenant("accountLedger:updated", { source: "mobile" });
    emitToTenant("customer:updated", { id: collection.customerId, source: "mobile" });
    emitToTenant("mobileCollection:created", collection);
    return collection;
  }

  /**
   * Called when posting failed during push: persists the record as FAILED so the
   * agent sees the reason on the device and the office can repost from the web.
   */
  async recordFailure(
    agent: AgentContext,
    raw: CollectionRaw,
    error: string,
    device?: DeviceInfo | null
  ) {
    const companyId = requireTenantId();
    const agentId = agent.userId.slice(0, 36);
    const message = error.slice(0, 500);
    const receiptNo = `MC-FAILED-${raw.id.slice(0, 8)}`;
    await prisma.$transaction(async (tx) => {
      const customerExists = (await tx.customer.count({ where: { id: raw.customer_id } })) > 0;
      // Without a customer the collection row cannot exist (FK); the sync
      // record keeps the payload so the device still sees the failure on pull.
      if (customerExists)
        await tx.mobileCollection.upsert({
          where: { id: raw.id },
          create: {
            id: raw.id,
            receiptNo,
            agentUserId: agentId,
            customerId: raw.customer_id,
            visitId: raw.visit_id ?? null,
            amount: new Prisma.Decimal(raw.amount),
            paymentMode: raw.payment_mode,
            referenceNo: raw.reference_no ?? null,
            bankName: raw.bank_name ?? null,
            chequeDate: raw.cheque_date ? new Date(raw.cheque_date) : null,
            drawerName: raw.drawer_name ?? null,
            collectedAt: new Date(raw.collected_at),
            notes: raw.notes ?? null,
            allocations: raw.allocations as unknown as Prisma.InputJsonValue,
            attachments: raw.attachments as unknown as Prisma.InputJsonValue,
            status: "FAILED",
            syncError: message,
            deviceId: device?.deviceId ?? null,
            appVersion: device?.appVersion ?? null,
          },
          update: { status: "FAILED", syncError: message },
        });
      await tx.mobileSyncRecord.upsert({
        where: { companyId_clientId: { companyId, clientId: raw.id } },
        create: {
          companyId,
          clientId: raw.id,
          entityType: "COLLECTION",
          agentUserId: agentId,
          deviceId: device?.deviceId ?? null,
          status: "FAILED",
          error: message,
          payload: raw as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: "FAILED",
          error: message,
          payload: raw as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }

  /** Office-side retry of a FAILED collection (e.g. after fixing the invoice). */
  async repost(collectionId: string) {
    const failed = await prisma.mobileCollection.findUnique({ where: { id: collectionId } });
    if (!failed) throw new ApiError(404, "Collection not found");
    if (failed.status !== "FAILED")
      throw new ApiError(400, "Only FAILED collections can be reposted");

    const agent: AgentContext = {
      userId: failed.agentUserId,
      fullName: "",
      isSuperAdmin: false,
      permissions: [],
    };
    const raw: CollectionRaw = {
      id: failed.id,
      customer_id: failed.customerId,
      visit_id: failed.visitId,
      amount: num(failed.amount),
      payment_mode: failed.paymentMode as CollectionRaw["payment_mode"],
      reference_no: failed.referenceNo,
      bank_name: failed.bankName,
      cheque_date: failed.chequeDate ? failed.chequeDate.toISOString().slice(0, 10) : null,
      drawer_name: failed.drawerName,
      collected_at: failed.collectedAt.getTime(),
      notes: failed.notes,
      allocations: (failed.allocations as CollectionRaw["allocations"]) || [],
      attachments: (failed.attachments as CollectionRaw["attachments"]) || [],
    };
    const device = failed.deviceId
      ? { deviceId: failed.deviceId, appVersion: failed.appVersion ?? undefined }
      : null;

    // Remove the placeholder so post() can create the real row atomically.
    const companyId = requireTenantId();
    await prisma.$transaction(async (tx) => {
      await tx.mobileCollection.delete({ where: { id: collectionId } });
      await tx.mobileSyncRecord.deleteMany({ where: { companyId, clientId: collectionId } });
    });
    try {
      return await this.post(agent, raw, device);
    } catch (err: unknown) {
      await this.recordFailure(agent, raw, describeFailure(err, { collectionId }).message, device);
      throw err;
    }
  }
}

export const mobileCollectionService = new MobileCollectionService();
