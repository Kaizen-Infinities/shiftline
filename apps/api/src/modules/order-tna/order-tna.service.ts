import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  TNA_TEMPLATES,
  addDays,
  asDate,
  daysBetween,
  delayDays,
  generateMilestones,
  iso,
  shiftOpenMilestones,
  summarise,
  type TnaTemplateKey,
} from "./order-tna.calc";
import type { z } from "zod";
import type {
  addMilestoneBody,
  alertsQuery,
  createBody,
  listQuery,
  updateBody,
  updateMilestoneBody,
} from "./order-tna.validation";

/**
 * Export order time-and-action calendar (TN-03). Every query goes through the tenant-scoped
 * client from `lib/prisma.ts`, so a foreign company's orders are invisible (and 404) here.
 */
type Actor = { userId?: string };
type Milestone = Prisma.OrderTnaMilestoneGetPayload<object>;
type TnaWithMilestones = Prisma.OrderTnaGetPayload<{
  include: { milestones: true; customer: { select: { id: true; firmName: true } } };
}>;

const today = () => asDate(new Date());

const milestoneDto = (m: Milestone) => ({
  id: m.id,
  seq: m.seq,
  name: m.name,
  plannedDate: iso(m.plannedDate),
  actualDate: m.actualDate ? iso(m.actualDate) : null,
  status: m.status,
  owner: m.owner,
  remarks: m.remarks,
  delayDays: delayDays(m),
});

const headerDto = (t: TnaWithMilestones) => ({
  id: t.id,
  tnaNo: t.tnaNo,
  customerId: t.customerId,
  customerName: t.customer?.firmName ?? null,
  salesOrderId: t.salesOrderId,
  buyerPoNo: t.buyerPoNo,
  styleRef: t.styleRef,
  description: t.description,
  orderQty: Number(t.orderQty),
  uom: t.uom,
  orderDate: iso(t.orderDate),
  exFactoryDate: iso(t.exFactoryDate),
  template: t.template,
  merchandiser: t.merchandiser,
  status: t.status,
  ...summarise(t.milestones, today()),
});

const include = {
  milestones: { orderBy: { seq: "asc" } },
  customer: { select: { id: true, firmName: true } },
} as const;

class OrderTnaService {
  templates() {
    return Object.values(TNA_TEMPLATES);
  }

  private async load(id: string): Promise<TnaWithMilestones> {
    const tna = await prisma.orderTna.findFirst({ where: { id }, include });
    if (!tna) throw new ApiError(404, "That T&A plan does not exist");
    return tna;
  }

  async list(q: z.infer<typeof listQuery>) {
    const where: Prisma.OrderTnaWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.from || q.to) {
      where.exFactoryDate = {
        ...(q.from ? { gte: asDate(q.from) } : {}),
        ...(q.to ? { lte: asDate(q.to) } : {}),
      };
    }
    const rows = await prisma.orderTna.findMany({
      where,
      include,
      orderBy: [{ exFactoryDate: "asc" }, { tnaNo: "asc" }],
      take: 500,
    });
    return rows.map(headerDto);
  }

  async get(id: string) {
    const tna = await this.load(id);
    return { ...headerDto(tna), milestones: tna.milestones.map(milestoneDto) };
  }

  async create(body: z.infer<typeof createBody>, actor: Actor) {
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId },
      select: { id: true },
    });
    if (!customer) throw new ApiError(404, "That buyer does not exist");
    if (body.salesOrderId !== undefined) {
      const so = await prisma.salesOrder.findFirst({
        where: { id: body.salesOrderId },
        select: { id: true },
      });
      if (!so) throw new ApiError(404, "That sales order does not exist");
    }
    const tnaNo = (body.tnaNo ?? `${body.buyerPoNo}-${body.styleRef}`).slice(0, 30);
    const clash = await prisma.orderTna.findFirst({ where: { tnaNo }, select: { id: true } });
    if (clash) throw new ApiError(409, "A T&A plan with that number already exists");

    const orderDate = asDate(body.orderDate);
    const exFactoryDate = asDate(body.exFactoryDate);
    const planned = generateMilestones(body.template, orderDate, exFactoryDate);

    const created = await prisma.$transaction(async (tx) => {
      const tna = await tx.orderTna.create({
        data: {
          tnaNo,
          customerId: body.customerId,
          salesOrderId: body.salesOrderId ?? null,
          buyerPoNo: body.buyerPoNo,
          styleRef: body.styleRef,
          description: body.description ?? null,
          orderQty: new Prisma.Decimal(body.orderQty),
          uom: body.uom ?? null,
          orderDate,
          exFactoryDate,
          template: body.template satisfies TnaTemplateKey,
          merchandiser: body.merchandiser ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      await tx.orderTnaMilestone.createMany({
        data: planned.map((m) => ({
          companyId: tna.companyId,
          tnaId: tna.id,
          seq: m.seq,
          name: m.name,
          plannedDate: m.plannedDate,
        })),
      });
      return tna;
    });
    return this.get(created.id);
  }

  /** Header changes; a new ex-factory date shifts every PENDING milestone in one transaction. */
  async update(id: string, body: z.infer<typeof updateBody>) {
    const tna = await this.load(id);
    const newExFactory = body.exFactoryDate ? asDate(body.exFactoryDate) : null;
    if (newExFactory && newExFactory.getTime() < tna.orderDate.getTime()) {
      throw new ApiError(400, "The ex-factory date must be on or after the order date");
    }
    await prisma.$transaction(async (tx) => {
      if (newExFactory) {
        for (const { milestone, plannedDate } of shiftOpenMilestones(
          tna.milestones,
          tna.exFactoryDate,
          newExFactory
        )) {
          await tx.orderTnaMilestone.update({ where: { id: milestone.id }, data: { plannedDate } });
        }
      }
      await tx.orderTna.update({
        where: { id },
        data: {
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.orderQty !== undefined ? { orderQty: new Prisma.Decimal(body.orderQty) } : {}),
          ...(body.uom !== undefined ? { uom: body.uom } : {}),
          ...(body.merchandiser !== undefined ? { merchandiser: body.merchandiser } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(newExFactory ? { exFactoryDate: newExFactory } : {}),
        },
      });
    });
    return this.get(id);
  }

  /** A custom milestone; `seq` is the current maximum + 1. */
  async addMilestone(id: string, body: z.infer<typeof addMilestoneBody>) {
    const tna = await this.load(id);
    const seq = tna.milestones.reduce((max, m) => Math.max(max, m.seq), 0) + 1;
    await prisma.orderTnaMilestone.create({
      data: {
        companyId: tna.companyId,
        tnaId: tna.id,
        seq,
        name: body.name,
        plannedDate: asDate(body.plannedDate),
        owner: body.owner ?? null,
        remarks: body.remarks ?? null,
      },
    });
    return this.get(id);
  }

  async updateMilestone(
    id: string,
    milestoneId: string,
    body: z.infer<typeof updateMilestoneBody>
  ) {
    const tna = await this.load(id);
    const milestone = tna.milestones.find((m) => m.id === milestoneId);
    if (!milestone) throw new ApiError(404, "That milestone does not exist");
    const status = body.status ?? milestone.status;
    const actualDate =
      body.actualDate !== undefined
        ? body.actualDate
          ? asDate(body.actualDate)
          : null
        : milestone.actualDate;
    if (status === "DONE" && !actualDate) {
      throw new ApiError(400, "A done milestone needs its actual date");
    }
    await prisma.orderTnaMilestone.update({
      where: { id: milestone.id },
      data: {
        status,
        actualDate: status === "PENDING" && body.actualDate === undefined ? null : actualDate,
        ...(body.plannedDate ? { plannedDate: asDate(body.plannedDate) } : {}),
        ...(body.owner !== undefined ? { owner: body.owner } : {}),
        ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
      },
    });
    return this.get(id);
  }

  /** Overdue and due-within-`days` PENDING milestones across ACTIVE orders. */
  async alerts(q: z.infer<typeof alertsQuery>) {
    const t = today();
    const rows = await prisma.orderTnaMilestone.findMany({
      where: {
        status: "PENDING",
        plannedDate: { lte: addDays(t, q.days) },
        tna: { status: "ACTIVE" },
      },
      include: {
        tna: {
          select: {
            id: true,
            tnaNo: true,
            buyerPoNo: true,
            styleRef: true,
            exFactoryDate: true,
            customer: { select: { firmName: true } },
          },
        },
      },
      orderBy: [{ plannedDate: "asc" }, { seq: "asc" }],
      take: 500,
    });
    return rows.map((m) => {
      const d = daysBetween(t, m.plannedDate);
      return {
        tnaId: m.tna.id,
        tnaNo: m.tna.tnaNo,
        buyerPoNo: m.tna.buyerPoNo,
        styleRef: m.tna.styleRef,
        customerName: m.tna.customer?.firmName ?? null,
        exFactoryDate: iso(m.tna.exFactoryDate),
        milestoneId: m.id,
        milestone: m.name,
        plannedDate: iso(m.plannedDate),
        kind: d < 0 ? ("OVERDUE" as const) : ("DUE_SOON" as const),
        daysLate: d < 0 ? -d : 0,
      };
    });
  }
}

export const orderTnaService = new OrderTnaService();
