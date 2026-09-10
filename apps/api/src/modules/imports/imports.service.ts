/**
 * CSV imports with dry run (P1-00 part 3). `analyse()` parses and validates a
 * file and resolves references (stores, categories, ledgers, existing codes)
 * without writing; `commit()` creates the valid rows through the same services
 * the screens use, so ledgers, opening vouchers and stock movements follow.
 * Commits are all-or-nothing on validation (any error row blocks the import)
 * and sequential on execution: an unexpected failure stops at that row and the
 * report says how many rows went in.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { voucherPostingService } from "../accounts/voucherPosting.service";
import customerService from "../customer/customer.service";
import productService from "../product/product.service";
import rawMaterialService from "../raw-material/raw-material.service";
import supplierService from "../supplier/supplier.service";
import { gstService } from "../gst/gst.service";
import { notify } from "../notifications/notify";
import { normaliseHeader, parseCsv, toCsv } from "./imports.csv";
import { byCode } from "../../lib/prisma";
import {
  IMPORT_TYPE_DEFS,
  MAX_ROWS,
  ROW_SCHEMAS,
  importTypeDef,
  stateNameToCode,
  type CustomerRow,
  type HsnRow,
  type ImportType,
  type ImportTypeDef,
  type OpeningBalanceRow,
  type OpeningStockRow,
  type ProductRow,
  type RawMaterialRow,
  type SupplierRow,
} from "./imports.types";

export type RowStatus = "ok" | "exists" | "error";

export interface RowResult {
  /** 1-based data row number (the header is row 0). */
  row: number;
  code: string | null;
  status: RowStatus;
  messages: string[];
}

export interface ImportReport {
  type: ImportType;
  dryRun: boolean;
  total: number;
  ok: number;
  exists: number;
  errors: number;
  imported: number;
  ignoredColumns: string[];
  rows: RowResult[];
  /** Set when a commit stopped early on an unexpected failure. */
  failed: { row: number; message: string } | null;
}

interface Prepared<T> {
  result: RowResult;
  data: T;
  /** Resolved references the commit needs (ids, dates). */
  refs: Record<string, unknown>;
}

export interface Analysis<T = unknown> {
  def: ImportTypeDef;
  report: ImportReport;
  prepared: Prepared<T>[];
}

const dup = <T>(items: T[], key: (t: T) => string) => {
  const seen = new Map<string, number>();
  const dupes = new Set<string>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if ((seen.get(k) ?? 0) > 1) dupes.add(k);
  }
  return dupes;
};

const DEFAULT_GROUP: Record<string, string> = {
  ASSET: "Current Assets",
  LIABILITY: "Current Liabilities",
  EXPENSE: "Indirect Expenses",
  INCOME: "Indirect Income",
  EQUITY: "Equity",
};

class ImportsService {
  types() {
    return IMPORT_TYPE_DEFS;
  }

  template(type: string): string {
    const def = importTypeDef(type);
    if (!def) throw new ApiError(404, `Unknown import type ${type}`);
    return toCsv([def.columns.map((c) => c.key), def.columns.map((c) => c.example)]);
  }

  /** The day books begin (onboarding), else the financial-year start, else today. */
  private async openingDate(): Promise<Date> {
    const companyId = requireTenantId();
    const setting = await prisma.systemSetting.findUnique({
      where: { companyId_key: { companyId, key: "BOOKS_BEGIN_ON" } },
    });
    if (setting?.value) return new Date(`${setting.value}T00:00:00.000Z`);
    const inv = await prisma.invoiceSetting.findUnique({ where: { companyId } });
    return inv?.financialYearStart ?? new Date();
  }

  // ─── Parse + validate ───────────────────────────────────────────────────────

  async analyse(type: string, csv: string): Promise<Analysis> {
    const def = importTypeDef(type);
    if (!def) throw new ApiError(404, `Unknown import type ${type}`);

    const parsed = parseCsv(csv);
    if (parsed.headers.length === 0) throw new ApiError(400, "The file is empty");
    if (parsed.rows.length === 0) throw new ApiError(400, "The file has a header but no rows");
    if (parsed.rows.length > MAX_ROWS) {
      throw new ApiError(400, `Too many rows (${parsed.rows.length}); the limit is ${MAX_ROWS}`);
    }

    // Header → column key, tolerant of spacing, case and punctuation.
    const byNorm = new Map<string, string>();
    for (const c of def.columns) {
      byNorm.set(normaliseHeader(c.key), c.key);
      byNorm.set(normaliseHeader(c.label), c.key);
    }
    const mapping: (string | null)[] = parsed.headers.map(
      (h) => byNorm.get(normaliseHeader(h)) ?? null
    );
    const ignoredColumns = parsed.headers.filter(
      (_, i) => mapping[i] === null && parsed.headers[i] !== ""
    );
    const present = new Set(mapping.filter((m): m is string => m !== null));
    const missing = def.columns.filter((c) => c.required && !present.has(c.key)).map((c) => c.key);
    if (missing.length) {
      throw new ApiError(400, `Missing required column(s): ${missing.join(", ")}`);
    }

    const schema = ROW_SCHEMAS[def.key];
    const results: RowResult[] = [];
    const valid: { index: number; data: Record<string, unknown> }[] = [];
    parsed.rows.forEach((cells, idx) => {
      const record: Record<string, string> = {};
      mapping.forEach((key, i) => {
        if (key) record[key] = cells[i] ?? "";
      });
      const r = schema.safeParse(record);
      const codeKey = def.columns[0].key;
      const code = (record[codeKey] ?? "").trim() || null;
      if (!r.success) {
        results.push({
          row: idx + 1,
          code,
          status: "error",
          messages: r.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
        });
      } else {
        results.push({ row: idx + 1, code, status: "ok", messages: [] });
        valid.push({ index: idx, data: r.data as Record<string, unknown> });
      }
    });

    const prepared = await this.resolve(def.key, valid, results);

    const report: ImportReport = {
      type: def.key,
      dryRun: true,
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      exists: results.filter((r) => r.status === "exists").length,
      errors: results.filter((r) => r.status === "error").length,
      imported: 0,
      ignoredColumns,
      rows: results,
      failed: null,
    };
    return { def, report, prepared };
  }

  /** Type-specific checks against the database; marks rows `exists` or `error` and collects refs. */
  private async resolve(
    type: ImportType,
    valid: { index: number; data: Record<string, unknown> }[],
    results: RowResult[]
  ): Promise<Prepared<unknown>[]> {
    const fail = (index: number, message: string) => {
      const r = results[index];
      r.status = "error";
      r.messages.push(message);
    };
    const exists = (index: number, message: string) => {
      const r = results[index];
      if (r.status === "ok") {
        r.status = "exists";
        r.messages.push(message);
      }
    };
    const prepared: Prepared<unknown>[] = [];

    switch (type) {
      case "customers": {
        const rows = valid as { index: number; data: CustomerRow }[];
        const codes = rows.map((r) => r.data.customerCode);
        const dupes = dup(codes, (c) => c);
        const existing = new Set(
          (
            await prisma.customer.findMany({
              where: { customerCode: { in: codes } },
              select: { customerCode: true },
            })
          ).map((c) => c.customerCode)
        );
        for (const r of rows) {
          if (dupes.has(r.data.customerCode)) fail(r.index, "customerCode: repeated in the file");
          else if (existing.has(r.data.customerCode))
            exists(r.index, "A customer with this code already exists");
          if (results[r.index].status === "ok")
            prepared.push({ result: results[r.index], data: r.data, refs: {} });
        }
        break;
      }
      case "suppliers": {
        const rows = valid as { index: number; data: SupplierRow }[];
        const codes = rows.map((r) => r.data.supplierCode);
        const dupes = dup(codes, (c) => c);
        const existing = new Set(
          (
            await prisma.supplier.findMany({
              where: { supplierCode: { in: codes } },
              select: { supplierCode: true },
            })
          ).map((s) => s.supplierCode)
        );
        for (const r of rows) {
          if (dupes.has(r.data.supplierCode)) fail(r.index, "supplierCode: repeated in the file");
          else if (existing.has(r.data.supplierCode))
            exists(r.index, "A supplier with this code already exists");
          const fromGstin = r.data.gstin?.slice(0, 2);
          const stateCode = r.data.stateCode ?? fromGstin ?? stateNameToCode(r.data.billingState);
          if (!stateCode)
            fail(
              r.index,
              "stateCode: give a two-digit GST state code, a GSTIN or a recognised state name"
            );
          else if (fromGstin && fromGstin !== stateCode)
            fail(r.index, "gstin: state code does not match stateCode");
          if (results[r.index].status === "ok") {
            prepared.push({ result: results[r.index], data: r.data, refs: { stateCode } });
          }
        }
        break;
      }
      case "products": {
        const rows = valid as { index: number; data: ProductRow }[];
        const codes = rows.map((r) => r.data.productCode);
        const dupes = dup(codes, (c) => c);
        const [existing, categories, stores] = await Promise.all([
          prisma.product.findMany({
            where: { productCode: { in: codes } },
            select: { productCode: true },
          }),
          prisma.category.findMany({
            where: { type: "PRODUCT" },
            select: { id: true, code: true },
          }),
          prisma.store.findMany({ select: { storeId: true } }),
        ]);
        const existingSet = new Set(existing.map((p) => p.productCode));
        const catByCode = new Map(categories.map((c) => [c.code.toUpperCase(), c.id]));
        const storeIds = new Set(stores.map((s) => s.storeId));
        for (const r of rows) {
          if (dupes.has(r.data.productCode)) fail(r.index, "productCode: repeated in the file");
          else if (existingSet.has(r.data.productCode))
            exists(r.index, "A product with this code already exists");
          const categoryId = r.data.category ? catByCode.get(r.data.category.toUpperCase()) : null;
          if (r.data.category && categoryId === undefined)
            fail(r.index, `category: no product category with code ${r.data.category}`);
          if ((r.data.openingStockQty ?? 0) > 0) {
            if (!r.data.openingStockStore)
              fail(r.index, "openingStockStore: required when an opening stock quantity is given");
            else if (!storeIds.has(r.data.openingStockStore))
              fail(r.index, `openingStockStore: no store ${r.data.openingStockStore}`);
          }
          if (results[r.index].status === "ok") {
            prepared.push({
              result: results[r.index],
              data: r.data,
              refs: { categoryId: categoryId ?? null },
            });
          }
        }
        break;
      }
      case "raw-materials": {
        const rows = valid as { index: number; data: RawMaterialRow }[];
        const ids = rows.map((r) => r.data.rawMaterialId);
        const dupes = dup(ids, (c) => c);
        const [existing, categories, stores] = await Promise.all([
          prisma.rawMaterial.findMany({
            where: { rawMaterialId: { in: ids } },
            select: { rawMaterialId: true },
          }),
          prisma.category.findMany({
            where: { type: "RAW_MATERIAL" },
            select: { id: true, code: true },
          }),
          prisma.store.findMany({ select: { storeId: true } }),
        ]);
        const existingSet = new Set(existing.map((m) => m.rawMaterialId));
        const catByCode = new Map(categories.map((c) => [c.code.toUpperCase(), c.id]));
        const storeIds = new Set(stores.map((s) => s.storeId));
        for (const r of rows) {
          if (dupes.has(r.data.rawMaterialId)) fail(r.index, "rawMaterialId: repeated in the file");
          else if (existingSet.has(r.data.rawMaterialId))
            exists(r.index, "A raw material with this id already exists");
          const categoryId = r.data.category ? catByCode.get(r.data.category.toUpperCase()) : null;
          if (r.data.category && categoryId === undefined)
            fail(r.index, `category: no raw-material category with code ${r.data.category}`);
          if (!storeIds.has(r.data.store)) fail(r.index, `store: no store ${r.data.store}`);
          if (results[r.index].status === "ok") {
            prepared.push({
              result: results[r.index],
              data: r.data,
              refs: { categoryId: categoryId ?? null },
            });
          }
        }
        break;
      }
      case "opening-balances": {
        const rows = valid as { index: number; data: OpeningBalanceRow }[];
        const codes = rows.map((r) => r.data.ledgerCode.toUpperCase());
        const dupes = dup(codes, (c) => c);
        const ledgers = await prisma.accountLedger.findMany({
          where: { code: { in: codes } },
          select: { id: true, code: true, customerId: true, supplierId: true },
        });
        const byCode = new Map(ledgers.map((l) => [l.code.toUpperCase(), l]));
        const posted = new Set(
          (
            await prisma.voucher.findMany({
              where: {
                refDocType: "LEDGER_OPENING_BALANCE",
                refDocId: { in: ledgers.map((l) => String(l.id)) },
              },
              select: { refDocId: true },
            })
          ).map((v) => v.refDocId)
        );
        for (const r of rows) {
          const code = r.data.ledgerCode.toUpperCase();
          const ledger = byCode.get(code);
          if (dupes.has(code)) fail(r.index, "ledgerCode: repeated in the file");
          if (ledger?.customerId || ledger?.supplierId) {
            fail(
              r.index,
              "ledgerCode: customer and supplier balances come with the customer/supplier imports"
            );
          } else if (!ledger && (!r.data.ledgerName || !r.data.ledgerType)) {
            fail(
              r.index,
              `ledgerCode: ${code} does not exist; give ledgerName and ledgerType to create it`
            );
          } else if (ledger && posted.has(String(ledger.id))) {
            exists(r.index, "This ledger already has an opening entry");
          }
          if (results[r.index].status === "ok") {
            prepared.push({
              result: results[r.index],
              data: r.data,
              refs: { ledgerId: ledger?.id ?? null },
            });
          }
        }
        break;
      }
      case "hsn": {
        const rows = valid as { index: number; data: HsnRow }[];
        const codes = rows.map((r) => r.data.code);
        const dupes = dup(codes, (c) => c);
        const existing = new Set(
          (
            await prisma.hsnCode.findMany({
              where: { code: { in: codes } },
              select: { code: true },
            })
          ).map((h) => h.code)
        );
        for (const r of rows) {
          if (dupes.has(r.data.code)) fail(r.index, "code: repeated in the file");
          else if (existing.has(r.data.code)) exists(r.index, "This HSN/SAC already exists");
          if (results[r.index].status === "ok") {
            prepared.push({ result: results[r.index], data: r.data, refs: {} });
          }
        }
        break;
      }
      case "opening-stock": {
        const rows = valid as { index: number; data: OpeningStockRow }[];
        const key = (d: OpeningStockRow) => `${d.itemType}|${d.itemCode}|${d.store}`;
        const dupes = dup(
          rows.map((r) => r.data),
          key
        );
        const productCodes = rows
          .filter((r) => r.data.itemType === "PRODUCT")
          .map((r) => r.data.itemCode);
        const rmIds = rows
          .filter((r) => r.data.itemType === "RAW_MATERIAL")
          .map((r) => r.data.itemCode);
        const [products, materials, stores] = await Promise.all([
          productCodes.length
            ? prisma.product.findMany({
                where: { productCode: { in: productCodes } },
                select: { id: true, productCode: true },
              })
            : [],
          rmIds.length
            ? prisma.rawMaterial.findMany({
                where: { rawMaterialId: { in: rmIds } },
                select: { rawMaterialId: true, storeId: true },
              })
            : [],
          prisma.store.findMany({ select: { storeId: true } }),
        ]);
        const productByCode = new Map(products.map((p) => [p.productCode, p.id]));
        const rmById = new Map(materials.map((m) => [m.rawMaterialId, m]));
        const storeIds = new Set(stores.map((s) => s.storeId));
        const [fgOpen, rmOpen] = await Promise.all([
          products.length
            ? prisma.finishedGoodsTransaction.findMany({
                where: {
                  txnType: "OPENING_STOCK",
                  productItemId: { in: products.map((p) => p.id) },
                },
                select: { productItemId: true, storeId: true },
              })
            : [],
          materials.length
            ? prisma.rawMaterialTransaction.findMany({
                where: { txnType: "OPENING_STOCK", rawMaterialId: { in: rmIds } },
                select: { rawMaterialId: true, storeId: true },
              })
            : [],
        ]);
        const fgOpenSet = new Set(fgOpen.map((t) => `${t.productItemId}|${t.storeId}`));
        const rmOpenSet = new Set(rmOpen.map((t) => `${t.rawMaterialId}|${t.storeId}`));
        for (const r of rows) {
          const d = r.data;
          if (dupes.has(key(d))) fail(r.index, "itemCode: repeated for the same store in the file");
          if (!storeIds.has(d.store)) fail(r.index, `store: no store ${d.store}`);
          let productId: bigint | null = null;
          if (d.itemType === "PRODUCT") {
            const id = productByCode.get(d.itemCode);
            if (id === undefined) fail(r.index, `itemCode: no product ${d.itemCode}`);
            else {
              productId = id;
              if (fgOpenSet.has(`${id}|${d.store}`))
                exists(r.index, "Opening stock for this product and store was already recorded");
            }
          } else {
            if (!rmById.has(d.itemCode)) fail(r.index, `itemCode: no raw material ${d.itemCode}`);
            else if (rmOpenSet.has(`${d.itemCode}|${d.store}`))
              exists(r.index, "Opening stock for this material and store was already recorded");
          }
          if (results[r.index].status === "ok") {
            prepared.push({ result: results[r.index], data: d, refs: { productId } });
          }
        }
        break;
      }
    }
    return prepared;
  }

  // ─── Commit ─────────────────────────────────────────────────────────────────

  async commit(analysis: Analysis, userId: string): Promise<ImportReport> {
    const { def, report, prepared } = analysis;
    if (report.errors > 0)
      throw new ApiError(400, "Fix the rows marked as errors before importing");
    const companyId = requireTenantId();
    const date = await this.openingDate();
    report.dryRun = false;

    const caches = {
      customerTypes: new Map<string, number>(),
      customerGrades: new Map<string, number>(),
    };

    for (const p of prepared) {
      try {
        switch (def.key) {
          case "customers":
            await this.commitCustomer(p.data as CustomerRow, { userId, companyId }, caches);
            break;
          case "suppliers":
            await this.commitSupplier(p.data as SupplierRow, p.refs.stateCode as string, {
              userId,
              companyId,
            });
            break;
          case "products":
            await this.commitProduct(p.data as ProductRow, p.refs.categoryId as number | null);
            break;
          case "raw-materials":
            await this.commitRawMaterial(
              p.data as RawMaterialRow,
              p.refs.categoryId as number | null,
              userId,
              date
            );
            break;
          case "opening-balances":
            await this.commitOpeningBalance(
              p.data as OpeningBalanceRow,
              p.refs.ledgerId as number | null,
              date
            );
            break;
          case "opening-stock":
            await this.commitOpeningStock(
              p.data as OpeningStockRow,
              p.refs.productId as bigint | null,
              userId,
              date
            );
            break;
          case "hsn": {
            const d = p.data as HsnRow;
            await gstService.createHsn({
              code: d.code,
              type: d.type,
              description: d.description,
              gstRate: d.gstRate,
              cessRate: d.cessRate,
            });
            break;
          }
        }
        report.imported++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, type: def.key, row: p.result.row }, "import row failed");
        p.result.status = "error";
        p.result.messages.push(message);
        report.failed = { row: p.result.row, message };
        report.ok = report.imported;
        report.errors = 1;
        break;
      }
    }
    await notify({
      category: "imports",
      level: report.failed ? "WARNING" : "SUCCESS",
      title: `Imported ${report.imported} ${def.label.toLowerCase()}`,
      body: report.failed
        ? `Stopped at row ${report.failed.row}: ${report.failed.message.slice(0, 200)}`
        : `${report.imported} row(s) created${report.exists ? `, ${report.exists} already existed` : ""}.`,
      link: "/settings/imports",
      to: { userIds: [userId] },
      createdBy: userId,
    });
    return report;
  }

  private async commitCustomer(
    d: CustomerRow,
    actor: { userId: string; companyId: string },
    caches: { customerTypes: Map<string, number>; customerGrades: Map<string, number> }
  ) {
    const lookup = async (
      kind: "customerType" | "customerGrade",
      name: string | undefined,
      cache: Map<string, number>
    ) => {
      if (!name) return null;
      const key = name.trim().toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      const delegate = kind === "customerType" ? prisma.customerType : prisma.customerGrade;
      const found =
        (await (delegate as typeof prisma.customerType).findFirst({
          where: { name: { equals: name.trim(), mode: "insensitive" } },
        })) ??
        (await (delegate as typeof prisma.customerType).create({ data: { name: name.trim() } }));
      cache.set(key, found.id);
      return found.id;
    };
    const customerTypeId = await lookup("customerType", d.customerType, caches.customerTypes);
    const customerGradeId = await lookup("customerGrade", d.customerGrade, caches.customerGrades);
    await customerService.createCustomer(
      {
        customerCode: d.customerCode,
        firmName: d.firmName,
        displayName: d.displayName,
        customerTypeId,
        customerGradeId,
        mobile: d.mobile ?? null,
        email: d.email,
        gstin: d.gstin,
        creditLimit: d.creditLimit ?? 0,
        creditDays: d.creditDays ?? null,
        openingBalance: d.openingBalance ?? 0,
        openingBalanceType: d.openingBalanceType,
        status: d.status,
        addresses: d.addressLine1
          ? [
              {
                addressLine1: d.addressLine1,
                city: d.city ?? "",
                state: d.state ?? "",
                pincode: d.pincode ?? "",
              },
            ]
          : undefined,
      },
      actor
    );
  }

  private async commitSupplier(
    d: SupplierRow,
    stateCode: string,
    actor: { userId: string; companyId: string }
  ) {
    await supplierService.createSupplier({
      supplierCode: d.supplierCode,
      legalName: d.legalName,
      displayName: d.displayName ?? null,
      contactPerson: d.contactPerson ?? null,
      mobile: d.mobile ?? null,
      email: d.email ?? null,
      gstin: d.gstin ?? null,
      pan: d.pan ?? null,
      gstRegType: d.gstRegType ?? (d.gstin ? "REGULAR" : null),
      billingAddressLine1: d.billingAddressLine1,
      billingCity: d.billingCity,
      billingState: d.billingState,
      billingPincode: d.billingPincode,
      billingCountry: "India",
      stateCode,
      status: d.status,
      openingBalance: d.openingBalance ?? 0,
      openingBalanceType: d.openingBalanceType,
      ...actor,
    });
  }

  private async commitProduct(d: ProductRow, categoryId: number | null) {
    await productService.create({
      productCode: d.productCode,
      productName: d.productName,
      description: d.description,
      productType: d.productType,
      categoryId,
      rate: d.rate,
      weightPerPiece: d.weightPerPiece,
      weightUom: d.weightUom,
      minimumQty: d.minimumQty !== undefined ? String(d.minimumQty) : undefined,
      isActive: d.isActive ?? true,
      openingStockQty: d.openingStockQty ? String(d.openingStockQty) : undefined,
      openingStockStoreId: d.openingStockQty ? d.openingStockStore : undefined,
    });
  }

  private async commitRawMaterial(
    d: RawMaterialRow,
    categoryId: number | null,
    userId: string,
    date: Date
  ) {
    await rawMaterialService.create(
      {
        rawMaterialId: d.rawMaterialId,
        materialName: d.materialName,
        baseUom: d.baseUom,
        categoryId,
        storeId: d.store,
        rate: d.rate ?? null,
        reorderLevel: d.reorderLevel ?? null,
        minimumStock: d.minimumStock ?? null,
        onHandQty: d.onHandQty ?? 0,
        isActive: d.isActive ?? true,
      },
      userId
    );
    if ((d.onHandQty ?? 0) > 0) {
      await prisma.rawMaterialTransaction.create({
        data: {
          storeId: d.store,
          rawMaterialId: d.rawMaterialId,
          txnType: "OPENING_STOCK",
          qty: d.onHandQty!,
          txnDateTime: date,
          remarks: "Opening stock (import)",
        },
      });
    }
  }

  private async commitOpeningBalance(d: OpeningBalanceRow, ledgerId: number | null, date: Date) {
    const code = d.ledgerCode.toUpperCase();
    const ledger = ledgerId
      ? await prisma.accountLedger.findUniqueOrThrow({ where: { id: ledgerId } })
      : await accountsService.createLedger({
          code,
          name: d.ledgerName!,
          type: d.ledgerType!,
          group: d.ledgerGroup ?? DEFAULT_GROUP[d.ledgerType!],
          isActive: true,
          openingBalance: 0,
          openingBalanceType: "DEBIT",
        });
    const amount = (d.debit ?? 0) > 0 ? d.debit! : d.credit!;
    await voucherPostingService.postGenericLedgerOpeningBalanceVoucher(
      ledger,
      amount,
      (d.debit ?? 0) > 0 ? "DEBIT" : "CREDIT",
      undefined,
      { date }
    );
  }

  private async commitOpeningStock(
    d: OpeningStockRow,
    productId: bigint | null,
    userId: string,
    date: Date
  ) {
    const qty = new Prisma.Decimal(d.qty);
    if (d.itemType === "PRODUCT") {
      await prisma.$transaction(async (tx) => {
        await tx.finishedGoodsStock.upsert({
          where: { storeId_productItemId: { storeId: d.store, productItemId: productId! } },
          update: { onHandQty: { increment: qty } },
          create: { storeId: d.store, productItemId: productId!, onHandQty: qty },
        });
        await tx.finishedGoodsTransaction.create({
          data: {
            txnDateTime: date,
            storeId: d.store,
            productItemId: productId!,
            txnType: "OPENING_STOCK",
            qty,
            remarks: d.remarks ?? "Opening stock (import)",
            createdBy: userId,
          },
        });
      });
    } else {
      await prisma.$transaction(async (tx) => {
        const current = await tx.rawMaterial.findUniqueOrThrow({
          where: byCode("rawMaterialId", d.itemCode),
        });
        const data: Prisma.RawMaterialUpdateInput = {
          onHandQty: { increment: qty },
          lastMovementAt: date,
        };
        if (!current.storeId) data.store = { connect: byCode("storeId", d.store) };
        await tx.rawMaterial.update({ where: byCode("rawMaterialId", d.itemCode), data });
        await tx.rawMaterialTransaction.create({
          data: {
            storeId: d.store,
            rawMaterialId: d.itemCode,
            txnType: "OPENING_STOCK",
            qty,
            txnDateTime: date,
            remarks: d.remarks ?? "Opening stock (import)",
          },
        });
      });
    }
  }
}

export const importsService = new ImportsService();
