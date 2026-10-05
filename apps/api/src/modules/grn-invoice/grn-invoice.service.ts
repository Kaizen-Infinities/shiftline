import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { CreateGrnInvoiceInput, UpdateGrnInvoiceInput } from "./grn-invoice.validation";
import { uploadToImageKit } from "../../utils/Imagekit";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../../lib/logger";
import { byCode } from "../../lib/prisma";
import { documentNumberService } from "../documents/document-number.service";
import { periodService } from "../accounts/period.service";
import { dueDateFrom } from "../accounts/ageing";
import { cancellationService } from "../accounts/cancellation.service";
import { valuationService } from "../costing/valuation.service";
import { tdsService } from "../tds/tds.service";
import { splitGst } from "../gst/gst.calc";
import {
  cessOn,
  purchaseGstContext,
  rawMaterialTaxDefaults,
  type PurchaseGstContext,
} from "../gst/gst.context";
import { currencyService } from "../currency/currency.service";

function getUomMultiplier(uom: string = "", baseUom: string = ""): number {
  const u = (uom || "").trim().toLowerCase();
  const b = (baseUom || "").trim().toLowerCase();
  if (!u || u === b) return 1;
  if (u === "g" || u === "gram" || u === "grams") {
    if (b.includes("kg") || b === "kilogram" || b === "kilograms" || !b) return 0.001;
  }
  if (u === "kg" || u === "kilogram" || u === "kilograms") {
    if (b === "g" || b === "gram" || b === "grams") return 1000;
  }
  if (u === "mg") {
    if (b.includes("kg")) return 0.000001;
    if (b.includes("g")) return 0.001;
  }
  if (u === "ton" || u === "tonne" || u === "tonnes" || u === "tons") {
    if (b.includes("kg") || !b) return 1000;
  }
  if (u === "ml" && (b.includes("l") || !b)) return 0.001;
  if (u === "mm" && (b.includes("m") || !b)) return 0.001;
  if (u === "cm" && (b.includes("m") || !b)) return 0.01;
  return 1;
}

class GrnInvoiceService {
  // ── Next GRN number (from the tenant's GRN series, not consumed until the GRN is saved) ──
  async getNextGrnNumber(opts: { date?: Date; businessPlaceId?: bigint } = {}) {
    return documentNumberService.peek("GRN", opts);
  }

  // ── Calculate totals ────────────────────────────────────────────────────────
  private async calculateTotals(
    items: CreateGrnInvoiceInput["items"],
    gst: PurchaseGstContext,
    discountType: "PERCENT" | "FLAT" = "PERCENT",
    discountValue: number = 0,
    roundingAdjust: number = 0
  ) {
    const productIds = items.map((i) => String(i.productId)).filter(Boolean);
    const rawMaterials =
      productIds.length > 0
        ? await prisma.rawMaterial.findMany({ where: { rawMaterialId: { in: productIds } } })
        : [];
    const rmMap = new Map(rawMaterials.map((rm) => [String(rm.rawMaterialId), rm]));
    const taxDefaults = await rawMaterialTaxDefaults(productIds);

    let subtotal = 0;
    let totalTax = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let totalCess = 0;

    const itemsWithTotals = items.map((item) => {
      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const rm = rmMap.get(String(item.productId));
      const mult = getUomMultiplier(item.uom, rm?.baseUom);
      const itemDiscountAmount = Number((item as any).discountAmount || 0);
      const lineSubtotal = qty * mult * unitPrice - itemDiscountAmount;

      const taxableAmount = lineSubtotal;
      const def = taxDefaults.get(String(item.productId));
      const totalGstRate = gst.chargeable ? (item.tax ?? def?.gstRate ?? 0) : 0;
      const cessRate = gst.chargeable ? (item.cessRate ?? def?.cessRate ?? 0) : 0;
      const split = splitGst(taxableAmount, totalGstRate, gst.supplyType);
      const cessAmount = cessOn(taxableAmount, cessRate);

      // Under reverse charge the supplier's bill carries no tax; we pay it to the government.
      const lineTotal = gst.reverseCharge
        ? taxableAmount
        : taxableAmount + split.taxAmount + cessAmount;

      subtotal += lineSubtotal;
      totalTax += split.taxAmount;
      totalCgst += split.cgstAmount;
      totalSgst += split.sgstAmount;
      totalIgst += split.igstAmount;
      totalCess += cessAmount;

      return {
        ...item,
        quantity: qty,
        unitPrice: unitPrice,
        discountAmount: itemDiscountAmount,
        hsnCode: item.hsnCode ?? def?.hsnCode ?? null,
        tax: totalGstRate,
        taxableAmount,
        cgstRate: split.cgstRate,
        cgstAmount: split.cgstAmount,
        sgstRate: split.sgstRate,
        sgstAmount: split.sgstAmount,
        igstRate: split.igstRate,
        igstAmount: split.igstAmount,
        cessRate,
        cessAmount,
        lineTotal,
      };
    });

    let totalDiscount =
      discountType === "PERCENT" ? (subtotal * discountValue) / 100 : discountValue;
    if (totalDiscount > subtotal) {
      totalDiscount = subtotal;
    }

    // What the supplier is owed: tax and cess are excluded when we pay them under reverse charge.
    const netAmount =
      subtotal -
      totalDiscount +
      (gst.reverseCharge ? 0 : totalTax + totalCess) +
      Number(roundingAdjust);

    return {
      itemsWithTotals,
      subtotal,
      totalDiscount,
      totalTax,
      totalCgst,
      totalSgst,
      totalIgst,
      totalCess,
      netAmount,
    };
  }

  // ── Create ──────────────────────────────────────────────────────────────────
  async createGrnInvoice(
    data: CreateGrnInvoiceInput,
    currentUser: { userId: string; companyId: string },
    file?: Express.Multer.File
  ) {
    // Validate supplier
    const supplier = await prisma.supplier.findUnique({
      where: { id: Number(data.supplierId) },
    });
    if (!supplier) {
      throw new ApiError(404, "Supplier not found");
    }

    // Validate store
    const store = await prisma.store.findUnique({
      where: byCode("storeId", data.storeId),
    });
    if (!store) {
      throw new ApiError(404, "Store not found");
    }

    await periodService.assertPostingAllowed(new Date(data.grnDate), currentUser);
    const gst = await purchaseGstContext(prisma, data, supplier);
    const discountType = data.discountType || "PERCENT";
    const discountValue = Number(data.discountValue) || 0;
    const roundingAdjust = Number(data.roundingAdjust) || 0;

    const items = typeof data.items === "string" ? JSON.parse(data.items) : data.items;
    const sameAsBilling = (data.sameAsBilling as any) === "true" || data.sameAsBilling === true;

    // Foreign currency (P2-06, mirroring what P1-14 did for the sales invoice). The line rates
    // arrive in the bill's currency; converting them here means every figure computed below —
    // and every voucher and the exposure/restatement downstream — is already in rupees.
    const currencyCode = String(data.currencyCode ?? "INR").toUpperCase();
    const exchangeRate =
      currencyCode === "INR"
        ? 1
        : (data.exchangeRate ??
          (await currencyService.rateFor(currencyCode, new Date(data.grnDate))));
    const itemsInInr =
      exchangeRate === 1
        ? items
        : items.map((i: any) => ({
            ...i,
            unitPrice: Number(i.unitPrice) * exchangeRate,
            discountAmount: Number(i.discountAmount ?? 0) * exchangeRate,
          }));

    const {
      itemsWithTotals,
      subtotal,
      totalDiscount,
      totalTax,
      totalCgst,
      totalSgst,
      totalIgst,
      totalCess,
      netAmount,
    } = await this.calculateTotals(itemsInInr, gst, discountType, discountValue, roundingAdjust);
    const foreignTotal =
      exchangeRate === 1 ? null : Math.round((netAmount / exchangeRate) * 100) / 100;

    // Upload invoice image to ImageKit if provided
    let invoiceImageUrl: string | null = null;
    if (file) {
      const uniqueName = `invoice_${Date.now()}${path.extname(file.originalname)}`;
      try {
        invoiceImageUrl = await uploadToImageKit(file.buffer, uniqueName, "/invoices");
      } catch (err) {
        logger.error({ err: err }, "Failed to upload invoice copy to ImageKit:");
        throw err;
      }
    }

    const updateStockEnabled = data.updateStock === true || (data.updateStock as any) === "true";

    // P2-05: TDS is worked out on the taxable value, not the GST-inclusive bill.
    const tdsBaseAmount = Math.max(0, Number(subtotal) - Number(totalDiscount));
    let tdsPreview: Awaited<ReturnType<typeof tdsService.rateFor>> | null = null;
    if (data.tdsSectionCode) {
      tdsPreview = await tdsService.rateFor({
        sectionCode: data.tdsSectionCode,
        supplierId: Number(data.supplierId),
        deducteePan: supplier.pan,
        deducteeType: supplier.deducteeType ?? undefined,
        higherRate: supplier.higherRate206AB ?? false,
        amount: tdsBaseAmount,
        on: new Date(data.grnDate),
      });
    }

    const rawPayments =
      typeof (data as any).payments === "string"
        ? JSON.parse((data as any).payments)
        : (data as any).payments || [];
    const processedPayments = rawPayments.map((p: any) => ({
      id: p.id || crypto.randomUUID(),
      amount: Math.round(Number(p.amount) * 100) / 100,
      paymentMethod: p.paymentMethod,
      referenceNumber: p.referenceNumber || "",
      paymentDate: p.paymentDate,
      recordedBy: currentUser.userId,
      createdAt: new Date().toISOString(),
      // Cheque instrument and settlement rate (P2-06); posting these is voucherPostingService's
      // job, not this one — a payment here is just recorded, converted to a voucher afterwards.
      instrumentType: p.instrumentType ?? undefined,
      chequeNo: p.chequeNo ?? undefined,
      chequeDate: p.chequeDate ?? undefined,
      chequeBank: p.chequeBank ?? undefined,
      chequeParty: p.chequeParty ?? undefined,
      settlementRate: p.settlementRate ?? undefined,
    }));
    const totalPaid =
      Math.round(
        processedPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0) * 100
      ) / 100;
    const computedStatus =
      totalPaid === 0 ? "Unpaid" : totalPaid >= Number(netAmount) ? "Closed" : "Partial";

    const lastPayment = processedPayments[processedPayments.length - 1];
    const paymentMethod = lastPayment ? lastPayment.paymentMethod : null;
    const referenceNumber = lastPayment ? lastPayment.referenceNumber : null;
    const paymentDate = lastPayment ? new Date(lastPayment.paymentDate) : null;

    const grnInvoice = await prisma.$transaction(
      async (tx) => {
        const grnDate = new Date(data.grnDate);
        const grnNumber = await documentNumberService.next("GRN", {
          date: grnDate,
          businessPlaceId: gst.place.id,
          tx,
        });
        // Create GRN Invoice
        const grnInvoice = await tx.grnInvoice.create({
          data: {
            grnNumber,
            invoiceNo: data.invoiceNo,
            grnDate,
            supplierInvoiceDate: data.supplierInvoiceDate
              ? new Date(data.supplierInvoiceDate)
              : null,
            supplierId: Number(data.supplierId),
            storeId: data.storeId,
            businessPlaceId: gst.place.id,
            placeOfSupply: gst.placeOfSupply,
            supplyType: gst.supplyType,
            supplierGstin: supplier.gstin ?? null,
            reverseCharge: gst.reverseCharge,
            billingAddressLine1: data.billingAddressLine1,
            billingCity: data.billingCity,
            billingState: data.billingState,
            billingPincode: data.billingPincode,
            billingCountry: data.billingCountry || "India",
            shippingAddressLine1: data.shippingAddressLine1,
            shippingCity: data.shippingCity,
            shippingState: data.shippingState,
            shippingPincode: data.shippingPincode,
            shippingCountry: data.shippingCountry || "India",
            sameAsBilling,

            receiveDate: data.receiveDate ? new Date(data.receiveDate) : null,
            billDueDate: data.billDueDate
              ? new Date(data.billDueDate)
              : dueDateFrom(
                  data.supplierInvoiceDate
                    ? new Date(data.supplierInvoiceDate)
                    : new Date(data.grnDate),
                  supplier.creditDays
                ),
            challanNo: data.challanNo || null,
            transport: data.transport || null,
            eWayBill: data.eWayBill || null,
            invoiceImage: invoiceImageUrl || null,
            remarks: data.remarks || null,

            discountType,
            discountValue,
            roundingAdjust,

            paymentStatus: computedStatus,
            paymentMethod,
            referenceNumber,
            paymentDate,
            payments: processedPayments as any,

            subtotal,
            totalDiscount,
            totalTax,
            totalCgst,
            totalSgst,
            totalIgst,
            totalCess,
            netAmount,
            currencyCode,
            exchangeRate,
            foreignTotal,

            companyId: currentUser.companyId,
            createdBy: currentUser.userId,
            poId: data.poId || null,
            updateStock: updateStockEnabled,

            items: {
              create: itemsWithTotals.map((item) => ({
                productId: item.productId,
                description: item.description,
                uom: item.uom,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discountAmount: item.discountAmount || 0,
                tax: item.tax || 0,
                taxableAmount: item.taxableAmount || 0,
                cgstRate: item.cgstRate || 0,
                cgstAmount: item.cgstAmount || 0,
                sgstRate: item.sgstRate || 0,
                sgstAmount: item.sgstAmount || 0,
                igstRate: item.igstRate || 0,
                igstAmount: item.igstAmount || 0,
                hsnCode: item.hsnCode ?? null,
                cessRate: item.cessRate || 0,
                cessAmount: item.cessAmount || 0,
                lineTotal: item.lineTotal,
              })),
            },
          },
          include: {
            items: true,
          },
        });

        if (updateStockEnabled) {
          const adjustmentNumber = `ADJ-GRN-${grnNumber}`;
          const adjustmentItems = [];

          for (const item of itemsWithTotals) {
            const rawMaterial = await tx.rawMaterial.findUnique({
              where: byCode("rawMaterialId", item.productId),
            });
            if (!rawMaterial) {
              throw new ApiError(404, `Raw Material ${item.productId} not found`);
            }

            let itemTypeStr = rawMaterial.itemType;
            if (!itemTypeStr) {
              itemTypeStr = "Raw Material";
              await tx.rawMaterial.update({
                where: byCode("rawMaterialId", item.productId),
                data: {
                  itemType: "Raw Material",
                  flaggedForReview: true,
                },
              });
            }

            let enumType: any = "RAW_MATERIAL";
            const normalized = itemTypeStr.toUpperCase().replace(/\s+/g, "_");
            if (normalized === "RAW_MATERIAL" || normalized === "RAW_MATERIALS") {
              enumType = "RAW_MATERIAL";
            } else if (normalized === "FINISHED_GOOD" || normalized === "FINISHED_GOODS") {
              enumType = "FINISHED_GOODS";
            } else if (normalized === "SEMI_FINISHED") {
              enumType = "SEMI_FINISHED";
            } else if (normalized === "CONSUMABLE" || normalized === "CONSUMABLES") {
              enumType = "CONSUMABLE";
            }

            const mult = getUomMultiplier(item.uom, rawMaterial.baseUom);
            const currentQtyNum = Number(rawMaterial.onHandQty) || 0;
            const receivedQtyNum = Number(item.quantity) * mult;
            const adjustedQtyNum = currentQtyNum + receivedQtyNum;

            adjustmentItems.push({
              itemType: enumType,
              rawMaterialId: item.productId,
              storeId: data.storeId,
              currentQty: currentQtyNum,
              adjustedQty: adjustedQtyNum,
              difference: receivedQtyNum,
              unitCost: Number(item.unitPrice),
              batchNo: rawMaterial.batchNo || null,
              remarks: `Auto-received from GRN ${grnNumber}`,
            });

            await tx.rawMaterial.update({
              where: byCode("rawMaterialId", item.productId),
              data: {
                onHandQty: {
                  increment: receivedQtyNum,
                },
                lastMovementAt: new Date(),
              },
            });

            await tx.rawMaterialTransaction.create({
              data: {
                storeId: data.storeId,
                rawMaterialId: item.productId,
                txnType: "RECEIPT",
                qty: receivedQtyNum,
                txnDateTime: new Date(data.grnDate),
                remarks: `GRN Created (Auto Adjustment): ${grnNumber}`,
              },
            });

            // Values the receipt at the line's landed-free cost; a linked bill of entry tops the
            // average up with landed cost separately (P2-04).
            await valuationService.record(
              {
                itemType: "RAW_MATERIAL",
                itemId: item.productId,
                storeId: data.storeId,
                movedOn: data.grnDate,
                kind: "RECEIPT",
                quantity: receivedQtyNum,
                rate: Number(item.unitPrice) / (mult || 1),
                refDocType: "GRN",
                refDocId: grnInvoice.id,
                narration: `GRN ${grnNumber}`,
              },
              { userId: currentUser.userId },
              tx
            );
          }

          await tx.stockAdjustment.create({
            data: {
              adjustmentNumber,
              adjustmentDate: new Date(data.grnDate),
              reason: `Auto-generated on Bill Creation for Invoice: ${data.invoiceNo}`,
              status: "APPROVED",
              approvedBy: currentUser.userId,
              approvedAt: new Date(),
              createdBy: currentUser.userId,
              updatedBy: currentUser.userId,
              autoGenerated: true,
              sourceDocument: "GrnInvoice",
              sourceDocId: grnInvoice.id,
              type: "Receipt",
              items: {
                create: adjustmentItems,
              },
            },
          });
        }

        // Update Purchase Order items receivedQty and recalculate PO status
        if (data.poId) {
          const po = await tx.purchaseOrder.findUnique({
            where: { id: data.poId },
            include: { items: true },
          });
          if (!po) {
            throw new ApiError(404, "Purchase Order not found");
          }

          let allFullyReceived = true;
          let hasPartialReceived = false;

          for (const poItem of po.items) {
            const item = itemsWithTotals.find((i) => i.productId === poItem.productId);
            const poRawMaterial = await tx.rawMaterial.findUnique({
              where: byCode("rawMaterialId", poItem.productId),
            });
            const currentRec = Number(poItem.receivedQty) || 0;
            const mult = item ? getUomMultiplier(item.uom, poRawMaterial?.baseUom) : 1;
            const poMult = getUomMultiplier(poItem.uom, poRawMaterial?.baseUom);
            const addedRec = item ? (Number(item.quantity) * mult) / (poMult || 1) : 0;
            const newRec = currentRec + addedRec;

            if (addedRec > 0) {
              await tx.purchaseOrderItem.update({
                where: { id: poItem.id },
                data: { receivedQty: newRec },
              });
            }

            if (newRec < Number(poItem.quantity)) {
              allFullyReceived = false;
            }
            if (newRec > 0) {
              hasPartialReceived = true;
            }
          }

          const newStatus = allFullyReceived
            ? "CLOSED"
            : hasPartialReceived
              ? "PARTIALLY_RECEIVED"
              : "OPEN";

          await tx.purchaseOrder.update({
            where: { id: data.poId },
            data: { status: newStatus },
          });
        }

        return grnInvoice;
      },
      { timeout: 30000, maxWait: 10000 }
    );

    // Auto-post double-entry PURCHASE Voucher & PAYMENT Vouchers after GRN transaction has committed
    try {
      const { voucherPostingService } = await import("../accounts/voucherPosting.service.js");
      await voucherPostingService.postPurchaseVoucher(grnInvoice.id);
      await voucherPostingService.postPaymentVouchersForGRN(grnInvoice.id);
    } catch (vErr) {
      logger.error(
        { err: vErr },
        "[Auto-Post Voucher Error] Failed to post Purchase/Payment Voucher for GRN:"
      );
    }

    // P2-05: accepting the TDS preview records the deduction and posts its journal — the
    // supplier's payable balance and TDS-<section> ledger both move.
    if (data.deductTds && data.tdsSectionCode) {
      try {
        const deduction = await tdsService.deduct(
          {
            sectionCode: data.tdsSectionCode,
            supplierId: Number(data.supplierId),
            docType: "GRN_INVOICE",
            docId: grnInvoice.id,
            docNo: grnInvoice.grnNumber,
            deductionDate: grnInvoice.grnDate,
            amount: tdsBaseAmount,
          },
          { userId: currentUser.userId }
        );
        const tdsAmount = Number(deduction.tdsAmount);
        if (tdsAmount > 0) {
          await tdsService.postDeductionVoucher(deduction.id, prisma);
          const payable = Number(grnInvoice.netAmount) - tdsAmount;
          const totalPaid =
            Math.round(
              (Array.isArray(grnInvoice.payments) ? (grnInvoice.payments as any[]) : []).reduce(
                (s: number, p: any) => s + Number(p.amount || 0),
                0
              ) * 100
            ) / 100;
          const paymentStatus =
            totalPaid === 0 ? "Unpaid" : totalPaid >= payable ? "Closed" : "Partial";
          await prisma.grnInvoice.update({
            where: { id: grnInvoice.id },
            data: { tdsAmount, tdsSectionCode: data.tdsSectionCode, paymentStatus },
          });
        }
      } catch (tdsErr) {
        logger.error({ err: tdsErr }, "[GRN TDS] Failed to record TDS deduction:");
      }
    }

    const finalInvoice = await prisma.grnInvoice.findUniqueOrThrow({
      where: { id: grnInvoice.id },
      include: { items: true },
    });
    // Offer the preview only when it was not already accepted — once accepted the row itself
    // carries tdsAmount/tdsSectionCode.
    return data.deductTds ? finalInvoice : { ...finalInvoice, tdsPreview };
  }

  // ── Get All ─────────────────────────────────────────────────────────────────
  async getAllGrnInvoices(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    supplierId?: number;
    storeId?: string;
  }) {
    const page = params.page || 1;
    const pageSize = params.pageSize || 10;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    if (params.search) {
      where.OR = [
        { grnNumber: { contains: params.search, mode: "insensitive" } },
        { invoiceNo: { contains: params.search, mode: "insensitive" } },
      ];
    }

    if (params.supplierId) {
      where.supplierId = params.supplierId;
    }

    if (params.storeId) {
      where.storeId = params.storeId;
    }

    const [data, total] = await Promise.all([
      prisma.grnInvoice.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          supplier: {
            select: {
              id: true,
              supplierCode: true,
              displayName: true,
              legalName: true,
            },
          },
          store: {
            select: {
              storeId: true,
              storeName: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.grnInvoice.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ── Get By ID ───────────────────────────────────────────────────────────────
  async getGrnInvoiceById(id: string) {
    const grnInvoice = await prisma.grnInvoice.findUnique({
      where: { id },
      include: {
        supplier: true,
        store: true,
        items: {
          include: {
            rawMaterial: true,
          },
        },
        purchaseOrder: true,
      },
    });

    if (!grnInvoice) {
      throw new ApiError(404, "GRN Invoice not found");
    }

    return grnInvoice;
  }

  async updateGrnInvoice(id: string, data: UpdateGrnInvoiceInput, file?: Express.Multer.File) {
    const existing = await prisma.grnInvoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new ApiError(404, "GRN Invoice not found");
    }
    if (existing.cancelledAt) throw new ApiError(409, "Cancelled GRNs cannot be edited");
    await periodService.assertPostingAllowed(existing.grnDate);
    if (data.grnDate) await periodService.assertPostingAllowed(new Date(data.grnDate));

    const items = data.items
      ? typeof data.items === "string"
        ? JSON.parse(data.items)
        : data.items
      : undefined;
    const sameAsBilling =
      data.sameAsBilling !== undefined
        ? (data.sameAsBilling as any) === "true" || data.sameAsBilling === true
        : undefined;

    const supplierId = data.supplierId ? Number(data.supplierId) : existing.supplierId;
    const storeId = data.storeId || existing.storeId;

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new ApiError(404, "Supplier not found");
    }

    const gst = await purchaseGstContext(
      prisma,
      {
        businessPlaceId: data.businessPlaceId ?? existing.businessPlaceId,
        reverseCharge: data.reverseCharge ?? existing.reverseCharge,
      },
      supplier
    );

    const discountType = data.discountType || existing.discountType;
    const discountValue =
      data.discountValue !== undefined
        ? Number(data.discountValue)
        : Number(existing.discountValue);
    const roundingAdjust =
      data.roundingAdjust !== undefined
        ? Number(data.roundingAdjust)
        : Number(existing.roundingAdjust);

    // Upload invoice image to ImageKit if provided
    let invoiceImageUrl = existing.invoiceImage;
    if (file) {
      const uniqueName = `invoice_${Date.now()}${path.extname(file.originalname)}`;
      try {
        invoiceImageUrl = await uploadToImageKit(file.buffer, uniqueName, "/invoices");
      } catch (err) {
        logger.error({ err: err }, "Failed to upload invoice copy to ImageKit:");
        throw err;
      }
    }

    const updateStockEnabled =
      data.updateStock !== undefined
        ? data.updateStock === true || (data.updateStock as any) === "true"
        : existing.updateStock;

    const rawPayments = data.payments
      ? typeof data.payments === "string"
        ? JSON.parse(data.payments)
        : data.payments
      : undefined;

    const updated = await prisma.$transaction(async (tx) => {
      let subtotal = Number(existing.subtotal);
      let totalDiscount = Number(existing.totalDiscount);
      let totalTax = Number(existing.totalTax);
      let totalCgst = Number(existing.totalCgst);
      let totalSgst = Number(existing.totalSgst);
      let totalIgst = Number(existing.totalIgst);
      let totalCess = Number(existing.totalCess);
      let netAmount = Number(existing.netAmount);

      let itemsToCreate = existing.items;
      let currencyCode = existing.currencyCode ?? "INR";
      let exchangeRate = Number(existing.exchangeRate ?? 1);
      let foreignTotal =
        existing.foreignTotal !== null && existing.foreignTotal !== undefined
          ? Number(existing.foreignTotal)
          : null;

      if (data.currencyCode !== undefined) currencyCode = String(data.currencyCode).toUpperCase();
      if (currencyCode !== "INR" && data.exchangeRate !== undefined) {
        exchangeRate = Number(data.exchangeRate);
      } else if (currencyCode === "INR") {
        exchangeRate = 1;
      } else if (!exchangeRate || exchangeRate <= 0) {
        exchangeRate = await currencyService.rateFor(
          currencyCode,
          data.grnDate ? new Date(data.grnDate) : existing.grnDate
        );
      }

      if (items) {
        const itemsInInr =
          exchangeRate === 1
            ? items
            : items.map((i: any) => ({
                ...i,
                unitPrice: Number(i.unitPrice) * exchangeRate,
                discountAmount: Number(i.discountAmount ?? 0) * exchangeRate,
              }));
        const totals = await this.calculateTotals(
          itemsInInr,
          gst,
          discountType,
          discountValue,
          roundingAdjust
        );
        subtotal = totals.subtotal;
        totalDiscount = totals.totalDiscount;
        totalTax = totals.totalTax;
        totalCgst = totals.totalCgst;
        totalSgst = totals.totalSgst;
        totalIgst = totals.totalIgst;
        totalCess = totals.totalCess;
        netAmount = totals.netAmount;
        itemsToCreate = totals.itemsWithTotals as any;

        // Delete old items
        await tx.grnInvoiceItem.deleteMany({
          where: { grnInvoiceId: id },
        });
      }
      foreignTotal = exchangeRate === 1 ? null : Math.round((netAmount / exchangeRate) * 100) / 100;

      let processedPayments = existing.payments
        ? ((typeof existing.payments === "string"
            ? JSON.parse(existing.payments)
            : existing.payments) as any[])
        : [];
      let computedStatus = existing.paymentStatus;

      if (rawPayments) {
        processedPayments = rawPayments.map((p: any) => ({
          id: p.id || crypto.randomUUID(),
          amount: Math.round(Number(p.amount) * 100) / 100,
          paymentMethod: p.paymentMethod,
          referenceNumber: p.referenceNumber || "",
          paymentDate: p.paymentDate,
          recordedBy: "System",
          createdAt: p.createdAt || new Date().toISOString(),
          instrumentType: p.instrumentType ?? undefined,
          chequeNo: p.chequeNo ?? undefined,
          chequeDate: p.chequeDate ?? undefined,
          chequeBank: p.chequeBank ?? undefined,
          chequeParty: p.chequeParty ?? undefined,
          settlementRate: p.settlementRate ?? undefined,
        }));
        const totalPaid =
          Math.round(
            processedPayments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0) * 100
          ) / 100;
        computedStatus =
          totalPaid === 0 ? "Unpaid" : totalPaid >= Number(netAmount) ? "Closed" : "Partial";
      }

      // Update GRN record
      const updated = await tx.grnInvoice.update({
        where: { id },
        data: {
          invoiceNo: data.invoiceNo || existing.invoiceNo,
          grnDate: data.grnDate ? new Date(data.grnDate) : existing.grnDate,
          supplierInvoiceDate: data.supplierInvoiceDate
            ? new Date(data.supplierInvoiceDate)
            : existing.supplierInvoiceDate,
          supplierId,
          storeId,
          businessPlaceId: gst.place.id,
          placeOfSupply: gst.placeOfSupply,
          supplyType: gst.supplyType,
          supplierGstin: supplier.gstin ?? null,
          reverseCharge: gst.reverseCharge,
          totalCess,
          billingAddressLine1: data.billingAddressLine1 || existing.billingAddressLine1,
          billingCity: data.billingCity || existing.billingCity,
          billingState: data.billingState || existing.billingState,
          billingPincode: data.billingPincode || existing.billingPincode,
          billingCountry: data.billingCountry || existing.billingCountry || "India",
          shippingAddressLine1: data.shippingAddressLine1 || existing.shippingAddressLine1,
          shippingCity: data.shippingCity || existing.shippingCity,
          shippingState: data.shippingState || existing.shippingState,
          shippingPincode: data.shippingPincode || existing.shippingPincode,
          shippingCountry: data.shippingCountry || existing.shippingCountry || "India",
          sameAsBilling: sameAsBilling ?? existing.sameAsBilling,
          updateStock: updateStockEnabled,

          receiveDate: data.receiveDate ? new Date(data.receiveDate) : existing.receiveDate,
          billDueDate: data.billDueDate
            ? new Date(data.billDueDate)
            : (existing.billDueDate ??
              dueDateFrom(
                data.supplierInvoiceDate
                  ? new Date(data.supplierInvoiceDate)
                  : data.grnDate
                    ? new Date(data.grnDate)
                    : existing.grnDate,
                supplier.creditDays
              )),
          challanNo: data.challanNo !== undefined ? data.challanNo : existing.challanNo,
          transport: data.transport !== undefined ? data.transport : existing.transport,
          eWayBill: data.eWayBill !== undefined ? data.eWayBill : existing.eWayBill,
          invoiceImage: file
            ? invoiceImageUrl
            : data.invoiceImage !== undefined
              ? data.invoiceImage
              : existing.invoiceImage,
          remarks: data.remarks !== undefined ? data.remarks : existing.remarks,

          discountType,
          discountValue,
          roundingAdjust,

          paymentStatus: computedStatus,
          payments: processedPayments as any,
          paymentMethod:
            rawPayments && processedPayments.length > 0
              ? processedPayments[processedPayments.length - 1].paymentMethod
              : data.paymentMethod !== undefined
                ? data.paymentMethod
                : existing.paymentMethod,
          referenceNumber:
            rawPayments && processedPayments.length > 0
              ? processedPayments[processedPayments.length - 1].referenceNumber
              : data.referenceNumber !== undefined
                ? data.referenceNumber
                : existing.referenceNumber,
          paymentDate:
            rawPayments && processedPayments.length > 0
              ? new Date(processedPayments[processedPayments.length - 1].paymentDate)
              : data.paymentDate
                ? new Date(data.paymentDate)
                : existing.paymentDate,

          subtotal,
          totalDiscount,
          totalTax,
          totalCgst,
          totalSgst,
          totalIgst,
          netAmount,
          currencyCode,
          exchangeRate,
          foreignTotal,
          poId: data.poId !== undefined ? data.poId : existing.poId,

          ...(data.items && {
            items: {
              create: itemsToCreate.map((item: any) => ({
                productId: item.productId,
                description: item.description,
                uom: item.uom,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                discountAmount: item.discountAmount || 0,
                tax: item.tax || 0,
                taxableAmount: item.taxableAmount || 0,
                cgstRate: item.cgstRate || 0,
                cgstAmount: item.cgstAmount || 0,
                sgstRate: item.sgstRate || 0,
                sgstAmount: item.sgstAmount || 0,
                igstRate: item.igstRate || 0,
                igstAmount: item.igstAmount || 0,
                hsnCode: item.hsnCode ?? null,
                cessRate: item.cessRate || 0,
                cessAmount: item.cessAmount || 0,
                lineTotal: item.lineTotal,
              })),
            },
          }),
        },
        include: {
          items: true,
        },
      });

      // Handle transitions
      if (existing.updateStock && !updateStockEnabled) {
        // Toggle reversed: Revert old stock levels using a Reversal stock adjustment
        const revAdjustmentNumber = `ADJ-REV-${existing.grnNumber}-${Date.now().toString().slice(-4)}`;
        const revAdjustmentItems = [];

        for (const item of existing.items) {
          const rawMaterial = await tx.rawMaterial.findUnique({
            where: byCode("rawMaterialId", item.productId),
          });
          if (!rawMaterial) continue;

          const itemTypeStr = rawMaterial.itemType || "Raw Material";
          let enumType: any = "RAW_MATERIAL";
          const normalized = itemTypeStr.toUpperCase().replace(/\s+/g, "_");
          if (normalized === "RAW_MATERIAL" || normalized === "RAW_MATERIALS") {
            enumType = "RAW_MATERIAL";
          } else if (normalized === "FINISHED_GOOD" || normalized === "FINISHED_GOODS") {
            enumType = "FINISHED_GOODS";
          } else if (normalized === "SEMI_FINISHED") {
            enumType = "SEMI_FINISHED";
          } else if (normalized === "CONSUMABLE" || normalized === "CONSUMABLES") {
            enumType = "CONSUMABLE";
          }

          const mult = getUomMultiplier(item.uom, rawMaterial.baseUom);
          const currentQtyNum = Number(rawMaterial.onHandQty) || 0;
          const revertQtyNum = Number(item.quantity) * mult;
          const adjustedQtyNum = currentQtyNum - revertQtyNum;

          revAdjustmentItems.push({
            itemType: enumType,
            rawMaterialId: item.productId,
            storeId: existing.storeId,
            currentQty: currentQtyNum,
            adjustedQty: adjustedQtyNum,
            difference: -revertQtyNum,
            unitCost: Number(item.unitPrice),
            batchNo: rawMaterial.batchNo || null,
            remarks: `Reversal of GRN ${existing.grnNumber} due to update stock disabled`,
          });

          await tx.rawMaterial.update({
            where: byCode("rawMaterialId", item.productId),
            data: {
              onHandQty: {
                decrement: revertQtyNum,
              },
            },
          });

          await tx.rawMaterialTransaction.create({
            data: {
              storeId: existing.storeId,
              rawMaterialId: item.productId,
              txnType: "STOCK_ADJUSTMENT_OUT",
              qty: revertQtyNum,
              txnDateTime: new Date(),
              remarks: `GRN Reversal: ${existing.grnNumber}`,
            },
          });
        }

        if (revAdjustmentItems.length > 0) {
          await tx.stockAdjustment.create({
            data: {
              adjustmentNumber: revAdjustmentNumber,
              adjustmentDate: new Date(),
              reason: `Auto-generated Reversal due to Update Stock disabled on Bill: ${existing.invoiceNo}`,
              status: "APPROVED",
              approvedBy: existing.createdBy,
              approvedAt: new Date(),
              createdBy: existing.createdBy,
              updatedBy: existing.createdBy,
              autoGenerated: true,
              sourceDocument: "GrnInvoice",
              sourceDocId: existing.id,
              type: "Reversal",
              items: {
                create: revAdjustmentItems,
              },
            },
          });
        }
      } else if (!existing.updateStock && updateStockEnabled) {
        // Toggle enabled: Apply stock levels using a Receipt stock adjustment
        const newAdjustmentNumber = `ADJ-GRN-${existing.grnNumber}-${Date.now().toString().slice(-4)}`;
        const newAdjustmentItems = [];

        for (const item of itemsToCreate) {
          const rawMaterial = await tx.rawMaterial.findUnique({
            where: byCode("rawMaterialId", item.productId),
          });
          if (!rawMaterial) {
            throw new ApiError(404, `Raw Material ${item.productId} not found`);
          }

          let itemTypeStr = rawMaterial.itemType;
          if (!itemTypeStr) {
            itemTypeStr = "Raw Material";
            await tx.rawMaterial.update({
              where: byCode("rawMaterialId", item.productId),
              data: {
                itemType: "Raw Material",
                flaggedForReview: true,
              },
            });
          }

          let enumType: any = "RAW_MATERIAL";
          const normalized = itemTypeStr.toUpperCase().replace(/\s+/g, "_");
          if (normalized === "RAW_MATERIAL" || normalized === "RAW_MATERIALS") {
            enumType = "RAW_MATERIAL";
          } else if (normalized === "FINISHED_GOOD" || normalized === "FINISHED_GOODS") {
            enumType = "FINISHED_GOODS";
          } else if (normalized === "SEMI_FINISHED") {
            enumType = "SEMI_FINISHED";
          } else if (normalized === "CONSUMABLE" || normalized === "CONSUMABLES") {
            enumType = "CONSUMABLE";
          }

          const mult = getUomMultiplier(item.uom, rawMaterial.baseUom);
          const currentQtyNum = Number(rawMaterial.onHandQty) || 0;
          const newQtyNum = Number(item.quantity) * mult;
          const adjustedQtyNum = currentQtyNum + newQtyNum;

          newAdjustmentItems.push({
            itemType: enumType,
            rawMaterialId: item.productId,
            storeId: storeId,
            currentQty: currentQtyNum,
            adjustedQty: adjustedQtyNum,
            difference: newQtyNum,
            unitCost: Number(item.unitPrice),
            batchNo: rawMaterial.batchNo || null,
            remarks: `Receipt from GRN ${existing.grnNumber} after update stock enabled`,
          });

          await tx.rawMaterial.update({
            where: byCode("rawMaterialId", item.productId),
            data: {
              onHandQty: {
                increment: newQtyNum,
              },
              lastMovementAt: new Date(),
            },
          });

          await tx.rawMaterialTransaction.create({
            data: {
              storeId: storeId,
              rawMaterialId: item.productId,
              txnType: "RECEIPT",
              qty: newQtyNum,
              txnDateTime: new Date(data.grnDate || existing.grnDate),
              remarks: `GRN Created (Auto Adjustment): ${existing.grnNumber}`,
            },
          });
        }

        if (newAdjustmentItems.length > 0) {
          await tx.stockAdjustment.create({
            data: {
              adjustmentNumber: newAdjustmentNumber,
              adjustmentDate: new Date(data.grnDate || existing.grnDate),
              reason: `Auto-generated on Update Stock enabled for Bill: ${data.invoiceNo || existing.invoiceNo}`,
              status: "APPROVED",
              approvedBy: existing.createdBy,
              approvedAt: new Date(),
              createdBy: existing.createdBy,
              updatedBy: existing.createdBy,
              autoGenerated: true,
              sourceDocument: "GrnInvoice",
              sourceDocId: existing.id,
              type: "Receipt",
              items: {
                create: newAdjustmentItems,
              },
            },
          });
        }
      } else if (existing.updateStock && updateStockEnabled) {
        // Both true: only update if there are changes
        let itemsChanged = false;
        if (items) {
          if (existing.items.length !== itemsToCreate.length) {
            itemsChanged = true;
          } else {
            for (const oldItem of existing.items) {
              const newItem = itemsToCreate.find((i) => i.productId === oldItem.productId);
              if (
                !newItem ||
                Number(newItem.quantity) !== Number(oldItem.quantity) ||
                Number(newItem.unitPrice) !== Number(oldItem.unitPrice)
              ) {
                itemsChanged = true;
                break;
              }
            }
          }
        }
        const storeChanged = data.storeId !== undefined && data.storeId !== existing.storeId;
        const dateChanged =
          data.grnDate !== undefined &&
          new Date(data.grnDate).getTime() !== new Date(existing.grnDate).getTime();

        if (itemsChanged || storeChanged || dateChanged) {
          // Revert old stock levels
          const revAdjustmentNumber = `ADJ-REV-${existing.grnNumber}-${Date.now().toString().slice(-4)}`;
          const revAdjustmentItems = [];

          for (const item of existing.items) {
            const rawMaterial = await tx.rawMaterial.findUnique({
              where: byCode("rawMaterialId", item.productId),
            });
            if (!rawMaterial) continue;

            const itemTypeStr = rawMaterial.itemType || "Raw Material";
            let enumType: any = "RAW_MATERIAL";
            const normalized = itemTypeStr.toUpperCase().replace(/\s+/g, "_");
            if (normalized === "RAW_MATERIAL" || normalized === "RAW_MATERIALS") {
              enumType = "RAW_MATERIAL";
            } else if (normalized === "FINISHED_GOOD" || normalized === "FINISHED_GOODS") {
              enumType = "FINISHED_GOODS";
            } else if (normalized === "SEMI_FINISHED") {
              enumType = "SEMI_FINISHED";
            } else if (normalized === "CONSUMABLE" || normalized === "CONSUMABLES") {
              enumType = "CONSUMABLE";
            }

            const mult = getUomMultiplier(item.uom, rawMaterial.baseUom);
            const currentQtyNum = Number(rawMaterial.onHandQty) || 0;
            const revertQtyNum = Number(item.quantity) * mult;
            const adjustedQtyNum = currentQtyNum - revertQtyNum;

            revAdjustmentItems.push({
              itemType: enumType,
              rawMaterialId: item.productId,
              storeId: existing.storeId,
              currentQty: currentQtyNum,
              adjustedQty: adjustedQtyNum,
              difference: -revertQtyNum,
              unitCost: Number(item.unitPrice),
              batchNo: rawMaterial.batchNo || null,
              remarks: `Reversal of GRN ${existing.grnNumber} due to update`,
            });

            await tx.rawMaterial.update({
              where: byCode("rawMaterialId", item.productId),
              data: {
                onHandQty: {
                  decrement: revertQtyNum,
                },
              },
            });

            await tx.rawMaterialTransaction.create({
              data: {
                storeId: existing.storeId,
                rawMaterialId: item.productId,
                txnType: "STOCK_ADJUSTMENT_OUT",
                qty: revertQtyNum,
                txnDateTime: new Date(),
                remarks: `GRN Reversal: ${existing.grnNumber}`,
              },
            });
          }

          if (revAdjustmentItems.length > 0) {
            await tx.stockAdjustment.create({
              data: {
                adjustmentNumber: revAdjustmentNumber,
                adjustmentDate: new Date(),
                reason: `Auto-generated Reversal due to update of Bill: ${existing.invoiceNo}`,
                status: "APPROVED",
                approvedBy: existing.createdBy,
                approvedAt: new Date(),
                createdBy: existing.createdBy,
                updatedBy: existing.createdBy,
                autoGenerated: true,
                sourceDocument: "GrnInvoice",
                sourceDocId: existing.id,
                type: "Reversal",
                items: {
                  create: revAdjustmentItems,
                },
              },
            });
          }

          // Apply new stock levels
          const newAdjustmentNumber = `ADJ-GRN-${existing.grnNumber}-${Date.now().toString().slice(-4)}`;
          const newAdjustmentItems = [];

          for (const item of itemsToCreate) {
            const rawMaterial = await tx.rawMaterial.findUnique({
              where: byCode("rawMaterialId", item.productId),
            });
            if (!rawMaterial) {
              throw new ApiError(404, `Raw Material ${item.productId} not found`);
            }

            let itemTypeStr = rawMaterial.itemType;
            if (!itemTypeStr) {
              itemTypeStr = "Raw Material";
              await tx.rawMaterial.update({
                where: byCode("rawMaterialId", item.productId),
                data: {
                  itemType: "Raw Material",
                  flaggedForReview: true,
                },
              });
            }

            let enumType: any = "RAW_MATERIAL";
            const normalized = itemTypeStr.toUpperCase().replace(/\s+/g, "_");
            if (normalized === "RAW_MATERIAL" || normalized === "RAW_MATERIALS") {
              enumType = "RAW_MATERIAL";
            } else if (normalized === "FINISHED_GOOD" || normalized === "FINISHED_GOODS") {
              enumType = "FINISHED_GOODS";
            } else if (normalized === "SEMI_FINISHED") {
              enumType = "SEMI_FINISHED";
            } else if (normalized === "CONSUMABLE" || normalized === "CONSUMABLES") {
              enumType = "CONSUMABLE";
            }

            const mult = getUomMultiplier(item.uom, rawMaterial.baseUom);
            const currentQtyNum = Number(rawMaterial.onHandQty) || 0;
            const newQtyNum = Number(item.quantity) * mult;
            const adjustedQtyNum = currentQtyNum + newQtyNum;

            newAdjustmentItems.push({
              itemType: enumType,
              rawMaterialId: item.productId,
              storeId: storeId,
              currentQty: currentQtyNum,
              adjustedQty: adjustedQtyNum,
              difference: newQtyNum,
              unitCost: Number(item.unitPrice),
              batchNo: rawMaterial.batchNo || null,
              remarks: `Updated receipt from GRN ${existing.grnNumber}`,
            });

            await tx.rawMaterial.update({
              where: byCode("rawMaterialId", item.productId),
              data: {
                onHandQty: {
                  increment: newQtyNum,
                },
                lastMovementAt: new Date(),
              },
            });

            await tx.rawMaterialTransaction.create({
              data: {
                storeId: storeId,
                rawMaterialId: item.productId,
                txnType: "RECEIPT",
                qty: newQtyNum,
                txnDateTime: new Date(data.grnDate || existing.grnDate),
                remarks: `GRN Updated (Auto Adjustment): ${existing.grnNumber}`,
              },
            });
          }

          if (newAdjustmentItems.length > 0) {
            await tx.stockAdjustment.create({
              data: {
                adjustmentNumber: newAdjustmentNumber,
                adjustmentDate: new Date(data.grnDate || existing.grnDate),
                reason: `Auto-generated on update of Bill: ${data.invoiceNo || existing.invoiceNo}`,
                status: "APPROVED",
                approvedBy: existing.createdBy,
                approvedAt: new Date(),
                createdBy: existing.createdBy,
                updatedBy: existing.createdBy,
                autoGenerated: true,
                sourceDocument: "GrnInvoice",
                sourceDocId: existing.id,
                type: "Receipt",
                items: {
                  create: newAdjustmentItems,
                },
              },
            });
          }
        }
      }

      return updated;
    });

    try {
      const { voucherPostingService } = await import("../accounts/voucherPosting.service.js");
      await voucherPostingService.postPaymentVouchersForGRN(updated.id);
    } catch (vErr) {
      logger.error(
        { err: vErr },
        "[Auto-Post Voucher Error] Failed to post Payment Vouchers for updated GRN:"
      );
    }

    return updated;
  }

  /** Kept for the DELETE route: deleting a GRN now means cancelling it. */
  async deleteGrnInvoice(
    id: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    return this.cancelGrnInvoice(id, actor, reason);
  }

  // ── Cancel (P1-09: a GRN is never deleted; it is cancelled and its vouchers reversed) ──
  async cancelGrnInvoice(
    id: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    const existing = await prisma.grnInvoice.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      throw new ApiError(404, "GRN Invoice not found");
    }
    if (existing.cancelledAt) {
      throw new ApiError(
        409,
        `GRN ${existing.grnNumber} is already cancelled`,
        "ALREADY_CANCELLED"
      );
    }

    return prisma.$transaction(
      async (tx) => {
        const payments: any[] = Array.isArray(existing.payments)
          ? (existing.payments as any[])
          : [];
        await cancellationService.cancelVouchersFor(
          ["GRN_INVOICE", "GRN_PAYMENT"],
          [existing.id, ...payments.map((p) => String(p.id)).filter(Boolean)],
          { reason, actor },
          tx
        );
        // P2-05: a cancelled bill's TDS deduction (if any) is reversed alongside it.
        await tdsService.reverseForDoc(
          "GRN_INVOICE",
          existing.id,
          reason?.trim() || `GRN ${existing.grnNumber} cancelled`,
          actor,
          tx
        );
        if (existing.updateStock) {
          // Undo every valuation row this GRN raised — a reversal row each, never a delete.
          await valuationService.reverseDocument("GRN", existing.id, actor, tx);

          const revAdjustmentNumber = `ADJ-REV-${existing.grnNumber}`;
          const revAdjustmentItems = [];

          for (const item of existing.items) {
            const rawMaterial = await tx.rawMaterial.findUnique({
              where: byCode("rawMaterialId", item.productId),
            });
            if (!rawMaterial) continue;

            const itemTypeStr = rawMaterial.itemType || "Raw Material";
            let enumType: any = "RAW_MATERIAL";
            const normalized = itemTypeStr.toUpperCase().replace(/\s+/g, "_");
            if (normalized === "RAW_MATERIAL" || normalized === "RAW_MATERIALS") {
              enumType = "RAW_MATERIAL";
            } else if (normalized === "FINISHED_GOOD" || normalized === "FINISHED_GOODS") {
              enumType = "FINISHED_GOODS";
            } else if (normalized === "SEMI_FINISHED") {
              enumType = "SEMI_FINISHED";
            } else if (normalized === "CONSUMABLE" || normalized === "CONSUMABLES") {
              enumType = "CONSUMABLE";
            }

            const mult = getUomMultiplier(item.uom, rawMaterial.baseUom);
            const currentQtyNum = Number(rawMaterial.onHandQty) || 0;
            const revertQtyNum = Number(item.quantity) * mult;
            const adjustedQtyNum = currentQtyNum - revertQtyNum;

            revAdjustmentItems.push({
              itemType: enumType,
              rawMaterialId: item.productId,
              storeId: existing.storeId,
              currentQty: currentQtyNum,
              adjustedQty: adjustedQtyNum,
              difference: -revertQtyNum,
              unitCost: Number(item.unitPrice),
              batchNo: rawMaterial.batchNo || null,
              remarks: `Reversal of GRN ${existing.grnNumber} on cancellation`,
            });

            await tx.rawMaterial.update({
              where: byCode("rawMaterialId", item.productId),
              data: {
                onHandQty: {
                  decrement: revertQtyNum,
                },
              },
            });

            await tx.rawMaterialTransaction.create({
              data: {
                storeId: existing.storeId,
                rawMaterialId: item.productId,
                txnType: "STOCK_ADJUSTMENT_OUT",
                qty: revertQtyNum,
                txnDateTime: new Date(),
                remarks: `GRN cancelled: ${existing.grnNumber}`,
              },
            });
          }

          if (revAdjustmentItems.length > 0) {
            await tx.stockAdjustment.create({
              data: {
                adjustmentNumber: revAdjustmentNumber,
                adjustmentDate: new Date(),
                reason: `Reversal on cancellation of bill: ${existing.invoiceNo}`,
                status: "APPROVED",
                approvedBy: existing.createdBy,
                approvedAt: new Date(),
                createdBy: existing.createdBy,
                updatedBy: existing.createdBy,
                autoGenerated: true,
                sourceDocument: "GrnInvoice",
                sourceDocId: existing.id,
                type: "Reversal",
                items: {
                  create: revAdjustmentItems,
                },
              },
            });
          }
        }

        // Restore PO status on deletion
        if (existing.poId) {
          const po = await tx.purchaseOrder.findUnique({
            where: { id: existing.poId },
            include: { items: true },
          });
          if (po) {
            let allFullyReceived = true;
            let hasPartialReceived = false;

            for (const poItem of po.items) {
              const item = existing.items.find((i) => i.productId === poItem.productId);
              const currentRec = Number(poItem.receivedQty) || 0;
              const removedRec = item ? Number(item.quantity) : 0;
              const newRec = Math.max(0, currentRec - removedRec);

              if (removedRec > 0) {
                await tx.purchaseOrderItem.update({
                  where: { id: poItem.id },
                  data: { receivedQty: newRec },
                });
              }

              if (newRec < Number(poItem.quantity)) {
                allFullyReceived = false;
              }
              if (newRec > 0) {
                hasPartialReceived = true;
              }
            }

            const newStatus = allFullyReceived
              ? "CLOSED"
              : hasPartialReceived
                ? "PARTIALLY_RECEIVED"
                : "OPEN";

            await tx.purchaseOrder.update({
              where: { id: existing.poId },
              data: { status: newStatus },
            });
          }
        }

        // Delete the invoice (items will Cascade delete)
        await tx.grnInvoice.update({
          where: { id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: actor.userId ?? null,
            cancelReason: reason?.trim() || null,
          },
        });
      },
      { timeout: 30000, maxWait: 10000 }
    );
  }
}

export default new GrnInvoiceService();
