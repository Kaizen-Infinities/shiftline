import type { DepreciationMethod, Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { requireTenantId, runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { cancellationService } from "../accounts/cancellation.service";
import { periodService } from "../accounts/period.service";
import { toCsv } from "../imports/imports.csv";
import { assetPosting } from "./asset.posting";
import {
  OPENING_COLUMNS,
  type OpeningRowInput,
  type RowError,
  parseOpeningRow,
  usefulLifeMonthsFromWdvRate,
} from "./asset.opening";
import { itBlockDepreciation, monthRange, monthlyCharge } from "./depreciation.calc";

/**
 * The fixed-asset register and the monthly depreciation run (P1-18).
 *
 * A month is prepared and then posted, and a period can only be run once: `DepreciationRun` is
 * unique on the period, which is what makes a double charge impossible rather than unlikely. The
 * charge itself lives in `depreciation.calc.ts`, deliberately apart from the database, because
 * it is the part that has to be right.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (v: string | Date) =>
  new Date(typeof v === "string" ? `${v.slice(0, 10)}T00:00:00Z` : v);

/** The standard classes a manufacturer starts from; lives, methods and blocks are editable. */
export const DEFAULT_ASSET_CLASSES = [
  {
    code: "PM",
    name: "Plant and Machinery",
    usefulLifeYears: 15,
    method: "SLM" as DepreciationMethod,
    scheduleIiHead: "Plant and Machinery",
    itBlockName: "Plant and machinery (general)",
    itBlockRate: 15,
  },
  {
    code: "BLDG",
    name: "Factory Building",
    usefulLifeYears: 30,
    method: "SLM" as DepreciationMethod,
    scheduleIiHead: "Buildings",
    itBlockName: "Building (factory)",
    itBlockRate: 10,
  },
  {
    code: "FF",
    name: "Furniture and Fittings",
    usefulLifeYears: 10,
    method: "SLM" as DepreciationMethod,
    scheduleIiHead: "Furniture and Fixtures",
    itBlockName: "Furniture and fittings",
    itBlockRate: 10,
  },
  {
    code: "COMP",
    name: "Computers and Data Processing Units",
    usefulLifeYears: 3,
    method: "WDV" as DepreciationMethod,
    scheduleIiHead: "Computers",
    itBlockName: "Computers including software",
    itBlockRate: 40,
  },
  {
    code: "VEH",
    name: "Vehicles",
    usefulLifeYears: 8,
    method: "WDV" as DepreciationMethod,
    scheduleIiHead: "Vehicles",
    itBlockName: "Motor vehicles",
    itBlockRate: 15,
  },
  {
    code: "ELEC",
    name: "Electrical Installations",
    usefulLifeYears: 10,
    method: "SLM" as DepreciationMethod,
    scheduleIiHead: "Plant and Machinery",
    itBlockName: "Plant and machinery (general)",
    itBlockRate: 15,
  },
] as const;

class AssetService {
  /** The tenant's classes, seeded from the standard list the first time they are asked for. */
  async classes(includeInactive = false) {
    const existing = await prisma.assetClass.findMany({ orderBy: { code: "asc" } });
    if (existing.length === 0) {
      await accountsService.ensureSystemLedgersExist(prisma as never);
      await prisma.assetClass.createMany({
        data: DEFAULT_ASSET_CLASSES.map((c) => ({
          companyId: requireTenantId(),
          code: c.code,
          name: c.name,
          usefulLifeYears: c.usefulLifeYears,
          method: c.method,
          residualPercent: 5,
          scheduleIiHead: c.scheduleIiHead,
          itBlockName: c.itBlockName,
          itBlockRate: c.itBlockRate,
          assetLedgerCode: "FA-001",
          accumDepLedgerCode: "FA-ACC-001",
          depExpenseLedgerCode: "DEP-001",
        })),
        skipDuplicates: true,
      });
      return prisma.assetClass.findMany({ orderBy: { code: "asc" } });
    }
    return includeInactive ? existing : existing.filter((c) => c.isActive);
  }

  async upsertClass(input: {
    id?: string;
    code: string;
    name: string;
    usefulLifeYears: number;
    method?: DepreciationMethod;
    residualPercent?: number;
    scheduleIiHead?: string | null;
    itBlockName?: string | null;
    itBlockRate?: number;
    assetLedgerCode?: string;
    accumDepLedgerCode?: string;
    depExpenseLedgerCode?: string;
    isActive?: boolean;
  }) {
    const code = input.code.trim().toUpperCase();
    const data = {
      name: input.name.trim().slice(0, 120),
      usefulLifeYears: input.usefulLifeYears,
      method: input.method ?? ("SLM" as DepreciationMethod),
      residualPercent: input.residualPercent ?? 5,
      scheduleIiHead: input.scheduleIiHead ?? null,
      itBlockName: input.itBlockName ?? null,
      itBlockRate: input.itBlockRate ?? 15,
      assetLedgerCode: input.assetLedgerCode ?? "FA-001",
      accumDepLedgerCode: input.accumDepLedgerCode ?? "FA-ACC-001",
      depExpenseLedgerCode: input.depExpenseLedgerCode ?? "DEP-001",
      isActive: input.isActive ?? true,
    };
    return prisma.assetClass.upsert({
      where: { companyId_code: { companyId: requireTenantId(), code } },
      create: { code, ...data },
      update: data,
    });
  }

  async list(params: { status?: string; classId?: string; businessPlaceId?: string } = {}) {
    const rows = await prisma.fixedAsset.findMany({
      where: {
        ...(params.status ? { status: params.status as "ACTIVE" } : {}),
        ...(params.classId ? { classId: params.classId } : {}),
        ...(params.businessPlaceId ? { businessPlaceId: BigInt(params.businessPlaceId) } : {}),
      },
      include: { assetClass: { select: { code: true, name: true, scheduleIiHead: true } } },
      orderBy: { code: "asc" },
      take: 1000,
    });
    return rows.map((a) => ({
      ...a,
      businessPlaceId: a.businessPlaceId === null ? null : String(a.businessPlaceId),
      wdv: n2(Number(a.cost) - Number(a.accumulatedDepreciation)),
    }));
  }

  async get(id: string) {
    const row = await prisma.fixedAsset.findUnique({
      where: { id },
      include: {
        assetClass: true,
        events: { orderBy: { effectiveOn: "asc" } },
        depreciations: { orderBy: { periodKey: "asc" } },
      },
    });
    if (!row) throw new ApiError(404, "That asset does not exist");
    return {
      ...row,
      businessPlaceId: row.businessPlaceId === null ? null : String(row.businessPlaceId),
      wdv: n2(Number(row.cost) - Number(row.accumulatedDepreciation)),
    };
  }

  /**
   * Puts an asset on the register.
   *
   * The residual and the life are copied off the class here and then left alone: a class edited
   * two years later must not silently re-depreciate everything bought under the old one.
   */
  async create(
    input: {
      code: string;
      name: string;
      classCode: string;
      cost: number;
      acquiredOn: string | Date;
      capitalisedOn?: string | Date;
      businessPlaceId?: string | null;
      quantity?: number;
      serialNo?: string | null;
      location?: string | null;
      supplierId?: number | null;
      sourceDocType?: string | null;
      sourceDocId?: string | null;
      residualValue?: number | null;
      notes?: string | null;
    },
    actor: { userId?: string }
  ) {
    const classes = await this.classes(true);
    const cls = classes.find((c) => c.code === input.classCode.trim().toUpperCase());
    if (!cls) throw new ApiError(400, "That asset class does not exist");
    if (input.cost <= 0) throw new ApiError(400, "An asset has to have a cost");
    const capitalisedOn = asDate(input.capitalisedOn ?? input.acquiredOn);
    const acquiredOn = asDate(input.acquiredOn);
    if (capitalisedOn < acquiredOn) {
      throw new ApiError(400, "An asset cannot be put to use before it was bought");
    }
    const residual = input.residualValue ?? n2((input.cost * Number(cls.residualPercent)) / 100);

    return prisma.fixedAsset.create({
      data: {
        code: input.code.trim().toUpperCase().slice(0, 30),
        name: input.name.trim().slice(0, 160),
        classId: cls.id,
        businessPlaceId: input.businessPlaceId ? BigInt(input.businessPlaceId) : null,
        acquiredOn,
        capitalisedOn,
        cost: input.cost,
        residualValue: residual,
        method: cls.method,
        usefulLifeMonths: cls.usefulLifeYears * 12,
        quantity: input.quantity ?? 1,
        serialNo: input.serialNo ?? null,
        location: input.location ?? null,
        supplierId: input.supplierId ?? null,
        sourceDocType: input.sourceDocType ?? null,
        sourceDocId: input.sourceDocId ?? null,
        notes: input.notes ?? null,
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /**
   * Validates one opening-balance row against the tenant's classes and codes already claimed —
   * everything that needs the database, as opposed to `parseOpeningRow`'s pure shape check.
   */
  private async checkOpeningRow(
    row: OpeningRowInput,
    rowNo: number,
    classesByCode: Map<string, Awaited<ReturnType<AssetService["classes"]>>[number]>
  ): Promise<{ error?: RowError; cls?: Awaited<ReturnType<AssetService["classes"]>>[number] }> {
    const cls = classesByCode.get(row.classCode);
    if (!cls || !cls.isActive) {
      return {
        error: { row: rowNo, message: `Unknown or inactive asset class "${row.classCode}"` },
      };
    }
    const existing = await prisma.fixedAsset.findFirst({ where: { code: row.code } });
    if (existing) {
      return {
        error: { row: rowNo, message: `Asset code "${row.code}" is already on the register` },
      };
    }
    if (
      row.itBlockName &&
      cls.itBlockName &&
      row.itBlockName.trim().toLowerCase() !== cls.itBlockName.trim().toLowerCase()
    ) {
      return {
        error: {
          row: rowNo,
          message: `Income-tax block "${row.itBlockName}" does not match ${cls.code}'s block (${cls.itBlockName})`,
        },
      };
    }
    if (row.businessPlaceCode) {
      const place = await prisma.businessPlace.findFirst({
        where: { code: row.businessPlaceCode },
      });
      if (!place) {
        return {
          error: { row: rowNo, message: `Unknown business place "${row.businessPlaceCode}"` },
        };
      }
    }
    return { cls };
  }

  /**
   * Turns one validated row into the fields a `FixedAsset` needs, deriving the useful life the
   * engine in `depreciation.calc.ts` wants from what the row actually gives:
   *
   *  - SLM gives a remaining life. The engine charges `(cost − residual) / usefulLifeMonths` every
   *    month regardless of what has already been charged, so the life stored here is scaled up so
   *    that dividing by it reproduces exactly `(cost − residual − accumulated) / remainingMonths` —
   *    the asset finishes depreciating in exactly the remaining life it was given.
   *  - WDV gives a rate directly (the annual rate applies to the opening WDV every period, so the
   *    life already charged does not matter); `usefulLifeMonthsFromWdvRate` runs Schedule II's
   *    rate formula backwards to the life that implies it.
   */
  private openingLifeMonths(
    row: OpeningRowInput,
    method: DepreciationMethod,
    cost: number,
    residual: number,
    accumulated: number
  ): number {
    const depreciable = n2(cost - residual);
    if (method === "WDV") {
      return usefulLifeMonthsFromWdvRate(row.wdvRatePercent as number, cost, residual);
    }
    const remaining = Math.max(depreciable - accumulated, 0);
    if (remaining <= 0 || depreciable <= 0) return row.remainingLifeMonths as number;
    return Math.max(1, Math.round(((row.remainingLifeMonths as number) * depreciable) / remaining));
  }

  /**
   * One asset via the opening-balance import (P2-07): built from a validated row inside the
   * caller's transaction, never posting its own journal — `importOpening` posts one journal per
   * class once every row is in.
   */
  private async buildOpeningAsset(
    tx: Prisma.TransactionClient,
    row: OpeningRowInput,
    cls: Awaited<ReturnType<AssetService["classes"]>>[number],
    businessPlaceId: bigint | null,
    actor: { userId?: string }
  ) {
    const method = row.method ?? cls.method;
    const residual = row.residualValue ?? n2((row.cost * Number(cls.residualPercent)) / 100);
    const usefulLifeMonths = this.openingLifeMonths(
      row,
      method,
      row.cost,
      residual,
      row.accumulatedDepreciation
    );
    return tx.fixedAsset.create({
      data: {
        code: row.code,
        name: row.name.slice(0, 160),
        classId: cls.id,
        businessPlaceId,
        acquiredOn: asDate(row.capitalisedOn),
        capitalisedOn: asDate(row.capitalisedOn),
        cost: row.cost,
        residualValue: residual,
        method,
        usefulLifeMonths,
        accumulatedDepreciation: row.accumulatedDepreciation,
        quantity: row.quantity ?? 1,
        serialNo: row.serialNo ?? null,
        location: row.location ?? null,
        openingBalance: true,
        openingItWdv: n2(row.cost - row.accumulatedDepreciation),
        createdBy: actor.userId?.slice(0, 36) ?? null,
      },
    });
  }

  /**
   * Validates every row before writing anything (P2-07): a bad row anywhere in the sheet must
   * leave the register untouched, so validation runs to completion first and the whole batch is
   * rejected together rather than partly imported.
   */
  private async validateOpeningRows(raws: Partial<Record<string, string>>[]) {
    const classes = await this.classes(true);
    const classesByCode = new Map(classes.map((c) => [c.code, c]));
    const errors: RowError[] = [];
    const values: { row: OpeningRowInput; cls: (typeof classes)[number] }[] = [];

    const parsedRows: (OpeningRowInput | null)[] = [];
    const codeCounts = new Map<string, number>();
    raws.forEach((raw, i) => {
      const { value, errors: rowErrors } = parseOpeningRow(raw, i + 1);
      parsedRows.push(value ?? null);
      errors.push(...rowErrors);
      if (value) codeCounts.set(value.code, (codeCounts.get(value.code) ?? 0) + 1);
    });

    // Business checks that touch the database run after the shape checks so a sheet full of typos
    // reports every problem at once instead of stopping at the first database round trip.
    for (let i = 0; i < raws.length; i++) {
      const rowNo = i + 1;
      const value = parsedRows[i];
      if (!value) continue;
      if ((codeCounts.get(value.code) ?? 0) > 1) {
        errors.push({
          row: rowNo,
          message: `Asset code "${value.code}" is repeated in this import`,
        });
        continue;
      }
      const { error, cls } = await this.checkOpeningRow(value, rowNo, classesByCode);
      if (error) errors.push(error);
      else values.push({ row: value, cls: cls! });
    }
    return { errors, values: errors.length === 0 ? values : [] };
  }

  /**
   * Opening balances (P2-07): a company migrating in mid-life brings in machines already
   * part-depreciated. Every row is validated before anything is written — one bad row leaves the
   * register untouched — and a journal is posted once per class, only for a class that has never
   * had an opening posted before.
   */
  async importOpening(raws: Partial<Record<string, string>>[], actor: { userId?: string }) {
    if (raws.length === 0) throw new ApiError(400, "Nothing to import");
    if (raws.length > 2000) throw new ApiError(400, "At most 2000 rows at a time");
    const { errors, values } = await this.validateOpeningRows(raws);
    if (errors.length > 0) {
      throw new ApiError(400, "Some rows could not be imported", "OPENING_IMPORT_INVALID", {
        errors,
      });
    }

    const places = await prisma.businessPlace.findMany({
      where: {
        code: { in: values.map((v) => v.row.businessPlaceCode).filter((c): c is string => !!c) },
      },
    });
    const placeByCode = new Map(places.map((p) => [p.code, p.id]));

    const created = await prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      const rows = [];
      for (const v of values) {
        const businessPlaceId = v.row.businessPlaceCode
          ? (placeByCode.get(v.row.businessPlaceCode) ?? null)
          : null;
        rows.push(await this.buildOpeningAsset(tx, v.row, v.cls, businessPlaceId, actor));
      }

      const byClass = new Map<
        string,
        { cls: (typeof values)[number]["cls"]; cost: number; accum: number }
      >();
      for (const v of values) {
        const cur = byClass.get(v.cls.id) ?? { cls: v.cls, cost: 0, accum: 0 };
        cur.cost = n2(cur.cost + v.row.cost);
        cur.accum = n2(cur.accum + v.row.accumulatedDepreciation);
        byClass.set(v.cls.id, cur);
      }
      const on = new Date();
      const vouchers = [];
      for (const g of byClass.values()) {
        vouchers.push(
          await assetPosting.openingBalanceForClass(
            tx,
            g.cls,
            { cost: g.cost, accumulatedDepreciation: g.accum },
            on,
            actor.userId
          )
        );
      }
      return { rows, vouchers: vouchers.filter(Boolean) };
    });

    return {
      imported: created.rows.length,
      vouchers: created.vouchers.length,
      assets: created.rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    };
  }

  /**
   * A downloadable template for the opening-balance import (P2-19): the same columns
   * `parseOpeningCsv` reads, with one example row, so the import dialog does not have to keep its
   * own in-memory copy of the shape.
   */
  openingTemplateCsv(): string {
    return toCsv([OPENING_COLUMNS.map((c) => c.key), OPENING_COLUMNS.map((c) => c.example)]);
  }

  /** The single-row opening-balance endpoint: the same path, one row. */
  async createOpening(raw: Partial<Record<string, string>>, actor: { userId?: string }) {
    const result = await this.importOpening([raw], actor);
    if (result.imported !== 1) throw new ApiError(500, "The asset could not be created");
    return result.assets[0];
  }

  /**
   * Capitalises a GRN line or an expense (P2-07): the cost moves off the purchase or expense
   * ledger and onto the asset ledger, and the same line can never be capitalised twice — a unique
   * index on the source enforces it even under a race, and this check gives the friendly refusal.
   */
  async capitalise(
    input: {
      sourceDocType: "GRN_INVOICE" | "EXPENSE";
      sourceDocId: string;
      lineId?: string;
      classId: string;
      code: string;
      name: string;
      capitalisedOn?: string;
      businessPlaceId?: string | null;
      quantity?: number;
      serialNo?: string | null;
      location?: string | null;
      cost?: number;
      notes?: string | null;
    },
    actor: { userId?: string }
  ) {
    const cls = await prisma.assetClass.findUnique({ where: { id: input.classId } });
    if (!cls || !cls.isActive) throw new ApiError(400, "That asset class does not exist");

    const already = await prisma.fixedAsset.findFirst({
      where: {
        sourceDocType: input.sourceDocType,
        sourceDocId: input.sourceDocId,
        sourceLineId: input.lineId ?? null,
      },
    });
    if (already) {
      throw new ApiError(409, "That line has already been capitalised", "ALREADY_CAPITALISED");
    }

    let cost: number;
    let capitalisedOn: Date;
    let businessPlaceId: bigint | null = input.businessPlaceId
      ? BigInt(input.businessPlaceId)
      : null;
    let supplierId: number | null = null;
    let sourceLedgerCode: string;
    let narrationSource: string;

    if (input.sourceDocType === "GRN_INVOICE") {
      if (!input.lineId) throw new ApiError(400, "A GRN line is required to capitalise from a GRN");
      const grn = await prisma.grnInvoice.findUnique({ where: { id: input.sourceDocId } });
      if (!grn) throw new ApiError(404, "That GRN invoice does not exist");
      const line = await prisma.grnInvoiceItem.findFirst({
        where: { id: input.lineId, grnInvoiceId: grn.id },
      });
      if (!line) throw new ApiError(404, "That GRN line does not exist");
      const posted = await prisma.voucher.findFirst({
        where: { refDocType: "GRN_INVOICE", refDocId: grn.id, status: "POSTED" },
      });
      if (!posted) {
        throw new ApiError(400, "That GRN has not been posted to the books yet");
      }
      cost = input.cost ?? Number(line.taxableAmount);
      capitalisedOn = asDate(input.capitalisedOn ?? grn.grnDate);
      businessPlaceId = businessPlaceId ?? grn.businessPlaceId;
      supplierId = grn.supplierId;
      sourceLedgerCode = "PURCH-001";
      narrationSource = `GRN ${grn.grnNumber || grn.invoiceNo}`;
    } else if (input.sourceDocType === "EXPENSE") {
      const expense = await prisma.expense.findUnique({ where: { id: input.sourceDocId } });
      if (!expense) throw new ApiError(404, "That expense does not exist");
      if (expense.status !== "Approved") {
        throw new ApiError(400, "That expense has not been approved and posted yet");
      }
      const expensePosted = await prisma.voucher.findFirst({
        where: { refDocType: "EXPENSE", refDocId: expense.id, status: "POSTED" },
      });
      if (!expensePosted) {
        throw new ApiError(400, "That expense has not been posted to the books yet");
      }
      const taxable =
        expense.taxableAmount !== null && expense.taxableAmount !== undefined
          ? Number(expense.taxableAmount)
          : Number(expense.amount) -
            (Number(expense.cgstAmount) + Number(expense.sgstAmount) + Number(expense.igstAmount));
      cost = input.cost ?? taxable;
      capitalisedOn = asDate(input.capitalisedOn ?? expense.date);
      businessPlaceId = businessPlaceId ?? expense.businessPlaceId;
      supplierId = expense.supplierId;
      sourceLedgerCode = "EXP-001";
      narrationSource = expense.expense;
    } else {
      throw new ApiError(400, "Unknown source document type");
    }

    if (!(cost > 0)) throw new ApiError(400, "Nothing to capitalise: the cost is zero");
    const residual = n2((cost * Number(cls.residualPercent)) / 100);

    try {
      return await prisma.$transaction(async (tx) => {
        await accountsService.ensureSystemLedgersExist(tx);
        const asset = await tx.fixedAsset.create({
          data: {
            code: input.code.trim().toUpperCase().slice(0, 30),
            name: input.name.trim().slice(0, 160),
            classId: cls.id,
            businessPlaceId,
            acquiredOn: capitalisedOn,
            capitalisedOn,
            cost,
            residualValue: residual,
            method: cls.method,
            usefulLifeMonths: cls.usefulLifeYears * 12,
            quantity: input.quantity ?? 1,
            serialNo: input.serialNo ?? null,
            location: input.location ?? null,
            supplierId,
            sourceDocType: input.sourceDocType,
            sourceDocId: input.sourceDocId,
            sourceLineId: input.lineId ?? null,
            notes: input.notes ?? `Capitalised from ${narrationSource}`,
            createdBy: actor.userId?.slice(0, 36) ?? null,
          },
        });
        const voucher = await assetPosting.capitalise(
          tx,
          {
            id: asset.id,
            code: asset.code,
            name: asset.name,
            assetLedgerCode: cls.assetLedgerCode,
          },
          cost,
          sourceLedgerCode,
          capitalisedOn,
          actor.userId
        );
        return {
          ...asset,
          businessPlaceId: asset.businessPlaceId === null ? null : String(asset.businessPlaceId),
          voucherId: voucher?.id ?? null,
        };
      });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        throw new ApiError(409, "That line has already been capitalised", "ALREADY_CAPITALISED");
      }
      throw err;
    }
  }

  /**
   * An addition, a revaluation or a transfer. An addition and a revaluation move the cost, which
   * changes every future month's charge but never a month already posted — depreciation already
   * charged is a fact, not a calculation to be redone.
   */
  async event(
    input: {
      assetId: string;
      kind: "ADDITION" | "REVALUATION" | "TRANSFER" | "IMPAIRMENT";
      effectiveOn: string | Date;
      amount?: number;
      toBusinessPlaceId?: string | null;
      narration?: string | null;
    },
    actor: { userId?: string }
  ) {
    const asset = await prisma.fixedAsset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw new ApiError(404, "That asset does not exist");
    if (asset.status !== "ACTIVE") {
      throw new ApiError(409, "That asset is no longer on the register", "ASSET_NOT_ACTIVE");
    }
    const amount = n2(input.amount ?? 0);
    const wdv = n2(Number(asset.cost) - Number(asset.accumulatedDepreciation));

    return prisma.$transaction(async (tx) => {
      const event = await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          kind: input.kind,
          effectiveOn: asDate(input.effectiveOn),
          amount,
          wdvAtEvent: wdv,
          fromBusinessPlaceId: asset.businessPlaceId,
          toBusinessPlaceId: input.toBusinessPlaceId ? BigInt(input.toBusinessPlaceId) : null,
          narration: input.narration ?? null,
          createdBy: actor.userId?.slice(0, 36) ?? null,
        },
      });
      if (input.kind === "TRANSFER") {
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            businessPlaceId: input.toBusinessPlaceId ? BigInt(input.toBusinessPlaceId) : null,
          },
        });
      } else if (input.kind === "ADDITION" || input.kind === "REVALUATION") {
        const cost = n2(Number(asset.cost) + amount);
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { cost, residualValue: n2(Number(asset.residualValue) + amount * 0.05) },
        });
      } else if (input.kind === "IMPAIRMENT") {
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { accumulatedDepreciation: n2(Number(asset.accumulatedDepreciation) + amount) },
        });
      }
      return {
        ...event,
        fromBusinessPlaceId:
          event.fromBusinessPlaceId === null ? null : String(event.fromBusinessPlaceId),
        toBusinessPlaceId:
          event.toBusinessPlaceId === null ? null : String(event.toBusinessPlaceId),
      };
    });
  }

  /**
   * Selling or scrapping an asset. The result is measured against written-down value on the day
   * it goes — not against cost, and not against the year-end figure.
   */
  async dispose(
    input: {
      assetId: string;
      disposedOn: string | Date;
      proceeds?: number;
      moneyLedgerCode?: string;
      narration?: string | null;
    },
    actor: { userId?: string }
  ) {
    const asset = await prisma.fixedAsset.findUnique({
      where: { id: input.assetId },
      include: { assetClass: true },
    });
    if (!asset) throw new ApiError(404, "That asset does not exist");
    if (asset.status !== "ACTIVE") {
      throw new ApiError(409, "That asset has already gone", "ASSET_NOT_ACTIVE");
    }
    const disposedOn = asDate(input.disposedOn);
    if (disposedOn < asset.capitalisedOn) {
      throw new ApiError(400, "An asset cannot be disposed of before it was put to use");
    }
    const proceeds = n2(input.proceeds ?? 0);
    const cost = n2(asset.cost);
    const accumulated = n2(asset.accumulatedDepreciation);
    const wdv = n2(cost - accumulated);

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      const voucher = await assetPosting.disposal(
        tx,
        {
          id: asset.id,
          code: asset.code,
          name: asset.name,
          cost,
          accumulated,
          proceeds,
          assetLedgerCode: asset.assetClass.assetLedgerCode,
          accumDepLedgerCode: asset.assetClass.accumDepLedgerCode,
        },
        disposedOn,
        input.moneyLedgerCode ?? "BANK-001",
        actor.userId
      );
      await tx.assetEvent.create({
        data: {
          assetId: asset.id,
          kind: "DISPOSAL",
          effectiveOn: disposedOn,
          amount: proceeds,
          wdvAtEvent: wdv,
          resultAmount: n2(proceeds - wdv),
          narration: input.narration ?? null,
          voucherId: voucher?.id ?? null,
          createdBy: actor.userId?.slice(0, 36) ?? null,
        },
      });
      const updated = await tx.fixedAsset.update({
        where: { id: asset.id },
        data: {
          status: proceeds > 0 ? "DISPOSED" : "WRITTEN_OFF",
          disposedOn,
          disposalProceeds: proceeds,
        },
      });
      return {
        ...updated,
        businessPlaceId: updated.businessPlaceId === null ? null : String(updated.businessPlaceId),
        wdvAtDisposal: wdv,
        result: n2(proceeds - wdv),
        voucherId: voucher?.id ?? null,
      };
    });
  }

  /** What a month would charge, without writing anything. */
  async previewRun(periodKey: string) {
    const period = monthRange(periodKey);
    const assets = await prisma.fixedAsset.findMany({
      where: {
        capitalisedOn: { lte: period.to },
        OR: [{ status: "ACTIVE" }, { disposedOn: { gte: period.from } }],
      },
      include: { assetClass: true },
    });
    const alreadyCharged = await prisma.assetDepreciation.findMany({
      where: { periodKey },
      select: { assetId: true },
    });
    const done = new Set(alreadyCharged.map((d) => d.assetId));

    const lines = assets
      .filter((a) => !done.has(a.id))
      .map((a) => {
        const charge = monthlyCharge({
          cost: n2(a.cost),
          residualValue: n2(a.residualValue),
          usefulLifeMonths: a.usefulLifeMonths,
          method: a.method,
          accumulated: n2(a.accumulatedDepreciation),
          capitalisedOn: a.capitalisedOn,
          disposedOn: a.disposedOn,
          period,
        });
        return {
          assetId: a.id,
          code: a.code,
          name: a.name,
          classCode: a.assetClass.code,
          className: a.assetClass.name,
          depExpenseLedgerCode: a.assetClass.depExpenseLedgerCode,
          accumDepLedgerCode: a.assetClass.accumDepLedgerCode,
          method: a.method,
          ...charge,
        };
      })
      .filter((l) => l.amount > 0);

    return {
      periodKey,
      from: iso(period.from),
      to: iso(period.to),
      total: n2(lines.reduce((s, l) => s + l.amount, 0)),
      lines,
    };
  }

  /**
   * Prepares the month. A run is unique on the period, so a second attempt returns the first
   * rather than charging twice — which is the whole reason the run exists as a row. A cancelled or
   * reversed run is prepared afresh into the same row (the period is still unique), rather than
   * a second row the unique constraint would refuse anyway.
   */
  async prepareRun(periodKey: string, actor: { userId?: string }) {
    const existing = await prisma.depreciationRun.findFirst({ where: { periodKey } });
    if (existing && existing.status !== "CANCELLED" && existing.status !== "REVERSED") {
      return this.runWithLines(existing.id);
    }
    const preview = await this.previewRun(periodKey);
    const run = await prisma.$transaction(async (tx) => {
      let created;
      if (existing) {
        await tx.assetDepreciation.deleteMany({ where: { runId: existing.id } });
        created = await tx.depreciationRun.update({
          where: { id: existing.id },
          data: {
            status: "DRAFT",
            totalAmount: preview.total,
            assetCount: preview.lines.length,
            preparedBy: actor.userId?.slice(0, 36) ?? null,
            voucherId: null,
            postedBy: null,
            postedAt: null,
            reversedBy: null,
            reversedAt: null,
            reversalVoucherId: null,
          },
        });
      } else {
        created = await tx.depreciationRun.create({
          data: {
            periodKey,
            totalAmount: preview.total,
            assetCount: preview.lines.length,
            preparedBy: actor.userId?.slice(0, 36) ?? null,
          },
        });
      }
      if (preview.lines.length > 0) {
        await tx.assetDepreciation.createMany({
          data: preview.lines.map((l) => ({
            runId: created.id,
            assetId: l.assetId,
            periodKey,
            daysInUse: l.daysInUse,
            openingWdv: l.openingWdv,
            amount: l.amount,
            closingWdv: l.closingWdv,
            method: l.method,
          })),
        });
      }
      return created;
    });
    return this.runWithLines(run.id);
  }

  /**
   * Posts the month: one journal with a debit and a credit per class, and the accumulated
   * depreciation on every asset moved on. Posting is where the register and the books meet, so
   * it is a single transaction.
   */
  async postRun(id: string, actor: { userId?: string }) {
    const run = await prisma.depreciationRun.findUnique({
      where: { id },
      include: { lines: { include: { asset: { include: { assetClass: true } } } } },
    });
    if (!run) throw new ApiError(404, "That depreciation run does not exist");
    if (run.status === "POSTED")
      throw new ApiError(409, "That month is already posted", "ALREADY_POSTED");
    if (run.status === "CANCELLED")
      throw new ApiError(409, "That run was cancelled", "RUN_CANCELLED");
    if (run.status === "REVERSED")
      throw new ApiError(
        409,
        "That run was reversed; prepare the month again to re-post it",
        "RUN_REVERSED"
      );

    const period = monthRange(run.periodKey);
    const byClass = new Map<
      string,
      {
        classCode: string;
        className: string;
        depExpenseLedgerCode: string;
        accumDepLedgerCode: string;
        amount: number;
      }
    >();
    for (const l of run.lines) {
      const cls = l.asset.assetClass;
      const cur = byClass.get(cls.code) ?? {
        classCode: cls.code,
        className: cls.name,
        depExpenseLedgerCode: cls.depExpenseLedgerCode,
        accumDepLedgerCode: cls.accumDepLedgerCode,
        amount: 0,
      };
      cur.amount = n2(cur.amount + Number(l.amount));
      byClass.set(cls.code, cur);
    }

    return prisma.$transaction(async (tx) => {
      await accountsService.ensureSystemLedgersExist(tx);
      const voucher = await assetPosting.depreciation(
        tx,
        { id: run.id, periodKey: run.periodKey },
        [...byClass.values()],
        period.to,
        actor.userId
      );
      for (const l of run.lines) {
        await tx.fixedAsset.update({
          where: { id: l.assetId },
          data: { accumulatedDepreciation: { increment: Number(l.amount) } },
        });
      }
      return tx.depreciationRun.update({
        where: { id: run.id },
        data: {
          status: "POSTED",
          voucherId: voucher?.id ?? null,
          postedBy: actor.userId?.slice(0, 36) ?? null,
          postedAt: new Date(),
        },
      });
    });
  }

  /**
   * Reverses a posted month (P2-07): cancels its voucher through `cancellationService` (a
   * reversal JOURNAL with the sides swapped — the original stays on file, never deleted) and moves
   * every asset's accumulated depreciation back by what this run charged it. Refused out of order:
   * a later month already posted has to be reversed first, or its own charge would be measured
   * from a written-down value this run is about to move.
   */
  async reverseRun(id: string, actor: { userId?: string }) {
    const run = await prisma.depreciationRun.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!run) throw new ApiError(404, "That depreciation run does not exist");
    if (run.status !== "POSTED") {
      throw new ApiError(409, "Only a posted run can be reversed", "NOT_POSTED");
    }
    const later = await prisma.depreciationRun.findFirst({
      where: { periodKey: { gt: run.periodKey }, status: "POSTED" },
      orderBy: { periodKey: "asc" },
    });
    if (later) {
      throw new ApiError(
        409,
        `${later.periodKey} is posted and later than this run; reverse it first`,
        "REVERSE_OUT_OF_ORDER"
      );
    }

    const reversalDate = new Date();
    await periodService.assertPostingAllowed(reversalDate, { userId: actor.userId });

    return prisma.$transaction(async (tx) => {
      let reversalVoucherId: number | null = null;
      if (run.voucherId) {
        const { reversal } = await cancellationService.cancelVoucher(
          run.voucherId,
          { reason: `Reversal of depreciation run ${run.periodKey}`, actor, date: reversalDate },
          tx
        );
        reversalVoucherId = reversal.id;
      }
      for (const l of run.lines) {
        await tx.fixedAsset.update({
          where: { id: l.assetId },
          data: { accumulatedDepreciation: { decrement: Number(l.amount) } },
        });
      }
      return tx.depreciationRun.update({
        where: { id: run.id },
        data: {
          status: "REVERSED",
          reversedBy: actor.userId?.slice(0, 36) ?? null,
          reversedAt: reversalDate,
          reversalVoucherId,
        },
      });
    });
  }

  private async runWithLines(id: string) {
    const run = await prisma.depreciationRun.findUniqueOrThrow({
      where: { id },
      include: {
        lines: {
          include: { asset: { select: { code: true, name: true } } },
          orderBy: { amount: "desc" },
        },
      },
    });
    return run;
  }

  async runs(limit = 24) {
    return prisma.depreciationRun.findMany({ orderBy: { periodKey: "desc" }, take: limit });
  }

  /**
   * One run's lines against the current state of each asset (P2-19), so a reversed run's restored
   * figures show against the run in one place instead of the asset row and the run needing to be
   * checked separately. For a `REVERSED` run, "after" is the asset's current accumulated
   * depreciation (what the reversal restored it to) and "before" is what this run had charged it
   * before that reversal — the current figure plus this run's own amount. For any other status
   * the two are the same: nothing has moved this run's charge back.
   */
  async runDetail(id: string) {
    const run = await prisma.depreciationRun.findUnique({
      where: { id },
      include: {
        lines: {
          include: { asset: { select: { code: true, name: true, accumulatedDepreciation: true } } },
          orderBy: { amount: "desc" },
        },
      },
    });
    if (!run) throw new ApiError(404, "That depreciation run does not exist");
    const restored = run.status === "REVERSED";
    return {
      ...run,
      lines: run.lines.map((l) => {
        const after = n2(l.asset.accumulatedDepreciation);
        return {
          assetId: l.assetId,
          code: l.asset.code,
          name: l.asset.name,
          amount: n2(l.amount),
          accumulatedDepreciationAfter: after,
          accumulatedDepreciationBefore: restored ? n2(after + Number(l.amount)) : after,
        };
      }),
    };
  }

  /**
   * The fixed-asset register for a financial year: the Schedule II movement the notes to the
   * accounts print, class by class.
   */
  async register(fyCode: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(fyCode);
    if (!match) throw new ApiError(400, "A financial year looks like 2026-27");
    const startYear = Number(match[1]);
    const fyStart = new Date(Date.UTC(startYear, 3, 1));
    const fyEnd = new Date(Date.UTC(startYear + 1, 2, 31));

    const assets = await prisma.fixedAsset.findMany({
      where: { capitalisedOn: { lte: fyEnd } },
      include: { assetClass: true, depreciations: true, events: true },
    });

    const groups = new Map<
      string,
      {
        classCode: string;
        className: string;
        scheduleIiHead: string | null;
        openingCost: number;
        additions: number;
        disposalsCost: number;
        closingCost: number;
        openingDep: number;
        chargeForYear: number;
        disposalsDep: number;
        closingDep: number;
        closingWdv: number;
      }
    >();

    for (const a of assets) {
      const cls = a.assetClass;
      const g = groups.get(cls.code) ?? {
        classCode: cls.code,
        className: cls.name,
        scheduleIiHead: cls.scheduleIiHead,
        openingCost: 0,
        additions: 0,
        disposalsCost: 0,
        closingCost: 0,
        openingDep: 0,
        chargeForYear: 0,
        disposalsDep: 0,
        closingDep: 0,
        closingWdv: 0,
      };
      const boughtThisYear = a.capitalisedOn >= fyStart;
      const goneThisYear = a.disposedOn && a.disposedOn >= fyStart && a.disposedOn <= fyEnd;
      const cost = n2(a.cost);
      // Depreciation is summed from the charge rows, so the movement ties to what was posted
      // rather than being recomputed and quietly disagreeing with the books.
      const charged = a.depreciations.filter(
        (d) => d.periodKey >= `${startYear}-04` && d.periodKey <= `${startYear + 1}-03`
      );
      const chargeForYear = n2(charged.reduce((s, d) => s + Number(d.amount), 0));
      const openingDep = n2(Number(a.accumulatedDepreciation) - chargeForYear);

      if (boughtThisYear) g.additions = n2(g.additions + cost);
      else g.openingCost = n2(g.openingCost + cost);
      g.chargeForYear = n2(g.chargeForYear + chargeForYear);
      if (!boughtThisYear) g.openingDep = n2(g.openingDep + openingDep);

      if (goneThisYear) {
        g.disposalsCost = n2(g.disposalsCost + cost);
        g.disposalsDep = n2(g.disposalsDep + Number(a.accumulatedDepreciation));
      } else if (!a.disposedOn) {
        g.closingCost = n2(g.closingCost + cost);
        g.closingDep = n2(g.closingDep + Number(a.accumulatedDepreciation));
      }
      g.closingWdv = n2(g.closingCost - g.closingDep);
      groups.set(cls.code, g);
    }

    const rows = [...groups.values()].sort((a, b) => a.classCode.localeCompare(b.classCode));
    return {
      fyCode,
      fyStart: iso(fyStart),
      fyEnd: iso(fyEnd),
      rows,
      totals: rows.reduce(
        (t, r) => ({
          openingCost: n2(t.openingCost + r.openingCost),
          additions: n2(t.additions + r.additions),
          disposalsCost: n2(t.disposalsCost + r.disposalsCost),
          closingCost: n2(t.closingCost + r.closingCost),
          chargeForYear: n2(t.chargeForYear + r.chargeForYear),
          closingDep: n2(t.closingDep + r.closingDep),
          closingWdv: n2(t.closingWdv + r.closingWdv),
        }),
        {
          openingCost: 0,
          additions: 0,
          disposalsCost: 0,
          closingCost: 0,
          chargeForYear: 0,
          closingDep: 0,
          closingWdv: 0,
        }
      ),
    };
  }

  /**
   * Income-tax depreciation for a year, block by block.
   *
   * This is a report and nothing else: it is never posted, and it will not agree with the book
   * charge — different rates, a pool instead of an asset, a half-rate year, and sale proceeds
   * taken off the block rather than producing a profit. Making the two agree would mean one of
   * them is wrong.
   */
  async itBlocks(fyCode: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(fyCode);
    if (!match) throw new ApiError(400, "A financial year looks like 2026-27");
    const startYear = Number(match[1]);
    const fyStart = new Date(Date.UTC(startYear, 3, 1));
    const fyEnd = new Date(Date.UTC(startYear + 1, 2, 31));

    const assets = await prisma.fixedAsset.findMany({
      where: { capitalisedOn: { lte: fyEnd } },
      include: { assetClass: true },
    });

    const blocks = new Map<string, { name: string; rate: number; assets: typeof assets }>();
    for (const a of assets) {
      const key = `${a.assetClass.itBlockName ?? a.assetClass.name}|${Number(a.assetClass.itBlockRate)}`;
      const b = blocks.get(key) ?? {
        name: a.assetClass.itBlockName ?? a.assetClass.name,
        rate: Number(a.assetClass.itBlockRate),
        assets: [] as typeof assets,
      };
      b.assets.push(a);
      blocks.set(key, b);
    }

    const rows = [...blocks.values()].map((b) => {
      // Everything already on the books at the start of the year is the opening pool. An asset
      // brought in by the opening-balance import (P2-07) contributes its opening written-down
      // value, not its cost — the whole point of that import is to say what the pool already
      // carries; anything typed in afresh still contributes cost, which is the best the register
      // can say without an imported figure, and it is said plainly rather than guessed at.
      const opening = n2(
        b.assets
          .filter((a) => a.capitalisedOn < fyStart && (!a.disposedOn || a.disposedOn >= fyStart))
          .reduce(
            (s, a) =>
              s +
              (a.openingBalance && a.openingItWdv !== null
                ? Number(a.openingItWdv)
                : Number(a.cost)),
            0
          )
      );
      const result = itBlockDepreciation(
        opening,
        b.rate,
        b.assets.map((a) => ({
          cost: n2(a.cost),
          capitalisedOn: a.capitalisedOn,
          disposedOn: a.disposedOn,
          disposalProceeds: n2(a.disposalProceeds),
        })),
        fyStart,
        fyEnd
      );
      return { block: b.name, rate: b.rate, ...result };
    });

    return {
      fyCode,
      fyStart: iso(fyStart),
      fyEnd: iso(fyEnd),
      rows,
      total: n2(rows.reduce((s, r) => s + r.depreciation, 0)),
      note: "Income-tax depreciation is a block calculation and will not match the book charge.",
    };
  }

  /** The monthly sweep: prepare last month for every tenant, leaving the posting to a person. */
  async sweepAllTenants(today = new Date()) {
    const previous = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const key = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let prepared = 0;
    for (const c of companies) {
      try {
        await runAsTenant(c.id, () => this.prepareRun(key, {}));
        prepared++;
      } catch (err) {
        logger.error(
          { companyId: c.id, periodKey: key, err },
          "Depreciation run failed for a tenant"
        );
      }
    }
    return { companies: companies.length, prepared, periodKey: key };
  }
}

export const assetService = new AssetService();
export type AssetRegister = Awaited<ReturnType<AssetService["register"]>>;
