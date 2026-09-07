import { prisma } from "../../config/prisma";
import { Prisma, SupplyType } from "@prisma/client";
import { ApiError } from "../../utils/ApiError";
import {
  CreateSalesReturnInput,
  CreatePurchaseReturnInput,
  UpdatePurchaseReturnInput,
} from "./returns.types";
import { voucherPostingService } from "../accounts/voucherPosting.service";
import rawMaterialStockService from "../raw-material-stock/raw-material-stock.service";
import { logger } from "../../lib/logger";
import { byCode } from "../../lib/prisma";
import type { Db } from "../../lib/prisma";
import { documentNumberService } from "../documents/document-number.service";
import { splitGst } from "../gst/gst.calc";
import { productTaxDefaults, purchaseGstContext, rawMaterialTaxDefaults } from "../gst/gst.context";
import { saleGstContext } from "../sales-invoice/sales-invoice.service";
import { periodService } from "../accounts/period.service";
import { cancellationService } from "../accounts/cancellation.service";

const D = (n: number | string) => new Prisma.Decimal(n);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Returns and the credit/debit notes they raise (P1-08b). Every return carries
 * the tax split of the original supply so the note lands in GSTR-1 CDNR and the
 * output/input tax reverses on the books. A `PRICE_ADJUSTMENT` moves no stock.
 */
class ReturnsService {
  // --- SALES RETURN ---
  async getSalesReturns(companyId?: string) {
    return prisma.salesReturn.findMany({
      where: companyId ? { companyId } : undefined,
      include: {
        customer: {
          select: {
            id: true,
            firmName: true,
            customerCode: true,
            customerGradeId: true,
            customerGrade: { select: { id: true, name: true } },
          },
        },
        salesInvoice: { select: { id: true, invoiceNo: true } },
        items: { include: { product: { select: { id: true, productName: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Validates return quantities against the invoice and computes the taxed lines. */
  private async buildSalesReturnLines(
    tx: Db,
    data: Omit<CreateSalesReturnInput, "businessPlaceId"> & {
      businessPlaceId?: string | number | bigint | null;
    },
    customer: Prisma.CustomerGetPayload<{ include: { addresses: true } }>,
    excludeReturnId?: string
  ) {
    let invoice: Prisma.SalesInvoiceGetPayload<{ include: { items: true } }> | null = null;
    if (data.salesInvoiceId) {
      invoice = await tx.salesInvoice.findUnique({
        where: { id: data.salesInvoiceId },
        include: { items: true },
      });
      if (!invoice) throw new ApiError(404, "Original sales invoice not found");
      if (invoice.customerId !== data.customerId) {
        throw new ApiError(400, "Sales invoice does not belong to the selected customer");
      }

      const previousReturns = await tx.salesReturn.findMany({
        where: {
          salesInvoiceId: data.salesInvoiceId,
          status: { not: "CANCELLED" },
          ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}),
        },
        include: { items: true },
      });
      const returnedQtyMap = new Map<string, number>();
      for (const ret of previousReturns) {
        for (const item of ret.items) {
          if (item.salesInvoiceItemId) {
            const current = returnedQtyMap.get(item.salesInvoiceItemId) || 0;
            returnedQtyMap.set(item.salesInvoiceItemId, current + Number(item.quantity));
          }
        }
      }
      for (const itemInput of data.items) {
        if (!itemInput.salesInvoiceItemId) continue;
        const invItem = invoice.items.find((i) => i.id === itemInput.salesInvoiceItemId);
        if (!invItem) {
          throw new ApiError(
            400,
            `Invoice item ${itemInput.salesInvoiceItemId} not found in invoice ${data.salesInvoiceId}`
          );
        }
        const alreadyReturned = returnedQtyMap.get(itemInput.salesInvoiceItemId) || 0;
        const originalQty = Number(invItem.quantity);
        const remainingReturnable = originalQty - alreadyReturned;
        if (itemInput.quantity > remainingReturnable) {
          throw new ApiError(
            400,
            `Cannot return ${itemInput.quantity} units of product item ${itemInput.productId}. Original qty: ${originalQty}, already returned: ${alreadyReturned}, max returnable: ${remainingReturnable}.`
          );
        }
      }
    }

    // The note mirrors the original supply: same branch, place of supply and tax nature.
    const gst = await saleGstContext(
      tx,
      {
        businessPlaceId: data.businessPlaceId ?? invoice?.businessPlaceId ?? undefined,
        placeOfSupply: data.placeOfSupply ?? invoice?.placeOfSupply ?? undefined,
      },
      customer
    );
    const supplyType: SupplyType = invoice?.supplyType ?? gst.supplyType;
    const chargeable = invoice ? invoice.documentType !== "BILL_OF_SUPPLY" : gst.chargeable;
    const defaults = await productTaxDefaults(
      data.items.map((i) => i.productId),
      tx
    );

    let subTotal = 0;
    let taxAmount = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    const itemsData = data.items.map((item) => {
      const invItem = item.salesInvoiceItemId
        ? invoice?.items.find((i) => i.id === item.salesInvoiceItemId)
        : undefined;
      const def = defaults.get(String(item.productId));
      const taxable = round2(item.quantity * item.unitPrice);
      const taxRate = chargeable
        ? (item.taxRate ?? (invItem ? Number(invItem.tax) : undefined) ?? def?.gstRate ?? 0)
        : 0;
      const split = splitGst(taxable, taxRate, supplyType);
      subTotal += taxable;
      taxAmount += split.taxAmount;
      cgst += split.cgstAmount;
      sgst += split.sgstAmount;
      igst += split.igstAmount;
      return {
        productId: BigInt(item.productId),
        salesInvoiceItemId: item.salesInvoiceItemId || null,
        quantity: D(item.quantity),
        weight: item.weight ? D(item.weight) : null,
        uom: item.uom || null,
        unitPrice: D(item.unitPrice),
        taxRate: D(taxRate),
        hsnCode: item.hsnCode ?? invItem?.hsnCode ?? def?.hsnCode ?? null,
        taxableAmount: D(taxable),
        cgstAmount: D(split.cgstAmount),
        sgstAmount: D(split.sgstAmount),
        igstAmount: D(split.igstAmount),
        lineTotal: D(taxable + split.taxAmount),
        reason: item.reason || data.reason || null,
      };
    });

    return {
      invoice,
      gst,
      supplyType,
      itemsData,
      totals: {
        subTotal: D(subTotal),
        taxAmount: D(round2(taxAmount)),
        cgstAmount: D(round2(cgst)),
        sgstAmount: D(round2(sgst)),
        igstAmount: D(round2(igst)),
        grandTotal: D(round2(subTotal + taxAmount)),
      },
    };
  }

  async createSalesReturn(data: CreateSalesReturnInput, createdBy?: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      include: { addresses: true },
    });
    if (!customer) throw new ApiError(404, "Customer not found");

    const salesReturn = await prisma.$transaction(
      async (tx) => {
        const { gst, supplyType, itemsData, totals } = await this.buildSalesReturnLines(
          tx,
          data,
          customer
        );
        const returnDate = data.returnDate ? new Date(data.returnDate) : new Date();
        await periodService.assertPostingAllowed(returnDate, undefined, tx);
        const numbering = { date: returnDate, businessPlaceId: gst.place.id, tx };
        const returnNo = await documentNumberService.next("SALES_RETURN", numbering);
        const creditNoteNo = await documentNumberService.next("CREDIT_NOTE", numbering);

        return tx.salesReturn.create({
          data: {
            returnNo,
            creditNoteNo,
            kind: data.kind,
            returnDate,
            customerId: data.customerId,
            salesInvoiceId: data.salesInvoiceId || null,
            reason: data.reason || null,
            refundMode: data.refundMode ?? "CREDIT_NOTE",
            businessPlaceId: gst.place.id,
            placeOfSupply: gst.placeOfSupply,
            supplyType,
            customerGstin: customer.gstin ?? null,
            ...totals,
            status: "APPROVED",
            narration: data.narration || null,
            createdBy: createdBy || null,
            items: { create: itemsData },
          },
          include: { items: true, customer: true },
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    // Post the accounting voucher after the return has committed.
    try {
      await voucherPostingService.postSalesReturnVoucher(salesReturn.id);
    } catch (vErr) {
      logger.error({ err: vErr }, "[Auto-Post Voucher Error] Failed to post Sales Return Voucher:");
    }

    return salesReturn;
  }

  async getSalesReturnById(id: string) {
    const returnRecord = await prisma.salesReturn.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, firmName: true, customerCode: true, customerGrade: true } },
        salesInvoice: { select: { id: true, invoiceNo: true } },
        items: {
          include: {
            product: { select: { id: true, productName: true, productCode: true, category: true } },
          },
        },
      },
    });
    if (!returnRecord) throw new ApiError(404, "Sales return not found");
    return returnRecord;
  }

  async updateSalesReturn(id: string, data: CreateSalesReturnInput, _updatedBy?: string) {
    const existing = await prisma.salesReturn.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) throw new ApiError(404, "Sales return not found");

    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      include: { addresses: true },
    });
    if (!customer) throw new ApiError(404, "Customer not found");

    if (existing.cancelledAt) throw new ApiError(409, "Cancelled returns cannot be edited");
    const updated = await prisma.$transaction(async (tx) => {
      await periodService.assertPostingAllowed(existing.returnDate, undefined, tx);
      if (data.returnDate)
        await periodService.assertPostingAllowed(new Date(data.returnDate), undefined, tx);
      await tx.salesReturnItem.deleteMany({ where: { salesReturnId: id } });
      const { gst, supplyType, itemsData, totals } = await this.buildSalesReturnLines(
        tx,
        { ...data, businessPlaceId: data.businessPlaceId ?? existing.businessPlaceId },
        customer,
        id
      );
      return tx.salesReturn.update({
        where: { id },
        data: {
          customerId: data.customerId,
          salesInvoiceId: data.salesInvoiceId || null,
          kind: data.kind,
          returnDate: data.returnDate ? new Date(data.returnDate) : existing.returnDate,
          reason: data.reason || null,
          refundMode: data.refundMode ?? existing.refundMode,
          businessPlaceId: gst.place.id,
          placeOfSupply: gst.placeOfSupply,
          supplyType,
          customerGstin: customer.gstin ?? null,
          ...totals,
          status: "APPROVED",
          narration: data.narration || null,
          items: { create: itemsData },
        },
        include: { items: true, customer: true },
      });
    });

    try {
      await voucherPostingService.postSalesReturnVoucher(updated.id);
    } catch (vErr) {
      logger.error(
        { err: vErr },
        "[Auto-Post Voucher Error] Failed to post Sales Return Voucher on update:"
      );
    }

    return updated;
  }

  /**
   * P1-10d: header-only update. Lines move stock and carry the debit note's tax, so a wrong line
   * is cancelled and re-raised rather than edited. A new date re-posts the voucher on that date.
   */
  async updatePurchaseReturn(id: string, data: UpdatePurchaseReturnInput) {
    const existing = await prisma.purchaseReturn.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Purchase return not found");
    if (existing.cancelledAt) throw new ApiError(409, "Cancelled returns cannot be edited");
    const newDate = data.returnDate ? new Date(`${data.returnDate}T00:00:00.000Z`) : null;
    const dateChanged = newDate !== null && newDate.getTime() !== existing.returnDate.getTime();
    const updated = await prisma.$transaction(async (tx) => {
      if (dateChanged) {
        await periodService.assertPostingAllowed(existing.returnDate, undefined, tx);
        await periodService.assertPostingAllowed(newDate!, undefined, tx);
      }
      return tx.purchaseReturn.update({
        where: { id },
        data: {
          ...(dateChanged && { returnDate: newDate! }),
          ...(data.reason !== undefined && { reason: data.reason || null }),
          ...(data.narration !== undefined && { narration: data.narration || null }),
        },
        include: { items: true, supplier: true },
      });
    });
    if (dateChanged) {
      await cancellationService.cancelVouchersFor(
        ["PURCHASE_RETURN"],
        [id],
        { reason: "Purchase return re-dated" },
        prisma
      );
      try {
        await voucherPostingService.postPurchaseReturnVoucher(id);
      } catch (vErr) {
        logger.error({ err: vErr }, "[Auto-Post Voucher Error] purchase return update");
      }
    }
    return updated;
  }

  // --- PURCHASE RETURN ---
  async getPurchaseReturns(companyId?: string) {
    return prisma.purchaseReturn.findMany({
      where: companyId ? { companyId } : undefined,
      include: {
        supplier: { select: { id: true, legalName: true, supplierCode: true } },
        grnInvoice: { select: { id: true, invoiceNo: true } },
        items: {
          include: { rawMaterial: { select: { rawMaterialId: true, materialName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async createPurchaseReturn(data: CreatePurchaseReturnInput, createdBy?: string) {
    const supplier = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
    if (!supplier) throw new ApiError(404, "Supplier not found");
    const movesStock = data.kind !== "PRICE_ADJUSTMENT";

    const purchaseReturn = await prisma.$transaction(
      async (tx) => {
        let storeIdForDeduction: string | null = data.storeId || null;
        let grnInvoice: Prisma.GrnInvoiceGetPayload<{ include: { items: true } }> | null = null;

        // 1. Determine store & validate against GRN invoice if provided
        if (data.grnInvoiceId) {
          grnInvoice = await tx.grnInvoice.findUnique({
            where: { id: data.grnInvoiceId },
            include: { items: true },
          });
          if (!grnInvoice) throw new ApiError(404, "Original GRN invoice not found");
          if (grnInvoice.supplierId !== data.supplierId) {
            throw new ApiError(400, "GRN invoice does not belong to the selected supplier");
          }
          if (grnInvoice.storeId) storeIdForDeduction = grnInvoice.storeId;

          const previousReturns = await tx.purchaseReturn.findMany({
            where: { grnInvoiceId: data.grnInvoiceId, status: { not: "CANCELLED" } },
            include: { items: true },
          });
          const returnedQtyMap = new Map<string, number>();
          for (const ret of previousReturns) {
            for (const item of ret.items) {
              const current = returnedQtyMap.get(item.rawMaterialId) || 0;
              returnedQtyMap.set(item.rawMaterialId, current + Number(item.quantity));
            }
          }
          for (const itemInput of data.items) {
            const grnItem = grnInvoice.items.find((i) => i.productId === itemInput.rawMaterialId);
            if (!grnItem) {
              throw new ApiError(
                400,
                `Raw material ${itemInput.rawMaterialId} was not purchased in GRN/PO ${grnInvoice.invoiceNo || grnInvoice.grnNumber}`
              );
            }
            const alreadyReturned = returnedQtyMap.get(itemInput.rawMaterialId) || 0;
            const originalQty = Number(grnItem.quantity);
            const remainingReturnable = originalQty - alreadyReturned;
            if (itemInput.quantity > remainingReturnable) {
              throw new ApiError(
                400,
                `Cannot return ${itemInput.quantity} units of raw material ${itemInput.rawMaterialId}. Original purchased qty: ${originalQty}, already returned: ${alreadyReturned}, max returnable: ${remainingReturnable}.`
              );
            }
          }
        }

        if (movesStock && !storeIdForDeduction) {
          const firstRm = await tx.rawMaterial.findUnique({
            where: byCode("rawMaterialId", data.items[0].rawMaterialId),
          });
          if (firstRm?.storeId) {
            storeIdForDeduction = firstRm.storeId;
          } else {
            throw new ApiError(
              400,
              "Store/warehouse is required for purchase return stock deduction"
            );
          }
        }

        // 2. Tax: the debit note mirrors the original inward supply.
        const gst = await purchaseGstContext(
          tx,
          {
            businessPlaceId: data.businessPlaceId ?? grnInvoice?.businessPlaceId ?? undefined,
            reverseCharge: grnInvoice?.reverseCharge ?? false,
          },
          supplier
        );
        const supplyType: SupplyType = grnInvoice?.supplyType ?? gst.supplyType;
        // Tax paid under reverse charge is adjusted through GSTR-3B, not a debit note to the supplier.
        const chargeable = gst.chargeable && !gst.reverseCharge;
        const defaults = await rawMaterialTaxDefaults(
          data.items.map((i) => i.rawMaterialId),
          tx
        );

        let subTotal = 0;
        let taxAmount = 0;
        let cgst = 0;
        let sgst = 0;
        let igst = 0;
        const itemsData = data.items.map((item) => {
          const grnItem = grnInvoice?.items.find((i) => i.productId === item.rawMaterialId);
          const def = defaults.get(item.rawMaterialId);
          const taxable = round2(item.quantity * item.unitPrice);
          const taxRate = chargeable
            ? (item.taxRate ?? (grnItem ? Number(grnItem.tax) : undefined) ?? def?.gstRate ?? 0)
            : 0;
          const split = splitGst(taxable, taxRate, supplyType);
          subTotal += taxable;
          taxAmount += split.taxAmount;
          cgst += split.cgstAmount;
          sgst += split.sgstAmount;
          igst += split.igstAmount;
          return {
            rawMaterialId: item.rawMaterialId,
            quantity: D(item.quantity),
            unitPrice: D(item.unitPrice),
            hsnCode: item.hsnCode ?? grnItem?.hsnCode ?? def?.hsnCode ?? null,
            taxRate: D(taxRate),
            taxableAmount: D(taxable),
            cgstAmount: D(split.cgstAmount),
            sgstAmount: D(split.sgstAmount),
            igstAmount: D(split.igstAmount),
            lineTotal: D(taxable + split.taxAmount),
            reason: item.reason || data.reason || null,
          };
        });

        const returnDate = data.returnDate ? new Date(data.returnDate) : new Date();
        await periodService.assertPostingAllowed(returnDate, undefined, tx);
        const numbering = { date: returnDate, businessPlaceId: gst.place.id, tx };
        const returnNo = await documentNumberService.next("PURCHASE_RETURN", numbering);
        const debitNoteNo = await documentNumberService.next("DEBIT_NOTE", numbering);

        // 3. Create PurchaseReturn + Items
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            returnNo,
            debitNoteNo,
            kind: data.kind,
            returnDate,
            supplierId: data.supplierId,
            grnInvoiceId: data.grnInvoiceId || null,
            reason: data.reason || null,
            businessPlaceId: gst.place.id,
            placeOfSupply: gst.placeOfSupply,
            supplyType,
            supplierGstin: supplier.gstin ?? null,
            taxAmount: D(round2(taxAmount)),
            cgstAmount: D(round2(cgst)),
            sgstAmount: D(round2(sgst)),
            igstAmount: D(round2(igst)),
            grandTotal: D(round2(subTotal + taxAmount)),
            status: "APPROVED",
            narration: data.narration || null,
            createdBy: createdBy || null,
            items: { create: itemsData },
          },
          include: { items: true, supplier: true },
        });

        if (!movesStock) return purchaseReturn;

        // 4. Deduct raw material stock and record the adjustment
        await rawMaterialStockService.deductForPurchaseReturn(
          data.items.map((i) => ({
            rawMaterialId: i.rawMaterialId,
            quantity: i.quantity,
            storeId: storeIdForDeduction!,
          })),
          returnNo,
          tx
        );

        const year = returnDate.getFullYear();
        const prefix = `ADJ-${year}-`;
        const lastAdj = await tx.stockAdjustment.findFirst({
          where: { adjustmentNumber: { startsWith: prefix } },
          orderBy: { adjustmentNumber: "desc" },
          select: { adjustmentNumber: true },
        });
        let seq = 1;
        if (lastAdj?.adjustmentNumber) {
          const parts = lastAdj.adjustmentNumber.split("-");
          seq = (parseInt(parts[parts.length - 1]) || 0) + 1;
        }
        const adjustmentNumber = `${prefix}${String(seq).padStart(4, "0")}`;

        const saRecord = await tx.stockAdjustment.create({
          data: {
            adjustmentNumber,
            adjustmentDate: returnDate,
            adjustmentType: "PURCHASE_RETURN",
            reason: `Purchase Return ${returnNo}`,
            status: "APPROVED",
            approvedBy: createdBy || "SYSTEM",
            approvedAt: new Date(),
            createdBy: createdBy || "SYSTEM",
            updatedBy: createdBy || "SYSTEM",
            autoGenerated: true,
            sourceDocument: "PURCHASE_RETURN",
            sourceDocId: purchaseReturn.id,
          },
        });

        for (const item of data.items) {
          const rm = await tx.rawMaterial.findUnique({
            where: byCode("rawMaterialId", item.rawMaterialId),
          });
          const currentQty = Number(rm?.onHandQty || 0) + Number(item.quantity); // qty before deduction
          const adjustedQty = Number(rm?.onHandQty || 0); // qty after deduction
          await tx.stockAdjustmentItem.create({
            data: {
              stockAdjustmentId: saRecord.id,
              itemType: "RAW_MATERIAL",
              rawMaterialId: item.rawMaterialId,
              storeId: storeIdForDeduction!,
              currentQty,
              adjustedQty,
              difference: -Number(item.quantity),
              unitCost: item.unitPrice,
              remarks: `Purchase Return ${returnNo}`,
            },
          });
        }

        return purchaseReturn;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    // 5. Post the debit note (Dr Supplier | Cr Purchase Return, Cr input credit reversed)
    try {
      await voucherPostingService.postPurchaseReturnVoucher(purchaseReturn.id);
    } catch (vErr) {
      logger.error(
        { err: vErr },
        "[Auto-Post Voucher Error] Failed to post Purchase Return Voucher:"
      );
    }

    return purchaseReturn;
  }

  // --- CANCELLATION (P1-09): returns stay on file; their notes' vouchers are reversed ---
  async cancelSalesReturn(
    id: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    return prisma.$transaction(async (tx) => {
      const ret = await tx.salesReturn.findUnique({ where: { id } });
      if (!ret) throw new ApiError(404, "Sales return not found");
      if (ret.cancelledAt) {
        throw new ApiError(409, `Return ${ret.returnNo} is already cancelled`, "ALREADY_CANCELLED");
      }
      await cancellationService.cancelVouchersFor(
        ["SALES_RETURN", "SALES_RETURN_REFUND"],
        [ret.id],
        { reason, actor },
        tx
      );
      return tx.salesReturn.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
    });
  }

  async cancelPurchaseReturn(
    id: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    return prisma.$transaction(async (tx) => {
      const ret = await tx.purchaseReturn.findUnique({ where: { id }, include: { items: true } });
      if (!ret) throw new ApiError(404, "Purchase return not found");
      if (ret.cancelledAt) {
        throw new ApiError(409, `Return ${ret.returnNo} is already cancelled`, "ALREADY_CANCELLED");
      }
      await cancellationService.cancelVouchersFor(
        ["PURCHASE_RETURN"],
        [ret.id],
        { reason, actor },
        tx
      );

      // Goods that left with the return come back; a price adjustment moved none.
      if (ret.kind === "GOODS_RETURN") {
        const adjustment = await tx.stockAdjustment.findFirst({
          where: { sourceDocument: "PURCHASE_RETURN", sourceDocId: ret.id },
          include: { items: true },
        });
        for (const item of ret.items) {
          await tx.rawMaterial.update({
            where: byCode("rawMaterialId", item.rawMaterialId),
            data: { onHandQty: { increment: item.quantity }, lastMovementAt: new Date() },
          });
        }
        if (adjustment) {
          const reversal = await tx.stockAdjustment.create({
            data: {
              adjustmentNumber: `ADJ-CANCEL-${ret.returnNo}`.slice(0, 50),
              adjustmentDate: new Date(),
              adjustmentType: "PURCHASE_RETURN_CANCEL",
              reason: `Cancellation of purchase return ${ret.returnNo}${reason ? `: ${reason}` : ""}`,
              status: "APPROVED",
              approvedBy: actor.userId || "SYSTEM",
              approvedAt: new Date(),
              createdBy: actor.userId || "SYSTEM",
              updatedBy: actor.userId || "SYSTEM",
              autoGenerated: true,
              sourceDocument: "PURCHASE_RETURN_CANCEL",
              sourceDocId: ret.id,
            },
          });
          for (const line of adjustment.items) {
            if (!line.rawMaterialId) continue;
            const qty = Math.abs(Number(line.difference));
            await tx.stockAdjustmentItem.create({
              data: {
                stockAdjustmentId: reversal.id,
                itemType: "RAW_MATERIAL",
                rawMaterialId: line.rawMaterialId,
                storeId: line.storeId,
                currentQty: line.adjustedQty,
                adjustedQty: Number(line.adjustedQty) + qty,
                difference: qty,
                unitCost: line.unitCost,
                remarks: `Purchase return ${ret.returnNo} cancelled`,
              },
            });
          }
        }
      }

      return tx.purchaseReturn.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledBy: actor.userId ?? null,
          cancelReason: reason?.trim() || null,
        },
      });
    });
  }
}

export const returnsService = new ReturnsService();
