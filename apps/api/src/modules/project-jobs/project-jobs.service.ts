import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  STAGE_PLANS,
  asDate,
  canMoveStatus,
  iso,
  lineAmount,
  reorderSeqs,
  summariseJob,
  type JobStatus,
} from "./project-jobs.calc";
import type {
  addBillingBody,
  addCostBody,
  addStageBody,
  createBody,
  listQuery,
  postCostsBody,
  reorderBody,
  updateBody,
  updateStageBody,
} from "./project-jobs.validation";

/**
 * Job / project costing (TN-09): one customer job (a truck body on the customer's chassis, a
 * fabrication order) with its stage plan, costs and billing, compared with the quote. Every query
 * goes through the tenant-scoped client, so a foreign company's rows read as absent (404).
 */
type Actor = { userId?: string };
type Job = Prisma.ProjectJobGetPayload<{ include: typeof include }>;
type Stage = Job["stages"][number];
type Cost = Job["costs"][number];
type Billing = Job["billings"][number];

const include = {
  customer: { select: { id: true, firmName: true } },
  stages: { orderBy: { seq: "asc" } },
  costs: { orderBy: [{ costDate: "asc" }, { createdAt: "asc" }] },
  billings: { orderBy: [{ billDate: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.ProjectJobInclude;

const n = (d: Prisma.Decimal | null | undefined) => (d == null ? 0 : Number(d));
const isoOrNull = (d: Date | null) => (d ? iso(d) : null);
const dateOrNull = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : asDate(v);

const summaryOf = (job: Job) =>
  summariseJob({
    quoted: n(job.quotedAmount),
    costs: job.costs.map((c) => ({ type: c.type, amount: n(c.amount), status: c.status })),
    stages: job.stages.map((s) => ({ status: s.status, weight: s.weight })),
    finished: job.status === "COMPLETED" || job.status === "DELIVERED",
    billings: job.billings.map((b) => ({
      kind: b.kind,
      amount: n(b.amount),
      advanceAdjusted: n(b.advanceAdjusted),
    })),
  });

const stageDto = (s: Stage) => ({
  id: s.id,
  seq: s.seq,
  name: s.name,
  weight: s.weight,
  plannedStart: isoOrNull(s.plannedStart),
  plannedEnd: isoOrNull(s.plannedEnd),
  actualStart: isoOrNull(s.actualStart),
  actualEnd: isoOrNull(s.actualEnd),
  status: s.status,
  remarks: s.remarks,
});

const costDto = (c: Cost) => ({
  id: c.id,
  type: c.type,
  costDate: iso(c.costDate),
  description: c.description,
  qty: n(c.qty),
  uom: c.uom,
  rate: n(c.rate),
  amount: n(c.amount),
  rawMaterialId: c.rawMaterialId,
  stockIssueId: c.stockIssueId?.toString() ?? null,
  employeeId: c.employeeId?.toString() ?? null,
  vendorName: c.vendorName,
  status: c.status,
});

const billingDto = (b: Billing) => ({
  id: b.id,
  kind: b.kind,
  billDate: iso(b.billDate),
  amount: n(b.amount),
  advanceAdjusted: n(b.advanceAdjusted),
  stageId: b.stageId,
  salesInvoiceId: b.salesInvoiceId,
  reference: b.reference,
  remarks: b.remarks,
});

const headerDto = (job: Job) => ({
  id: job.id,
  jobNo: job.jobNo,
  customerId: job.customerId,
  customerName: job.customer?.firmName ?? null,
  title: job.title,
  description: job.description,
  quotedAmount: n(job.quotedAmount),
  quoteDate: iso(job.quoteDate),
  targetDate: isoOrNull(job.targetDate),
  chassisNo: job.chassisNo,
  chassisMake: job.chassisMake,
  chassisReceivedOn: isoOrNull(job.chassisReceivedOn),
  conditionNotes: job.conditionNotes,
  status: job.status,
  stageCount: job.stages.length,
  currentStage:
    job.stages.find((s) => s.status === "IN_PROGRESS")?.name ??
    job.stages.find((s) => s.status === "PENDING")?.name ??
    null,
  summary: summaryOf(job),
});

const LOCKED: JobStatus[] = ["CANCELLED", "DELIVERED"];

class ProjectJobsService {
  stagePlans() {
    return Object.values(STAGE_PLANS);
  }

  private async load(id: string): Promise<Job> {
    const job = await prisma.projectJob.findFirst({ where: { id }, include });
    if (!job) throw new ApiError(404, "That job does not exist");
    return job;
  }

  private assertOpen(job: Job, what: string) {
    if (LOCKED.includes(job.status)) {
      throw new ApiError(
        409,
        `This job is ${job.status.toLowerCase()}; ${what} is no longer possible`
      );
    }
  }

  async list(q: z.infer<typeof listQuery>) {
    const where: Prisma.ProjectJobWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.q) {
      where.OR = [
        { jobNo: { contains: q.q, mode: "insensitive" } },
        { title: { contains: q.q, mode: "insensitive" } },
        { chassisNo: { contains: q.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.projectJob.findMany({
      where,
      include,
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    });
    return rows.map(headerDto);
  }

  async get(id: string) {
    const job = await this.load(id);
    return {
      ...headerDto(job),
      stages: job.stages.map(stageDto),
      costs: job.costs.map(costDto),
      billings: job.billings.map(billingDto),
    };
  }

  async summary(id: string) {
    const job = await this.load(id);
    const s = summaryOf(job);
    return { id: job.id, jobNo: job.jobNo, status: job.status, ...s };
  }

  async create(body: z.infer<typeof createBody>, actor: Actor) {
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId },
      select: { id: true },
    });
    if (!customer) throw new ApiError(404, "That customer does not exist");
    const clash = await prisma.projectJob.findFirst({
      where: { jobNo: body.jobNo },
      select: { id: true },
    });
    if (clash) throw new ApiError(409, "A job with that number already exists");

    const stages = STAGE_PLANS[body.stagePlan].stages;
    const created = await prisma.$transaction(async (tx) => {
      const job = await tx.projectJob.create({
        data: {
          jobNo: body.jobNo,
          customerId: body.customerId,
          title: body.title,
          description: body.description ?? null,
          quotedAmount: new Prisma.Decimal(body.quotedAmount),
          quoteDate: asDate(body.quoteDate),
          targetDate: body.targetDate ? asDate(body.targetDate) : null,
          chassisNo: body.chassisNo ?? null,
          chassisMake: body.chassisMake ?? null,
          chassisReceivedOn: body.chassisReceivedOn ? asDate(body.chassisReceivedOn) : null,
          conditionNotes: body.conditionNotes ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      if (stages.length > 0) {
        await tx.projectJobStage.createMany({
          data: stages.map((name, i) => ({
            companyId: job.companyId,
            jobId: job.id,
            seq: i + 1,
            name,
          })),
        });
      }
      return job;
    });
    return this.get(created.id);
  }

  async update(id: string, body: z.infer<typeof updateBody>) {
    const job = await this.load(id);
    if (body.status && !canMoveStatus(job.status, body.status)) {
      throw new ApiError(
        409,
        `A ${job.status.toLowerCase()} job cannot move to ${body.status.toLowerCase()}`
      );
    }
    if (!body.status || body.status === job.status) {
      this.assertOpen(job, "editing");
    }
    const quoteDate = body.quoteDate ? asDate(body.quoteDate) : job.quoteDate;
    const targetDate = body.targetDate !== undefined ? dateOrNull(body.targetDate) : job.targetDate;
    if (targetDate && targetDate.getTime() < quoteDate.getTime()) {
      throw new ApiError(400, "The target date must be on or after the quote date");
    }
    await prisma.projectJob.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.quotedAmount !== undefined
          ? { quotedAmount: new Prisma.Decimal(body.quotedAmount) }
          : {}),
        ...(body.quoteDate ? { quoteDate } : {}),
        ...(body.targetDate !== undefined ? { targetDate } : {}),
        ...(body.chassisNo !== undefined ? { chassisNo: body.chassisNo } : {}),
        ...(body.chassisMake !== undefined ? { chassisMake: body.chassisMake } : {}),
        ...(body.chassisReceivedOn !== undefined
          ? { chassisReceivedOn: dateOrNull(body.chassisReceivedOn) }
          : {}),
        ...(body.conditionNotes !== undefined ? { conditionNotes: body.conditionNotes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    });
    return this.get(id);
  }

  /**
   * Hard delete only while the job has no cost and no billing (a quote entered by mistake);
   * after that the job is cancelled instead so the spend stays on record.
   */
  async remove(id: string) {
    const job = await this.load(id);
    if (job.costs.length > 0 || job.billings.length > 0) {
      throw new ApiError(
        409,
        "This job already has costs or billing; cancel it instead of deleting it"
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.projectJobStage.deleteMany({ where: { jobId: id } });
      await tx.projectJob.delete({ where: { id } });
    });
    return { id, deleted: true };
  }

  // ─── stages ────────────────────────────────────────────────────────────────

  async addStage(id: string, body: z.infer<typeof addStageBody>) {
    const job = await this.load(id);
    this.assertOpen(job, "changing the stage plan");
    const seq = job.stages.reduce((max, s) => Math.max(max, s.seq), 0) + 1;
    await prisma.projectJobStage.create({
      data: {
        companyId: job.companyId,
        jobId: job.id,
        seq,
        name: body.name,
        weight: body.weight ?? 1,
        plannedStart: body.plannedStart ? asDate(body.plannedStart) : null,
        plannedEnd: body.plannedEnd ? asDate(body.plannedEnd) : null,
        remarks: body.remarks ?? null,
      },
    });
    return this.get(id);
  }

  async updateStage(id: string, stageId: string, body: z.infer<typeof updateStageBody>) {
    const job = await this.load(id);
    this.assertOpen(job, "changing the stage plan");
    const stage = job.stages.find((s) => s.id === stageId);
    if (!stage) throw new ApiError(404, "That stage does not exist");

    const status = body.status ?? stage.status;
    const pick = (v: string | null | undefined, cur: Date | null) =>
      v === undefined ? cur : dateOrNull(v)!;
    const plannedStart = pick(body.plannedStart, stage.plannedStart);
    const plannedEnd = pick(body.plannedEnd, stage.plannedEnd);
    let actualStart = pick(body.actualStart, stage.actualStart);
    let actualEnd = pick(body.actualEnd, stage.actualEnd);
    if (status === "PENDING" && body.status) {
      actualStart = body.actualStart ? actualStart : null;
      actualEnd = null;
    }
    if (status === "DONE" && !actualEnd) {
      throw new ApiError(400, "A finished stage needs its actual end date");
    }
    if (status === "DONE" && !actualStart) actualStart = actualEnd;
    if (plannedStart && plannedEnd && plannedEnd < plannedStart) {
      throw new ApiError(400, "The planned end must be on or after the planned start");
    }
    if (actualStart && actualEnd && actualEnd < actualStart) {
      throw new ApiError(400, "The actual end must be on or after the actual start");
    }
    await prisma.$transaction(async (tx) => {
      await tx.projectJobStage.update({
        where: { id: stage.id },
        data: {
          status,
          plannedStart,
          plannedEnd,
          actualStart,
          actualEnd,
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.weight !== undefined ? { weight: body.weight } : {}),
          ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
        },
      });
      // Work on a stage starts the job.
      if (job.status === "QUOTED" && (status === "IN_PROGRESS" || status === "DONE")) {
        await tx.projectJob.update({ where: { id: job.id }, data: { status: "IN_PROGRESS" } });
      }
    });
    return this.get(id);
  }

  /** New order for every stage of the job; seqs are rewritten 1..n in one transaction. */
  async reorderStages(id: string, body: z.infer<typeof reorderBody>) {
    const job = await this.load(id);
    this.assertOpen(job, "changing the stage plan");
    let seqs: Map<string, number>;
    try {
      seqs = reorderSeqs(
        job.stages.map((s) => s.id),
        body.stageIds
      );
    } catch {
      throw new ApiError(400, "Send every stage of this job exactly once");
    }
    await prisma.$transaction(async (tx) => {
      // Park the seqs out of the way first: (jobId, seq) is unique.
      for (const s of job.stages) {
        await tx.projectJobStage.update({ where: { id: s.id }, data: { seq: -s.seq } });
      }
      for (const [stageId, seq] of seqs) {
        await tx.projectJobStage.update({ where: { id: stageId }, data: { seq } });
      }
    });
    return this.get(id);
  }

  // ─── costs ─────────────────────────────────────────────────────────────────

  /** Append a cost line. Material may point to a raw material and/or a stock issue (tenant-checked). */
  async addCost(id: string, body: z.infer<typeof addCostBody>, actor: Actor) {
    const job = await this.load(id);
    this.assertOpen(job, "booking cost");

    let rawMaterialId = body.rawMaterialId ?? null;
    let qty = body.qty;
    let rate = body.rate;
    let uom = body.uom ?? null;

    if (body.stockIssueId !== undefined) {
      const issue = await prisma.rawMaterialTransaction.findFirst({
        where: { rmTxnId: body.stockIssueId },
        select: { rmTxnId: true, txnType: true, qty: true, rawMaterialId: true },
      });
      if (!issue || !issue.txnType.toUpperCase().endsWith("ISSUE")) {
        throw new ApiError(404, "That stock issue does not exist");
      }
      const already = await prisma.projectJobCost.findFirst({
        where: { stockIssueId: issue.rmTxnId },
        select: { id: true },
      });
      if (already) throw new ApiError(409, "That stock issue is already costed to a job");
      const rm = await prisma.rawMaterial.findFirst({
        where: { rawMaterialId: issue.rawMaterialId },
        select: { id: true },
      });
      if (rawMaterialId && rm && rm.id !== rawMaterialId) {
        throw new ApiError(400, "The stock issue is for a different raw material");
      }
      rawMaterialId = rawMaterialId ?? rm?.id ?? null;
      qty = qty ?? Math.abs(Number(issue.qty));
    }

    if (rawMaterialId) {
      const rm = await prisma.rawMaterial.findFirst({
        where: { id: rawMaterialId },
        select: { id: true, rate: true, baseUom: true },
      });
      if (!rm) throw new ApiError(404, "That raw material does not exist");
      if (rate === undefined) {
        if (rm.rate == null) throw new ApiError(400, "This raw material has no rate; enter it");
        rate = Number(rm.rate);
      }
      uom = uom ?? rm.baseUom;
    }

    if (body.employeeId !== undefined) {
      const emp = await prisma.employee.findFirst({
        where: { id: body.employeeId },
        select: { id: true },
      });
      if (!emp) throw new ApiError(404, "That employee does not exist");
    }
    if (body.type === "LABOUR") uom = uom ?? "HRS";

    const q = qty ?? 1;
    const r = rate ?? 0;
    await prisma.projectJobCost.create({
      data: {
        companyId: job.companyId,
        jobId: job.id,
        type: body.type,
        costDate: asDate(body.costDate),
        description: body.description,
        qty: new Prisma.Decimal(q),
        uom,
        rate: new Prisma.Decimal(r),
        amount: new Prisma.Decimal(lineAmount(q, r)),
        rawMaterialId,
        stockIssueId: body.stockIssueId ?? null,
        employeeId: body.employeeId ?? null,
        vendorName: body.vendorName ?? null,
        status: body.post ? "POSTED" : "DRAFT",
        createdBy: actor.userId ?? null,
      },
    });
    return this.get(id);
  }

  /** Lock DRAFT cost lines (all of them, or the ids given); posted lines cannot be removed. */
  async postCosts(id: string, body: z.infer<typeof postCostsBody>) {
    const job = await this.load(id);
    this.assertOpen(job, "posting cost");
    const ids = body.costIds ?? job.costs.filter((c) => c.status === "DRAFT").map((c) => c.id);
    const own = new Set(job.costs.map((c) => c.id));
    if (ids.some((c) => !own.has(c))) throw new ApiError(404, "That cost line does not exist");
    await prisma.projectJobCost.updateMany({
      where: { id: { in: ids }, jobId: job.id, status: "DRAFT" },
      data: { status: "POSTED" },
    });
    return this.get(id);
  }

  async removeCost(id: string, costId: string) {
    const job = await this.load(id);
    this.assertOpen(job, "removing cost");
    const cost = job.costs.find((c) => c.id === costId);
    if (!cost) throw new ApiError(404, "That cost line does not exist");
    if (cost.status !== "DRAFT") {
      throw new ApiError(409, "A posted cost line cannot be removed");
    }
    await prisma.projectJobCost.delete({ where: { id: cost.id } });
    return this.get(id);
  }

  // ─── billing ───────────────────────────────────────────────────────────────

  async addBilling(id: string, body: z.infer<typeof addBillingBody>, actor: Actor) {
    const job = await this.load(id);
    if (job.status === "CANCELLED") {
      throw new ApiError(409, "This job is cancelled; billing is no longer possible");
    }
    if (body.stageId && !job.stages.some((s) => s.id === body.stageId)) {
      throw new ApiError(404, "That stage does not exist");
    }
    if (body.salesInvoiceId) {
      const inv = await prisma.salesInvoice.findFirst({
        where: { id: body.salesInvoiceId },
        select: { id: true, customerId: true },
      });
      if (!inv) throw new ApiError(404, "That sales invoice does not exist");
      if (inv.customerId && inv.customerId !== job.customerId) {
        throw new ApiError(400, "That sales invoice is for a different customer");
      }
    }
    const adjusted = body.advanceAdjusted ?? 0;
    if (adjusted > 0) {
      const { advanceBalance } = summaryOf(job);
      if (adjusted > advanceBalance + 1e-9) {
        throw new ApiError(
          400,
          `Only ${advanceBalance.toFixed(2)} of advance is left to adjust on this job`
        );
      }
    }
    await prisma.projectJobBilling.create({
      data: {
        companyId: job.companyId,
        jobId: job.id,
        kind: body.kind,
        billDate: asDate(body.billDate),
        amount: new Prisma.Decimal(body.amount),
        advanceAdjusted: new Prisma.Decimal(adjusted),
        stageId: body.stageId ?? null,
        salesInvoiceId: body.salesInvoiceId ?? null,
        reference: body.reference ?? null,
        remarks: body.remarks ?? null,
        createdBy: actor.userId ?? null,
      },
    });
    return this.get(id);
  }
}

export const projectJobsService = new ProjectJobsService();
