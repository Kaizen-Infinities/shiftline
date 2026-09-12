import type { ChallanKind, ItemCategoryType, Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { logger } from "../../lib/logger";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { documentNumberService } from "../documents/document-number.service";
import { splitGst, supplyTypeFor } from "../gst/gst.calc";
import { companyGstProfile, resolveIssuingPlace, stateOfGstin } from "../gst/gst.context";
import { notify } from "../notifications/notify";

/**
 * Job work and delivery challans (P1-14).
 *
 * Goods leave without being sold, and the input credit taken on them stays safe only while they
 * come back: a year for inputs, three for capital goods. Miss that and the credit is treated as
 * a supply on the day the goods went out, with interest — so the clock is the point of this
 * module, not the paperwork.
 *
 * A challan line is accounted for when what was sent equals what came back plus what the process
 * consumed plus what was scrapped. Until then it is a balance someone has to answer for.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const n3 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 1000) / 1000;

/** Section 143: inputs come back within a year, capital goods within three. */
export const RETURN_YEARS = { inputs: 1, capitalGoods: 3 };
/** Days before the deadline that holders of the permission are warned. */
export const WARN_DAYS_BEFORE = [30, 7];

export const returnDueDate = (sentOn: Date, capitalGoods: boolean): Date => {
  const due = new Date(sentOn);
  due.setUTCFullYear(
    due.getUTCFullYear() + (capitalGoods ? RETURN_YEARS.capitalGoods : RETURN_YEARS.inputs)
  );
  return due;
};

export interface ChallanItemInput {
  itemType?: ItemCategoryType;
  rawMaterialId?: string | null;
  productItemId?: string | number | null;
  description?: string | null;
  uom?: string | null;
  hsnCode?: string | null;
  quantity: number;
  rate?: number | null;
  gstRate?: number | null;
}

export interface ChallanInput {
  kind: ChallanKind;
  challanDate: string | Date;
  jobWorkerId?: string | null;
  parentChallanId?: string | null;
  businessPlaceId?: string | number | null;
  toBusinessPlaceId?: string | number | null;
  storeId?: string | null;
  purpose?: string | null;
  capitalGoods?: boolean;
  transporterName?: string | null;
  vehicleNumber?: string | null;
  remarks?: string | null;
  items: ChallanItemInput[];
}

class JobWorkService {
  // ── The job worker master ────────────────────────────────────────────────────
  async listWorkers(includeInactive = false) {
    return prisma.jobWorker.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: { name: "asc" },
    });
  }

  async upsertWorker(
    input: {
      id?: string;
      code?: string;
      name: string;
      gstin?: string | null;
      stateCode?: string | null;
      addressLine1?: string | null;
      city?: string | null;
      pincode?: string | null;
      contactPerson?: string | null;
      phone?: string | null;
      email?: string | null;
      processType?: string | null;
      isActive?: boolean;
    },
    actor: { userId?: string }
  ) {
    const data = {
      name: input.name.trim().slice(0, 160),
      gstin: input.gstin?.trim().toUpperCase() || null,
      // The state matters for the e-way bill even when there is no GSTIN.
      stateCode: input.stateCode ?? stateOfGstin(input.gstin ?? null) ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      pincode: input.pincode ?? null,
      contactPerson: input.contactPerson ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      processType: input.processType ?? null,
      isActive: input.isActive ?? true,
    };
    if (input.id) {
      return prisma.jobWorker.update({ where: { id: input.id }, data });
    }
    const code = (input.code ?? `JW${Date.now().toString(36).toUpperCase().slice(-6)}`)
      .trim()
      .toUpperCase()
      .slice(0, 20);
    const clash = await prisma.jobWorker.findFirst({ where: { code } });
    if (clash) throw new ApiError(409, `Job worker code ${code} is already used`, "CODE_TAKEN");
    return prisma.jobWorker.create({ data: { code, ...data, createdBy: actor.userId ?? null } });
  }

  // ── Challans ────────────────────────────────────────────────────────────────
  /** Goods going out. A job-work challan starts the return clock; the others do not. */
  async create(input: ChallanInput, actor: { userId?: string }) {
    const date = new Date(input.challanDate);
    if (Number.isNaN(date.getTime())) throw new ApiError(400, "Invalid challan date");
    if (!input.items?.length) throw new ApiError(400, "A challan needs at least one line");
    if (input.kind === "JOB_WORK_OUT" && !input.jobWorkerId) {
      throw new ApiError(400, "Job work needs a job worker", "JOB_WORKER_REQUIRED");
    }

    const profile = await companyGstProfile(prisma);
    const place = await resolveIssuingPlace(input.businessPlaceId, profile, prisma);
    const worker = input.jobWorkerId
      ? await prisma.jobWorker.findUnique({ where: { id: input.jobWorkerId } })
      : null;
    if (input.jobWorkerId && !worker) throw new ApiError(404, "That job worker does not exist");

    const toState =
      worker?.stateCode ??
      // A business place keeps its state in its GSTIN, not a column of its own.
      (input.toBusinessPlaceId
        ? stateOfGstin(
            (
              await prisma.businessPlace.findUnique({
                where: { id: BigInt(input.toBusinessPlaceId) },
                select: { gstin: true },
              })
            )?.gstin ?? null
          )
        : null) ??
      place.stateCode;
    const supplyType = supplyTypeFor({ fromStateCode: place.stateCode, toStateCode: toState });

    // A challan carries no tax — nothing is being supplied — but it carries a value, and the
    // e-way bill needs the notional tax on that value.
    let taxable = 0;
    let igst = 0;
    let cgst = 0;
    let sgst = 0;
    const items = input.items.map((i) => {
      const qty = n3(i.quantity);
      if (!(qty > 0)) throw new ApiError(400, "Every line needs a quantity");
      const rate = n2(i.rate ?? 0);
      const lineValue = n2(qty * rate);
      const gstRate = Number(i.gstRate ?? 0);
      const split = splitGst(lineValue, gstRate, supplyType);
      taxable = n2(taxable + lineValue);
      igst = n2(igst + split.igstAmount);
      cgst = n2(cgst + split.cgstAmount);
      sgst = n2(sgst + split.sgstAmount);
      return {
        itemType: (i.itemType ?? "RAW_MATERIAL") as ItemCategoryType,
        rawMaterialId: i.rawMaterialId ?? null,
        productItemId: i.productItemId != null ? BigInt(i.productItemId) : null,
        description: i.description ?? null,
        uom: i.uom ?? null,
        hsnCode: i.hsnCode ?? null,
        quantitySent: qty,
        rate,
        taxableAmount: lineValue,
        gstRate,
      };
    });

    const capitalGoods = Boolean(input.capitalGoods);
    return prisma.$transaction(async (tx) => {
      const challanNo = await documentNumberService.next(
        input.kind === "JOB_WORK_OUT" || input.kind === "JOB_WORK_RETURN"
          ? "JOB_WORK_CHALLAN"
          : "DELIVERY_CHALLAN",
        { date, businessPlaceId: place.id, tx }
      );
      return tx.deliveryChallan.create({
        data: {
          challanNo,
          challanDate: date,
          kind: input.kind,
          jobWorkerId: input.jobWorkerId ?? null,
          parentChallanId: input.parentChallanId ?? null,
          businessPlaceId: place.id,
          toBusinessPlaceId: input.toBusinessPlaceId ? BigInt(input.toBusinessPlaceId) : null,
          storeId: input.storeId ?? null,
          placeOfSupply: toState,
          supplyType,
          purpose: input.purpose ?? null,
          capitalGoods,
          // Only job work runs a clock: a branch transfer or an exhibition has no deadline.
          returnDueDate: input.kind === "JOB_WORK_OUT" ? returnDueDate(date, capitalGoods) : null,
          taxable,
          igst,
          cgst,
          sgst,
          totalValue: n2(taxable + igst + cgst + sgst),
          transporterName: input.transporterName ?? null,
          vehicleNumber: input.vehicleNumber ?? null,
          remarks: input.remarks ?? null,
          createdBy: actor.userId ?? null,
          items: { create: items },
        },
        include: { items: true, jobWorker: true },
      });
    });
  }

  /**
   * Records what came back against an out challan: returned as itself, consumed by the process,
   * or scrapped. The three together are what closes a line — scrap that stays with the job
   * worker is a supply to them, which is why it is recorded rather than ignored.
   */
  async receive(
    challanId: string,
    input: {
      receivedOn?: string | Date;
      lines: { itemId: string; returned?: number; consumed?: number; scrap?: number }[];
    },
    actor: { userId?: string }
  ) {
    const challan = await prisma.deliveryChallan.findUnique({
      where: { id: challanId },
      include: { items: true },
    });
    if (!challan) throw new ApiError(404, "That challan does not exist");
    if (challan.cancelledAt) throw new ApiError(409, "That challan was cancelled", "CANCELLED");
    if (challan.kind !== "JOB_WORK_OUT") {
      throw new ApiError(400, "Only a job-work challan takes goods back", "NOT_JOB_WORK");
    }
    if (!input.lines?.length) throw new ApiError(400, "Nothing to receive");

    const byId = new Map(challan.items.map((i) => [i.id, i]));
    for (const line of input.lines) {
      const item = byId.get(line.itemId);
      if (!item) throw new ApiError(404, `Line ${line.itemId} is not on that challan`);
      const returned = n3(item.quantityReturned) + n3(line.returned ?? 0);
      const consumed = n3(item.quantityConsumed) + n3(line.consumed ?? 0);
      const scrap = n3(item.quantityScrap) + n3(line.scrap ?? 0);
      if (n3(returned + consumed + scrap) > n3(item.quantitySent) + 0.0005) {
        throw new ApiError(
          400,
          `More was accounted for than was sent on that line (${n3(item.quantitySent)} sent)`,
          "OVER_RECEIVED",
          { itemId: item.id, sent: n3(item.quantitySent) }
        );
      }
    }

    return prisma.$transaction(async (tx) => {
      for (const line of input.lines) {
        const item = byId.get(line.itemId)!;
        await tx.deliveryChallanItem.update({
          where: { id: item.id },
          data: {
            quantityReturned: n3(Number(item.quantityReturned) + Number(line.returned ?? 0)),
            quantityConsumed: n3(Number(item.quantityConsumed) + Number(line.consumed ?? 0)),
            quantityScrap: n3(Number(item.quantityScrap) + Number(line.scrap ?? 0)),
          },
        });
      }
      return this.restate(tx, challanId, actor);
    });
  }

  /** Sets the challan's status from what its lines now say. */
  private async restate(
    tx: Prisma.TransactionClient,
    challanId: string,
    actor: { userId?: string }
  ) {
    const items = await tx.deliveryChallanItem.findMany({ where: { challanId } });
    const sent = items.reduce((s, i) => s + Number(i.quantitySent), 0);
    const back = items.reduce(
      (s, i) =>
        s + Number(i.quantityReturned) + Number(i.quantityConsumed) + Number(i.quantityScrap),
      0
    );
    const status = back <= 0 ? "OPEN" : n3(back) >= n3(sent) - 0.0005 ? "CLOSED" : "PART_RETURNED";
    return tx.deliveryChallan.update({
      where: { id: challanId },
      data: {
        status,
        closedAt: status === "CLOSED" ? new Date() : null,
        ...(actor.userId ? {} : {}),
      },
      include: { items: true, jobWorker: true },
    });
  }

  async get(id: string) {
    const row = await prisma.deliveryChallan.findUnique({
      where: { id },
      include: { items: true, jobWorker: true, returns: true, parentChallan: true },
    });
    if (!row) throw new ApiError(404, "That challan does not exist");
    return this.withBalance(row);
  }

  /** A challan with what is still out on it, line by line. */
  private withBalance<
    T extends {
      items: {
        quantitySent: unknown;
        quantityReturned: unknown;
        quantityConsumed: unknown;
        quantityScrap: unknown;
      }[];
      returnDueDate: Date | null;
    },
  >(row: T) {
    const items = row.items.map((i) => ({
      ...i,
      balance: n3(
        Number(i.quantitySent) -
          Number(i.quantityReturned) -
          Number(i.quantityConsumed) -
          Number(i.quantityScrap)
      ),
    }));
    const pending = n3(items.reduce((s, i) => s + i.balance, 0));
    const daysLeft = row.returnDueDate
      ? Math.round((row.returnDueDate.getTime() - Date.now()) / 86400000)
      : null;
    return {
      ...row,
      items,
      pendingQuantity: pending,
      daysToReturn: daysLeft,
      overdue: pending > 0 && daysLeft !== null && daysLeft < 0,
    };
  }

  async list(params: {
    kind?: ChallanKind;
    status?: string;
    jobWorkerId?: string;
    from?: Date;
    to?: Date;
    overdueOnly?: boolean;
  }) {
    const rows = await prisma.deliveryChallan.findMany({
      where: {
        ...(params.kind ? { kind: params.kind } : {}),
        ...(params.status ? { status: params.status as "OPEN" } : {}),
        ...(params.jobWorkerId ? { jobWorkerId: params.jobWorkerId } : {}),
        ...(params.from || params.to
          ? {
              challanDate: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      include: { items: true, jobWorker: { select: { id: true, code: true, name: true } } },
      orderBy: { challanDate: "desc" },
      take: 500,
    });
    const mapped = rows.map((r) => this.withBalance(r));
    return params.overdueOnly ? mapped.filter((r) => r.overdue) : mapped;
  }

  /**
   * The job-work register: what is out with each worker, and what is late. This is the report an
   * auditor asks for, and the one that shows the credit at risk.
   */
  async register(params: { from?: Date; to?: Date; jobWorkerId?: string } = {}) {
    const rows = await this.list({ ...params, kind: "JOB_WORK_OUT" });
    const byWorker = new Map<
      string,
      {
        jobWorker: { id: string; code: string; name: string } | null;
        challans: number;
        pending: number;
        overdue: number;
        value: number;
      }
    >();
    for (const r of rows) {
      const key = r.jobWorkerId ?? "none";
      const cur = byWorker.get(key) ?? {
        jobWorker: r.jobWorker ?? null,
        challans: 0,
        pending: 0,
        overdue: 0,
        value: 0,
      };
      cur.challans++;
      cur.pending = n3(cur.pending + r.pendingQuantity);
      if (r.overdue) cur.overdue++;
      cur.value = n2(cur.value + Number(r.totalValue));
      byWorker.set(key, cur);
    }
    return { challans: rows, byWorker: [...byWorker.values()] };
  }

  /**
   * ITC-04 for a half-year: goods sent to a job worker (table 4) and goods received back
   * (table 5A). The return is per half-year — April to September, October to March — and the
   * period key is `2026-H1` or `2026-H2`.
   */
  async itc04(halfYearKey: string) {
    const m = halfYearKey.match(/^(\d{4})-H([12])$/);
    if (!m) throw new ApiError(400, `Period ${halfYearKey} must look like 2026-H1`);
    const year = Number(m[1]);
    const first = m[2] === "1";
    // H1 is April to September of the year; H2 is October to the following March.
    const from = new Date(Date.UTC(year, first ? 3 : 9, 1));
    const to = new Date(Date.UTC(first ? year : year + 1, first ? 9 : 3, 1));

    const sent = await prisma.deliveryChallan.findMany({
      where: { kind: "JOB_WORK_OUT", challanDate: { gte: from, lt: to }, cancelledAt: null },
      include: { items: true, jobWorker: true },
      orderBy: { challanDate: "asc" },
    });
    // Goods coming back are recorded on the out challan, so the receipts in the window are the
    // return challans raised against one.
    const received = await prisma.deliveryChallan.findMany({
      where: { kind: "JOB_WORK_RETURN", challanDate: { gte: from, lt: to }, cancelledAt: null },
      include: {
        items: true,
        jobWorker: true,
        parentChallan: { select: { challanNo: true, challanDate: true } },
      },
      orderBy: { challanDate: "asc" },
    });

    const line = (c: (typeof sent)[number]) =>
      c.items.map((i) => ({
        challanNo: c.challanNo,
        challanDate: c.challanDate.toISOString().slice(0, 10),
        jobWorkerGstin: c.jobWorker?.gstin ?? null,
        jobWorkerName: c.jobWorker?.name ?? null,
        /** The portal asks whether the worker is registered; no GSTIN means they are not. */
        registered: Boolean(c.jobWorker?.gstin),
        description: i.description ?? i.rawMaterialId ?? "",
        hsnCode: i.hsnCode,
        uom: i.uom,
        quantity: n3(i.quantitySent),
        taxable: n2(i.taxableAmount),
        capitalGoods: c.capitalGoods,
      }));

    return {
      periodKey: halfYearKey,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      /** Table 4: details of inputs and capital goods sent for job work. */
      table4: sent.flatMap(line),
      /** Table 5A: goods received back from the job worker. */
      table5A: received.flatMap((c) =>
        c.items.map((i) => ({
          challanNo: c.challanNo,
          challanDate: c.challanDate.toISOString().slice(0, 10),
          originalChallanNo: c.parentChallan?.challanNo ?? null,
          originalChallanDate: c.parentChallan?.challanDate.toISOString().slice(0, 10) ?? null,
          jobWorkerGstin: c.jobWorker?.gstin ?? null,
          description: i.description ?? i.rawMaterialId ?? "",
          uom: i.uom,
          quantity: n3(i.quantitySent),
        }))
      ),
      totals: {
        challansIssued: sent.length,
        quantitySent: n3(
          sent.flatMap((c) => c.items).reduce((s, i) => s + Number(i.quantitySent), 0)
        ),
        valueSent: n2(sent.reduce((s, c) => s + Number(c.taxable), 0)),
        challansReceived: received.length,
      },
    };
  }

  /**
   * Warns about goods that have not come back and are running out of time. Sent once per
   * challan per threshold: a reminder that arrives daily is one people stop reading, and the
   * consequence here — credit reversed with interest — is worth a message that lands.
   */
  async warnOverdue(today = new Date()) {
    const horizon = new Date(today);
    horizon.setUTCDate(horizon.getUTCDate() + Math.max(...WARN_DAYS_BEFORE));
    const candidates = await prisma.deliveryChallan.findMany({
      where: {
        kind: "JOB_WORK_OUT",
        status: { in: ["OPEN", "PART_RETURNED"] },
        cancelledAt: null,
        returnDueDate: { not: null, lte: horizon },
      },
      include: { items: true, jobWorker: { select: { name: true } } },
    });
    let sent = 0;
    for (const c of candidates) {
      const row = this.withBalance(c);
      if (row.pendingQuantity <= 0) continue;
      const daysLeft = row.daysToReturn ?? 0;
      // One message per threshold crossed, plus one once it is actually late.
      const threshold = daysLeft < 0 ? "late" : WARN_DAYS_BEFORE.find((d) => daysLeft <= d);
      if (threshold === undefined) continue;
      const link = `/production/job-work?challan=${c.id}&notice=${threshold}`;
      const already = await prisma.notification.findFirst({
        where: { category: "job-work", link },
        select: { id: true },
      });
      if (already) continue;
      await notify({
        category: "job-work",
        title:
          daysLeft < 0
            ? `${c.challanNo}: goods are ${-daysLeft} day(s) past the return deadline`
            : `${c.challanNo}: goods must come back within ${daysLeft} day(s)`,
        body:
          `${row.pendingQuantity} still out with ${c.jobWorker?.name ?? "the job worker"}. ` +
          `Past the deadline the credit is treated as a supply made on ${c.challanDate
            .toISOString()
            .slice(0, 10)}, with interest.`,
        link,
        to: { permission: "job-work.view" },
        level: daysLeft <= 7 ? "WARNING" : "INFO",
      });
      sent++;
    }
    return { checked: candidates.length, sent };
  }

  /** The daily sweep across every tenant. */
  async sweepAllTenants(today = new Date()) {
    const companies = await withoutTenant(() =>
      prisma.company.findMany({ where: { isActive: true }, select: { id: true } })
    );
    let sent = 0;
    for (const c of companies) {
      try {
        const r = await runAsTenant(c.id, () => this.warnOverdue(today));
        sent += r.sent;
      } catch (err) {
        logger.warn({ err, companyId: c.id }, "job-work warning skipped");
      }
    }
    return { tenants: companies.length, sent };
  }
}

export const jobWorkService = new JobWorkService();
