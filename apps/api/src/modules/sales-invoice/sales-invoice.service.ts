import { eInvoiceService } from "../e-invoice/e-invoice.service";
import type { SalesDocumentType, SupplyType } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type { Db } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { CreateSalesInvoiceInput } from "./sales-invoice.validation";
import crypto from "crypto";
import { logger } from "../../lib/logger";
import { documentNumberService } from "../documents/document-number.service";
import { canChargeGst, salesDocumentTypeFor, splitGst, supplyTypeFor } from "../gst/gst.calc";
import {
  cessOn,
  companyGstProfile,
  productTaxDefaults,
  resolveIssuingPlace,
  stateOfGstin,
  type IssuingPlace,
} from "../gst/gst.context";
import { stateNameToCode } from "../imports/imports.types";
import { periodService } from "../accounts/period.service";
import { BASE_CURRENCY, currencyService } from "../currency/currency.service";
import { dueDateFrom } from "../accounts/ageing";
import { cancellationService } from "../accounts/cancellation.service";

type SaleItemInput = CreateSalesInvoiceInput["items"][number];
type SaleHeaderInput = {
  businessPlaceId?: string | number | bigint | null;
  placeOfSupply?: string | null;
  reverseCharge?: boolean | null;
  shippingAddress?: { state?: string | null } | null;
};
type SaleCurrencyInput = { currencyCode?: string | null; exchangeRate?: number | null };
type SaleExportInput = {
  exportType?: "UNDER_LUT" | "WITH_TAX" | null;
  lutNumber?: string | null;
  shippingBillNo?: string | null;
  shippingBillDate?: string | null;
  portCode?: string | null;
};
type SaleCustomer = {
  gstRegType: string;
  stateCode: string | null;
  gstin: string | null;
  addresses?: { is_default?: boolean; state_code?: string | null; address?: unknown }[];
};

/** GST facts for a sales document (P1-08b): where it is issued from, where it is supplied to. */
export interface SaleGstContext {
  place: IssuingPlace;
  supplyType: SupplyType;
  placeOfSupply: string | null;
  documentType: SalesDocumentType;
  /** False for a composition or unregistered company: a bill of supply carries no tax. */
  chargeable: boolean;
  /** Numbering series the document draws from. */
  series: string;
  reverseCharge: boolean;
}

export async function saleGstContext(
  db: Db,
  data: SaleHeaderInput,
  customer: SaleCustomer
): Promise<SaleGstContext> {
  const profile = await companyGstProfile(db);
  const place = await resolveIssuingPlace(data.businessPlaceId, profile, db);
  const billing = customer.addresses?.find((a) => a.is_default) || customer.addresses?.[0];
  const billingState = (billing?.address as { state?: string } | undefined)?.state;
  const placeOfSupply =
    data.placeOfSupply ||
    customer.stateCode ||
    stateOfGstin(customer.gstin) ||
    stateNameToCode(data.shippingAddress?.state ?? undefined) ||
    billing?.state_code ||
    stateNameToCode(billingState) ||
    null;
  const supplyType = supplyTypeFor({
    fromStateCode: place.stateCode,
    toStateCode: placeOfSupply,
    partyRegistration: customer.gstRegType,
  });
  const documentType = salesDocumentTypeFor(profile.registrationType, supplyType);
  const series =
    documentType === "BILL_OF_SUPPLY"
      ? "BILL_OF_SUPPLY"
      : documentType === "EXPORT_INVOICE"
        ? "EXPORT_INVOICE"
        : "SALES_INVOICE";
  return {
    place,
    supplyType,
    placeOfSupply,
    documentType,
    chargeable: canChargeGst(profile.registrationType),
    series,
    reverseCharge: Boolean(data.reverseCharge),
  };
}

/** Line arithmetic: rate from the payload, else the product or its HSN; split by the supply type. */
export async function computeSaleLines(db: Db, items: SaleItemInput[], gst: SaleGstContext) {
  const defaults = await productTaxDefaults(
    items.map((i) => i.productId),
    db
  );
  let subTotal = 0;
  let taxTotal = 0;
  let cessTotal = 0;
  const lines = items.map((item) => {
    const qty = Number(item.qty);
    const rate = Number(item.rate);
    const discount = Number(item.discountAmount) || 0;
    const lineSubtotal = qty * rate - discount;
    const def = defaults.get(String(item.productId));
    const taxRate = gst.chargeable ? (item.taxPercent ?? def?.gstRate ?? 0) : 0;
    const cessRate = gst.chargeable ? (item.cessRate ?? def?.cessRate ?? 0) : 0;
    const split = splitGst(lineSubtotal, taxRate, gst.supplyType);
    const cessAmount = cessOn(lineSubtotal, cessRate);
    subTotal += lineSubtotal;
    taxTotal += split.taxAmount;
    cessTotal += cessAmount;
    return {
      productId: BigInt(item.productId),
      quantity: qty,
      unitPrice: rate,
      weight: Number(item.weight) || 0,
      discountAmount: discount,
      hsnCode: item.hsnCode ?? def?.hsnCode ?? null,
      tax: taxRate,
      taxableAmount: lineSubtotal,
      cgstRate: split.cgstRate,
      cgstAmount: split.cgstAmount,
      sgstRate: split.sgstRate,
      sgstAmount: split.sgstAmount,
      igstRate: split.igstRate,
      igstAmount: split.igstAmount,
      cessRate,
      cessAmount,
      lineTotal: lineSubtotal + split.taxAmount + cessAmount,
    };
  });
  return { items: lines, subTotal, taxTotal, cessTotal };
}

const gstHeader = (gst: SaleGstContext, customerGstin: string | null, cessTotal: number) => ({
  documentType: gst.documentType,
  businessPlaceId: gst.place.id,
  placeOfSupply: gst.placeOfSupply,
  supplyType: gst.supplyType,
  customerGstin,
  reverseCharge: gst.reverseCharge,
  cessTotal,
});

function serializeInvoice(invoice: any) {
  if (!invoice) return invoice;
  const serialized = { ...invoice };
  if (serialized.items) {
    serialized.items = serialized.items.map((item: any) => ({
      ...item,
      productId: item.productId?.toString(),
    }));
  }
  return serialized;
}

class SalesInvoiceService {
  async createSalesInvoice(
    data: CreateSalesInvoiceInput,
    currentUser: { userId: string; companyId: string }
  ) {
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      include: { addresses: true },
    });
    if (!customer) throw new ApiError(404, "Customer not found");

    await periodService.assertPostingAllowed(new Date(data.invoiceDate), currentUser);
    const gst = await saleGstContext(prisma, data as SaleHeaderInput, customer as SaleCustomer);

    // Look up sales product names for invoice item descriptions
    const spIds = [...new Set(data.items.map((i) => String(i.productId)))];
    const salesProductsForDesc = await prisma.salesProduct
      .findMany({
        where: { id: { in: spIds.map((id) => BigInt(id)) } },
        select: { id: true, salesProductName: true, salesProductCode: true },
      })
      .catch(() => []);
    const spNameMap = new Map(
      salesProductsForDesc.map((sp: any) => [
        sp.id.toString(),
        sp.salesProductName || sp.salesProductCode || "",
      ])
    );

    // Foreign currency (P1-14). The line rates arrive in the document's currency; converting
    // them here means every figure computed below — line and header — is already in rupees, and
    // nothing downstream (vouchers, GSTR-1, ageing) has to know a document was ever foreign.
    // The rate is frozen onto the document: a rate corrected next week must not restate this
    // month's books.
    const currencyCode = String(
      (data as SaleCurrencyInput).currencyCode ?? BASE_CURRENCY
    ).toUpperCase();
    const exchangeRate =
      currencyCode === BASE_CURRENCY
        ? 1
        : ((data as SaleCurrencyInput).exchangeRate ??
          (await currencyService.rateFor(currencyCode, new Date(data.invoiceDate))));
    const itemsInInr =
      exchangeRate === 1
        ? data.items
        : data.items.map((i) => ({
            ...i,
            rate: Number(i.rate) * exchangeRate,
            discountAmount: Number(i.discountAmount ?? 0) * exchangeRate,
          }));

    const lines = await computeSaleLines(prisma, itemsInInr, gst);
    const invoiceItems = lines.items.map((line) => ({
      ...line,
      description: spNameMap.get(String(line.productId)) || null,
    }));
    const subTotal = lines.subTotal;
    let taxTotal = lines.taxTotal;
    const cessTotal = lines.cessTotal;

    // Discount
    const d = data as any;
    const totalDiscount = Number(d.totalDiscount) || 0;
    const taxableAmount = subTotal - totalDiscount;

    // Recalculate tax on discounted amount
    if (totalDiscount > 0 && subTotal > 0) {
      taxTotal = 0;
      invoiceItems.forEach((item) => {
        const lineAmount = Number(item.quantity) * Number(item.unitPrice);
        const share = lineAmount / subTotal;
        const lineTaxable = lineAmount - totalDiscount * share;
        const lineTax = (lineTaxable * Number(item.tax)) / 100;
        taxTotal += lineTax;
      });
    }

    // Parse extra charges from narration
    let chargeAdditions = 0;
    let chargeDeductions = 0;
    if ((data as any).narration) {
      try {
        const parsed = JSON.parse((data as any).narration);
        const chargeRows = parsed?.__chargeRows__ || [];
        for (const row of chargeRows) {
          const amt = Number(row.amount) || 0;
          if (amt <= 0) continue;
          if (String(row.type || "").includes("MINUS")) chargeDeductions += amt;
          else chargeAdditions += amt;
        }
      } catch {
        /* ignore bad JSON */
      }
    }
    // Bill sundry (additions/deductions)
    let billSundryTotal = 0;
    const billSundryData = (data as any).billSundry;
    if (Array.isArray(billSundryData)) {
      for (const row of billSundryData) {
        const amt = Number(row.amount) || 0;
        if (amt <= 0) continue;
        const typeStr = String(row.type || "").toUpperCase();
        if (typeStr.includes("DISCOUNT") || typeStr.includes("MINUS")) billSundryTotal -= amt;
        else billSundryTotal += amt;
      }
    }

    const grandTotal =
      taxableAmount + taxTotal + cessTotal + chargeAdditions - chargeDeductions + billSundryTotal;

    const exportHeader = {
      exportType: (data as SaleExportInput).exportType ?? null,
      lutNumber: (data as SaleExportInput).lutNumber ?? null,
      shippingBillNo: (data as SaleExportInput).shippingBillNo ?? null,
      shippingBillDate: (data as SaleExportInput).shippingBillDate
        ? new Date((data as SaleExportInput).shippingBillDate as string)
        : null,
      portCode: (data as SaleExportInput).portCode ?? null,
      currencyCode,
      exchangeRate,
      /** What the customer is billed in their own currency; every other column is rupees. */
      foreignTotal: exchangeRate === 1 ? null : Math.round((grandTotal / exchangeRate) * 100) / 100,
    };

    const computedStatus = "CONFIRMED";

    const invoice = await prisma.$transaction(
      async (tx) => {
        const invoiceNo =
          data.invoiceNo ??
          (await documentNumberService.next(gst.series, {
            date: new Date(data.invoiceDate),
            businessPlaceId: gst.place.id,
            tx,
          }));

        // Increment invoice sequence number
        const settings = await tx.invoiceSetting.findUnique({
          where: { companyId: currentUser.companyId },
        });

        if (settings) {
          const invDate = new Date(data.invoiceDate);
          const settingsStart = new Date(settings.financialYearStart);
          const settingsEnd = new Date(settings.financialYearEnd);

          if (invDate >= settingsStart && invDate <= settingsEnd) {
            await tx.invoiceSetting.update({
              where: { id: settings.id },
              data: { currentSequenceNumber: { increment: 1 } },
            });
          }
        }

        // Create the invoice
        const invoice = await tx.salesInvoice.create({
          data: {
            invoiceNo,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate
              ? new Date(data.dueDate)
              : dueDateFrom(new Date(data.invoiceDate), customer.creditDays),
            customerId: data.customerId,
            storeId: data.storeId,
            notes: data.notes,
            narration: (data as any).narration || null,
            transport: (data as any).transport || null,
            numberOfBundle:
              (data as any).numberOfBundle != null ? Number((data as any).numberOfBundle) : null,
            billSundry:
              Array.isArray(billSundryData) && billSundryData.length > 0
                ? billSundryData
                : undefined,
            shippingAddressLine1: (data as any).shippingAddress?.line1 || null,
            shippingCity: (data as any).shippingAddress?.city || null,
            shippingState: (data as any).shippingAddress?.state || null,
            shippingPincode: (data as any).shippingAddress?.pincode || null,
            salesOrderId: data.salesOrderId || null,
            ...exportHeader,
            ...gstHeader(gst, customer.gstin ?? null, cessTotal),
            subTotal,
            discountType: d.discountType || null,
            discountValue: Number(d.discountValue) || 0,
            totalDiscount,
            taxTotal,
            grandTotal,
            companyId: currentUser.companyId,
            createdBy: currentUser.userId,
            status: computedStatus,
            payments: [] as any,
            items: { create: invoiceItems },
          },
          include: {
            customer: { select: { id: true, firmName: true, displayName: true, email: true } },
            items: {
              include: {
                product: { select: { id: true, productCode: true, productName: true } },
              },
            },
          },
        });

        // Update customer outstandingAmount
        const unpaidPortion = Math.max(0, Math.round(grandTotal * 100) / 100);
        await tx.customer.update({
          where: { id: data.customerId },
          data: { outstandingAmount: { increment: unpaidPortion } },
        });

        // Update invoicedQty on SalesOrderItems and mark source SO as INVOICED
        if (data.salesOrderId) {
          // Fetch the sales order items to match by salesProductId
          const soItems = await tx.salesOrderItem.findMany({
            where: { salesOrderId: data.salesOrderId },
          });

          for (const item of data.items) {
            const invoiceQty = Number(item.qty);
            if (invoiceQty <= 0) continue;
            const excludedComps = new Set(((item as any).excludedComponents || []).map(String));

            // Find SO items that belong to this sales product
            const matchingItems = soItems.filter(
              (soi) => String(soi.salesProductId) === String(item.productId)
            );

            if (matchingItems.length > 0) {
              // Update each component product's invoicedQty (skip excluded ones)
              for (const soi of matchingItems) {
                if (excludedComps.has(String(soi.productId))) continue;
                const compPerUnit = Number(soi.quantity) / Math.max(1, invoiceQty);
                const compQty = compPerUnit * invoiceQty;
                await tx.salesOrderItem.update({
                  where: { id: soi.id },
                  data: { invoicedQty: { increment: compQty } },
                });
              }
            } else {
              // Fallback: direct productId match
              await tx.salesOrderItem.updateMany({
                where: { salesOrderId: data.salesOrderId, productId: BigInt(item.productId) },
                data: { invoicedQty: { increment: invoiceQty } },
              });
            }
          }

          // Mark the source sales order as INVOICED
          await tx.salesOrder.update({
            where: { id: data.salesOrderId },
            data: {
              status: "INVOICED" as any,
            },
          });
        }

        // Create stock adjustment for dispatched items
        // Resolve component products from SalesProduct so stock is deducted per component
        const adjustmentPrefix = `ADJ-${new Date().getFullYear()}-`;
        const lastAdj = await tx.stockAdjustment.findFirst({
          where: { adjustmentNumber: { startsWith: adjustmentPrefix } },
          orderBy: { adjustmentNumber: "desc" },
          select: { adjustmentNumber: true },
        });
        let seq = 1;
        if (lastAdj?.adjustmentNumber) {
          const parts = lastAdj.adjustmentNumber.split("-");
          seq = (parseInt(parts[parts.length - 1]) || 0) + 1;
        }
        const adjustmentNumber = `${adjustmentPrefix}${String(seq).padStart(4, "0")}`;

        let stockAdjustmentCreated = false;
        let stockAdjustmentId: bigint | null = null;

        for (const item of data.items) {
          const invoiceQty = Number(item.qty);
          if (invoiceQty <= 0) continue;
          const excludedComps = new Set(((item as any).excludedComponents || []).map(String));

          // Look up SalesProduct components to deduct stock per component
          const salesProduct = await tx.salesProduct
            .findUnique({
              where: { id: BigInt(item.productId) },
              include: { components: true },
            })
            .catch(() => null);

          // Build list of products to deduct: components if SalesProduct found, else direct productId
          const productsToDeduct: { productId: bigint; qty: number }[] = [];
          if (salesProduct && salesProduct.components.length > 0) {
            for (const comp of salesProduct.components) {
              if (excludedComps.has(String(comp.componentProductId))) continue;
              const compQty = Number(comp.quantity || 1) * invoiceQty;
              productsToDeduct.push({ productId: comp.componentProductId, qty: compQty });
            }
          } else {
            productsToDeduct.push({ productId: BigInt(item.productId), qty: invoiceQty });
          }

          for (const { productId: pid, qty } of productsToDeduct) {
            const fgStocks = await tx.finishedGoodsStock.findMany({
              where: { productItemId: pid },
              orderBy: { onHandQty: "desc" },
            });
            if (fgStocks.length === 0) continue;

            const targetStoreId = fgStocks[0].storeId;
            const fgStock = fgStocks[0];

            if (!stockAdjustmentCreated) {
              const newAdj = await tx.stockAdjustment.create({
                data: {
                  adjustmentNumber,
                  adjustmentDate: new Date(data.invoiceDate),
                  adjustmentType: "SALES_INVOICE_DISPATCH",
                  reason: `Sales Invoice ${invoiceNo}`,
                  status: "APPROVED",
                  createdBy: currentUser.userId,
                  updatedBy: currentUser.userId,
                  approvedBy: currentUser.userId,
                  approvedAt: new Date(),
                  autoGenerated: true,
                  sourceDocument: "SALES_INVOICE",
                  sourceDocId: invoice.id,
                },
              });
              stockAdjustmentId = newAdj.id;
              stockAdjustmentCreated = true;
            }

            await tx.finishedGoodsStock.update({
              where: { storeId_productItemId: { storeId: targetStoreId, productItemId: pid } },
              data: { onHandQty: { decrement: qty } },
            });

            await tx.stockAdjustmentItem.create({
              data: {
                stockAdjustmentId: stockAdjustmentId!,
                itemType: "FINISHED_GOODS",
                productItemId: pid,
                storeId: targetStoreId,
                currentQty: fgStock.onHandQty,
                adjustedQty: Number(fgStock.onHandQty) - qty,
                difference: -qty,
                remarks: `Invoice ${invoiceNo}`,
              },
            });

            await tx.finishedGoodsTransaction.create({
              data: {
                txnDateTime: new Date(),
                storeId: targetStoreId,
                productItemId: pid,
                txnType: "STOCK_ADJUSTMENT_OUT",
                qty: new (require("decimal.js").Decimal)(qty),
                relatedDocNo: adjustmentNumber,
                remarks: `Invoice ${invoiceNo}`,
                createdBy: currentUser.userId,
              },
            });
          } // end productsToDeduct loop
        } // end items loop

        return invoice;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    // Auto-post SALES Voucher
    {
      try {
        const { voucherPostingService } = await import("../accounts/voucherPosting.service.js");
        await voucherPostingService.postSalesVoucher(invoice.id);
      } catch (vErr) {
        logger.error(
          { err: vErr },
          "[Auto-Post Voucher Error] Failed to post Sales Voucher for invoice:"
        );
      }
    }

    return serializeInvoice(invoice);
  }

  async getAllSalesInvoices(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    customerId?: string;
    fromDate?: string;
    toDate?: string;
    companyId: string;
  }) {
    const page = params.page || 1;
    const pageSize = params.pageSize || 10;
    const skip = (page - 1) * pageSize;

    const whereClause: any = {
      companyId: params.companyId,
    };

    if (params.customerId) {
      whereClause.customerId = params.customerId;
    }

    if (params.search) {
      whereClause.OR = [
        { invoiceNo: { contains: params.search, mode: "insensitive" } },
        { customer: { firmName: { contains: params.search, mode: "insensitive" } } },
        { customer: { displayName: { contains: params.search, mode: "insensitive" } } },
      ];
    }

    if (params.fromDate || params.toDate) {
      whereClause.invoiceDate = {};
      if (params.fromDate) {
        whereClause.invoiceDate.gte = new Date(params.fromDate);
      }
      if (params.toDate) {
        whereClause.invoiceDate.lte = new Date(params.toDate);
      }
    }

    const [invoices, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: whereClause,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          customer: {
            select: {
              id: true,
              firmName: true,
              displayName: true,
              mobile: true,
            },
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  productCode: true,
                  productName: true,
                },
              },
            },
          },
        },
      }),
      prisma.salesInvoice.count({ where: whereClause }),
    ]);

    return {
      data: invoices.map(serializeInvoice),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getSalesInvoiceById(id: string, companyId: string) {
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id, companyId },
      include: {
        customer: {
          select: {
            id: true,
            firmName: true,
            displayName: true,
            email: true,
            gstin: true,
            addresses: true,
            mobile: true,
          },
        },
        salesOrder: {
          select: {
            id: true,
            orderNo: true,
            mobile: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                productCode: true,
                productName: true,
                uom: { select: { uomName: true } },
              },
            },
          },
        },
      },
    });

    if (!invoice) throw new ApiError(404, "Sales Invoice not found");
    return serializeInvoice(invoice);
  }

  /**
   * P1-09: an invoice is cancelled, never deleted. It stays on file as CANCELLED, its sales and
   * receipt vouchers are reversed, the customer's outstanding is corrected and the dispatched
   * stock comes back through a reversal adjustment.
   */
  async cancelSalesInvoice(
    id: string,
    actor: { userId?: string; isSuperAdmin?: boolean },
    reason?: string | null
  ) {
    return prisma.$transaction(
      async (tx) => {
        const invoice = await tx.salesInvoice.findUnique({ where: { id } });
        if (!invoice) throw new ApiError(404, "Sales Invoice not found");
        if (invoice.cancelledAt) {
          throw new ApiError(
            409,
            `Invoice ${invoice.invoiceNo} is already cancelled`,
            "ALREADY_CANCELLED"
          );
        }
        // P1-11: a live IRN is cancelled on the portal before the invoice leaves the books.
        await eInvoiceService.assertDocumentCancellable("INV", invoice.id, tx);

        const payments = invoice.payments
          ? ((typeof invoice.payments === "string"
              ? JSON.parse(invoice.payments)
              : invoice.payments) as any[])
          : [];
        const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const unpaidPortion = Math.max(
          0,
          Math.round((Number(invoice.grandTotal) - totalPaid) * 100) / 100
        );

        // Vouchers: the sales voucher and every receipt posted for its payments.
        const paymentIds = payments.map((p: any) => String(p.id)).filter(Boolean);
        await cancellationService.cancelVouchersFor(
          ["SALES_INVOICE", "SALES_PAYMENT"],
          [invoice.id, ...paymentIds],
          { reason, actor },
          tx
        );

        // Stock: put dispatched goods back through a reversal adjustment (the dispatch stays on file).
        const dispatch = await tx.stockAdjustment.findFirst({
          where: { sourceDocument: "SALES_INVOICE", sourceDocId: invoice.id },
          include: { items: true },
        });
        if (dispatch && dispatch.items.length > 0) {
          const reversal = await tx.stockAdjustment.create({
            data: {
              adjustmentNumber: `ADJ-CANCEL-${invoice.invoiceNo}`.slice(0, 50),
              adjustmentDate: new Date(),
              adjustmentType: "SALES_INVOICE_CANCEL",
              reason: `Cancellation of invoice ${invoice.invoiceNo}${reason ? `: ${reason}` : ""}`,
              status: "APPROVED",
              createdBy: actor.userId,
              updatedBy: actor.userId,
              approvedBy: actor.userId,
              approvedAt: new Date(),
              autoGenerated: true,
              sourceDocument: "SALES_INVOICE_CANCEL",
              sourceDocId: invoice.id,
            },
          });
          for (const line of dispatch.items) {
            if (line.productItemId === null) continue;
            const qty = Math.abs(Number(line.difference));
            const stock = await tx.finishedGoodsStock.findUnique({
              where: {
                storeId_productItemId: { storeId: line.storeId, productItemId: line.productItemId },
              },
            });
            if (!stock) continue;
            await tx.finishedGoodsStock.update({
              where: {
                storeId_productItemId: { storeId: line.storeId, productItemId: line.productItemId },
              },
              data: { onHandQty: { increment: qty } },
            });
            await tx.stockAdjustmentItem.create({
              data: {
                stockAdjustmentId: reversal.id,
                itemType: "FINISHED_GOODS",
                productItemId: line.productItemId,
                storeId: line.storeId,
                currentQty: stock.onHandQty,
                adjustedQty: Number(stock.onHandQty) + qty,
                difference: qty,
                remarks: `Invoice ${invoice.invoiceNo} cancelled`,
              },
            });
            await tx.finishedGoodsTransaction.create({
              data: {
                txnDateTime: new Date(),
                storeId: line.storeId,
                productItemId: line.productItemId,
                txnType: "STOCK_ADJUSTMENT_IN",
                qty: new (require("decimal.js").Decimal)(qty),
                relatedDocNo: reversal.adjustmentNumber,
                remarks: `Invoice ${invoice.invoiceNo} cancelled`,
                createdBy: actor.userId,
              },
            });
          }
        }

        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { outstandingAmount: { decrement: unpaidPortion } },
        });

        return tx.salesInvoice.update({
          where: { id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelledBy: actor.userId ?? null,
            cancelReason: reason?.trim() || null,
          },
        });
      },
      { maxWait: 10000, timeout: 30000 }
    );
  }

  /** Kept for the DELETE route: deleting an invoice now means cancelling it. */
  async deleteSalesInvoice(
    id: string,
    _companyId: string,
    actor: { userId?: string; isSuperAdmin?: boolean } = {},
    reason?: string | null
  ) {
    return this.cancelSalesInvoice(id, actor, reason);
  }

  async updateSalesInvoice(
    id: string,
    data: CreateSalesInvoiceInput,
    currentUser: { userId: string; companyId: string }
  ) {
    return prisma.$transaction(
      async (tx) => {
        // 1. Fetch existing invoice with items
        const existing = await tx.salesInvoice.findFirst({
          where: { id, companyId: currentUser.companyId },
          include: { items: true },
        });
        if (!existing) throw new ApiError(404, "Sales Invoice not found");

        if (existing.status === "PAID") {
          throw new ApiError(400, "Fully paid invoices cannot be edited");
        }
        if (existing.cancelledAt) throw new ApiError(409, "Cancelled invoices cannot be edited");
        // Both the old and the new date must be open: the edit reverses one and posts the other.
        await periodService.assertPostingAllowed(existing.invoiceDate, currentUser, tx);
        await periodService.assertPostingAllowed(new Date(data.invoiceDate), currentUser, tx);

        // Revert old accounting/stock
        {
          const oldUnpaidPortion = Math.max(0, Math.round(Number(existing.grandTotal) * 100) / 100);

          await tx.customer.update({
            where: { id: existing.customerId },
            data: { outstandingAmount: { decrement: oldUnpaidPortion } },
          });

          // 3. Revert old invoicedQty on SalesOrderItems
          if (existing.salesOrderId) {
            for (const item of existing.items) {
              const qty = Number(item.quantity);
              if (qty <= 0) continue;
              await tx.salesOrderItem.updateMany({
                where: { salesOrderId: existing.salesOrderId, productId: item.productId },
                data: { invoicedQty: { decrement: qty } },
              });
            }
          }

          // 4. Revert old stock adjustments & finished goods stocks
          const oldAdj = await tx.stockAdjustment.findFirst({
            where: { sourceDocument: "SALES_INVOICE", sourceDocId: existing.id },
          });
          if (oldAdj) {
            const oldAdjItems = await tx.stockAdjustmentItem.findMany({
              where: { stockAdjustmentId: oldAdj.id },
            });
            for (const adjItem of oldAdjItems) {
              if (adjItem.productItemId === null) continue;
              const pid: bigint = adjItem.productItemId;
              await tx.finishedGoodsStock.update({
                where: { storeId_productItemId: { storeId: adjItem.storeId, productItemId: pid } },
                data: { onHandQty: { increment: Number(adjItem.difference) * -1 } },
              });
            }
            await tx.stockAdjustmentItem.deleteMany({ where: { stockAdjustmentId: oldAdj.id } });
            await tx.stockAdjustment.delete({ where: { id: oldAdj.id } });
          }
        }

        // 5. Calculate new items and totals
        const customer = await tx.customer.findUnique({
          where: { id: data.customerId },
          include: { addresses: true },
        });
        if (!customer) throw new ApiError(404, "Customer not found");

        const gst = await saleGstContext(tx, data as SaleHeaderInput, customer as SaleCustomer);
        const lines = await computeSaleLines(tx, data.items, gst);
        const invoiceItems = lines.items;
        const subTotal = lines.subTotal;
        let taxTotal = lines.taxTotal;
        const cessTotal = lines.cessTotal;

        const du = data as any;
        const updTotalDiscount = Number(du.totalDiscount) || 0;
        const updTaxableAmount = subTotal - updTotalDiscount;

        if (updTotalDiscount > 0 && subTotal > 0) {
          taxTotal = 0;
          invoiceItems.forEach((item) => {
            const lineAmount = Number(item.quantity) * Number(item.unitPrice);
            const share = lineAmount / subTotal;
            const lineTaxable = lineAmount - updTotalDiscount * share;
            const lineTax = (lineTaxable * Number(item.tax)) / 100;
            taxTotal += lineTax;
          });
        }

        let updChargeAdditions = 0;
        let updChargeDeductions = 0;
        if ((data as any).narration) {
          try {
            const parsed = JSON.parse((data as any).narration);
            const chargeRows = parsed?.__chargeRows__ || [];
            for (const row of chargeRows) {
              const amt = Number(row.amount) || 0;
              if (amt <= 0) continue;
              if (String(row.type || "").includes("MINUS")) updChargeDeductions += amt;
              else updChargeAdditions += amt;
            }
          } catch {
            /* ignore bad JSON */
          }
        }
        // Bill sundry (additions/deductions)
        let updBillSundryTotal = 0;
        const updBillSundryData = (data as any).billSundry;
        if (Array.isArray(updBillSundryData)) {
          for (const row of updBillSundryData) {
            const amt = Number(row.amount) || 0;
            if (amt <= 0) continue;
            const typeStr = String(row.type || "").toUpperCase();
            if (typeStr.includes("DISCOUNT") || typeStr.includes("MINUS"))
              updBillSundryTotal -= amt;
            else updBillSundryTotal += amt;
          }
        }

        const grandTotal =
          updTaxableAmount +
          taxTotal +
          cessTotal +
          updChargeAdditions -
          updChargeDeductions +
          updBillSundryTotal;

        // 6. Delete old invoice items and update record
        await tx.salesInvoiceItem.deleteMany({ where: { salesInvoiceId: id } });

        const updatedInvoice = await tx.salesInvoice.update({
          where: { id },
          data: {
            customerId: data.customerId,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate
              ? new Date(data.dueDate)
              : dueDateFrom(new Date(data.invoiceDate), customer.creditDays),
            notes: data.notes,
            narration: (data as any).narration || null,
            transport: (data as any).transport || null,
            numberOfBundle:
              (data as any).numberOfBundle != null ? Number((data as any).numberOfBundle) : null,
            billSundry:
              Array.isArray(updBillSundryData) && updBillSundryData.length > 0
                ? updBillSundryData
                : undefined,
            shippingAddressLine1: (data as any).shippingAddress?.line1 || null,
            shippingCity: (data as any).shippingAddress?.city || null,
            shippingState: (data as any).shippingAddress?.state || null,
            shippingPincode: (data as any).shippingAddress?.pincode || null,
            salesOrderId: data.salesOrderId || null,
            ...gstHeader(gst, customer.gstin ?? null, cessTotal),
            subTotal,
            discountType: du.discountType || null,
            discountValue: Number(du.discountValue) || 0,
            totalDiscount: updTotalDiscount,
            taxTotal,
            grandTotal,
            // An edit leaves the export details and the currency alone: the rate a document
            // posted at is part of its history, not something a later edit restates.
            status: "CONFIRMED",
            payments: [] as any,
            items: { create: invoiceItems },
          },
          include: {
            customer: { select: { id: true, firmName: true, displayName: true, email: true } },
            items: {
              include: {
                product: { select: { id: true, productCode: true, productName: true } },
              },
            },
          },
        });

        // Apply accounting/stock
        {
          const newUnpaidPortion = Math.max(0, Math.round(grandTotal * 100) / 100);
          await tx.customer.update({
            where: { id: data.customerId },
            data: { outstandingAmount: { increment: newUnpaidPortion } },
          });

          // 9. Apply new invoicedQty on SalesOrderItems
          if (data.salesOrderId) {
            for (const item of data.items) {
              const qty = Number(item.qty);
              if (qty <= 0) continue;
              await tx.salesOrderItem.updateMany({
                where: { salesOrderId: data.salesOrderId, productId: BigInt(item.productId) },
                data: { invoicedQty: { increment: qty } },
              });
            }
          }

          // 10. Apply new stock adjustments
          const adjustmentPrefix = `ADJ-${new Date().getFullYear()}-`;
          const lastAdjNew = await tx.stockAdjustment.findFirst({
            where: { adjustmentNumber: { startsWith: adjustmentPrefix } },
            orderBy: { adjustmentNumber: "desc" },
            select: { adjustmentNumber: true },
          });
          let seq = 1;
          if (lastAdjNew?.adjustmentNumber) {
            const parts = lastAdjNew.adjustmentNumber.split("-");
            seq = (parseInt(parts[parts.length - 1]) || 0) + 1;
          }
          const newAdjustmentNumber = `${adjustmentPrefix}${String(seq).padStart(4, "0")}`;

          let stockAdjustmentCreated = false;
          let stockAdjustmentId = BigInt(0);

          for (const item of data.items) {
            const qty = Number(item.qty);
            if (qty <= 0) continue;

            const fgStocks = await tx.finishedGoodsStock.findMany({
              where: { productItemId: BigInt(item.productId) },
              orderBy: { onHandQty: "desc" },
            });
            if (fgStocks.length === 0) continue;

            const targetStoreId = fgStocks[0].storeId;
            const fgStock = fgStocks[0];

            if (!stockAdjustmentCreated) {
              const newAdj = await tx.stockAdjustment.create({
                data: {
                  adjustmentNumber: newAdjustmentNumber,
                  adjustmentDate: new Date(data.invoiceDate),
                  adjustmentType: "SALES_INVOICE_DISPATCH",
                  reason: `Sales Invoice ${updatedInvoice.invoiceNo} (Updated)`,
                  status: "APPROVED",
                  createdBy: currentUser.userId,
                  updatedBy: currentUser.userId,
                  approvedBy: currentUser.userId,
                  approvedAt: new Date(),
                  autoGenerated: true,
                  sourceDocument: "SALES_INVOICE",
                  sourceDocId: updatedInvoice.id,
                },
              });
              stockAdjustmentId = newAdj.id;
              stockAdjustmentCreated = true;
            }

            await tx.finishedGoodsStock.update({
              where: {
                storeId_productItemId: {
                  storeId: targetStoreId,
                  productItemId: BigInt(item.productId),
                },
              },
              data: { onHandQty: { decrement: qty } },
            });

            await tx.stockAdjustmentItem.create({
              data: {
                stockAdjustmentId,
                itemType: "FINISHED_GOODS",
                productItemId: BigInt(item.productId),
                storeId: targetStoreId,
                currentQty: fgStock.onHandQty,
                adjustedQty: fgStock.onHandQty.minus(qty),
                difference: -qty,
              },
            });
          }
        }

        return serializeInvoice(updatedInvoice);
      },
      { maxWait: 10000, timeout: 30000 }
    );
  }
}

export const salesInvoiceService = new SalesInvoiceService();
export default salesInvoiceService;
