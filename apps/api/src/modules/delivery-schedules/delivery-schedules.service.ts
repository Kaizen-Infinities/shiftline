import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { adherence, dueDateInWindow, lineMetrics, type CalcLine } from "./delivery-schedules.calc";
import type {
  CreateScheduleInput,
  DispatchInput,
  LineInput,
  UpdateLineInput,
  UpdateScheduleInput,
} from "./delivery-schedules.validation";

/**
 * Customer delivery schedules (TN-02): an OEM's monthly or weekly schedule against an open PO,
 * the dispatches booked against each line, and the adherence / OTIF rating the OEM will compute
 * from them. Every read and write goes through the tenant-scoped client; customer, product and
 * sales invoice ids are looked up with `findFirst` before they are stored, so a foreign id is a
 * 404 and never a link.
 */
type Tx = Prisma.TransactionClient;

const asDate = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);
const monthStart = (v: string) => new Date(`${v}-01T00:00:00Z`);
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => asDate(new Date().toISOString());
const num = (v: unknown) => Number(v ?? 0);

const lineInclude = { dispatches: { orderBy: { dispatchDate: "asc" as const } } };

type LineRow = Prisma.CustomerScheduleLineGetPayload<{ include: typeof lineInclude }>;

const toCalc = (l: LineRow): CalcLine => ({
  dueDate: l.dueDate,
  firmness: l.firmness,
  scheduledQty: num(l.scheduledQty),
  dispatches: l.dispatches.map((d) => ({ dispatchDate: d.dispatchDate, qty: num(d.qty) })),
});

const lineView = (l: LineRow, asOf: Date) => ({
  id: l.id,
  customerPartNo: l.customerPartNo,
  description: l.description,
  productId: l.productId === null ? null : String(l.productId),
  dueDate: iso(l.dueDate),
  firmness: l.firmness,
  scheduledQty: num(l.scheduledQty),
  dispatches: l.dispatches.map((d) => ({
    id: d.id,
    dispatchDate: iso(d.dispatchDate),
    qty: num(d.qty),
    salesInvoiceId: d.salesInvoiceId,
    invoiceNo: d.invoiceNo,
    asnNo: d.asnNo,
  })),
  metrics: lineMetrics(toCalc(l), asOf),
});

class DeliveryScheduleService {
  // ── Lookups ────────────────────────────────────────────────────────────────
  private async customer(customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, firmName: true, displayName: true },
    });
    if (!customer) throw new ApiError(404, "That customer does not exist");
    return customer;
  }

  private async assertProducts(lines: { productId?: string }[]) {
    const ids = [...new Set(lines.map((l) => l.productId).filter((v): v is string => !!v))];
    for (const id of ids) {
      const product = await prisma.product.findFirst({
        where: { id: BigInt(id) },
        select: { id: true },
      });
      if (!product) throw new ApiError(404, "That product does not exist");
    }
  }

  private assertWindow(periodMonth: Date, lines: { dueDate?: string }[]) {
    for (const l of lines) {
      if (l.dueDate && !dueDateInWindow(periodMonth, asDate(l.dueDate))) {
        throw new ApiError(
          400,
          "A due date must fall within the schedule month or 45 days either side of it",
          "DUE_DATE_OUT_OF_WINDOW"
        );
      }
    }
  }

  private async schedule(id: string) {
    const schedule = await prisma.customerSchedule.findFirst({ where: { id } });
    if (!schedule) throw new ApiError(404, "That delivery schedule does not exist");
    return schedule;
  }

  private async line(lineId: string) {
    const line = await prisma.customerScheduleLine.findFirst({
      where: { id: lineId },
      include: { schedule: { select: { id: true, periodMonth: true, status: true } } },
    });
    if (!line) throw new ApiError(404, "That schedule line does not exist");
    return line;
  }

  private assertOpen(status: string) {
    if (status !== "OPEN") {
      throw new ApiError(409, "Only an open schedule can be changed", "SCHEDULE_NOT_OPEN");
    }
  }

  private async assertUniqueNo(scheduleNo: string, revision: number, exceptId?: string) {
    const clash = await prisma.customerSchedule.findFirst({
      where: { scheduleNo, revision, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) {
      throw new ApiError(
        409,
        "A schedule with this number and revision already exists",
        "DUPLICATE_SCHEDULE"
      );
    }
  }

  private lineData(scheduleId: string, l: LineInput) {
    return {
      companyId: requireTenantId(),
      scheduleId,
      customerPartNo: l.customerPartNo,
      description: l.description ?? null,
      productId: l.productId ? BigInt(l.productId) : null,
      dueDate: asDate(l.dueDate),
      firmness: l.firmness ?? "FIRM",
      scheduledQty: new Prisma.Decimal(l.scheduledQty),
    };
  }

  // ── Schedules ──────────────────────────────────────────────────────────────
  async list(q: { customerId?: string; month?: string; status?: "OPEN" | "CLOSED" | "CANCELLED" }) {
    const rows = await prisma.customerSchedule.findMany({
      where: {
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.month ? { periodMonth: monthStart(q.month) } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      include: {
        customer: { select: { firmName: true, displayName: true } },
        lines: { include: lineInclude },
      },
      orderBy: [{ periodMonth: "desc" }, { scheduleNo: "asc" }, { revision: "desc" }],
      take: 500,
    });
    const asOf = today();
    return rows.map((s) => {
      const totals = adherence(s.lines.map(toCalc), asOf);
      return {
        id: s.id,
        scheduleNo: s.scheduleNo,
        revision: s.revision,
        customerId: s.customerId,
        customerName: s.customer.displayName || s.customer.firmName,
        customerPoNo: s.customerPoNo,
        periodMonth: iso(s.periodMonth).slice(0, 7),
        receivedOn: iso(s.receivedOn),
        status: s.status,
        lineCount: s.lines.length,
        adherencePct: totals.adherencePct,
        otifPct: totals.otifPct,
      };
    });
  }

  async get(id: string, asOf = today()) {
    const s = await prisma.customerSchedule.findFirst({
      where: { id },
      include: {
        customer: { select: { firmName: true, displayName: true } },
        lines: { include: lineInclude, orderBy: [{ dueDate: "asc" }, { customerPartNo: "asc" }] },
      },
    });
    if (!s) throw new ApiError(404, "That delivery schedule does not exist");
    return {
      id: s.id,
      scheduleNo: s.scheduleNo,
      revision: s.revision,
      customerId: s.customerId,
      customerName: s.customer.displayName || s.customer.firmName,
      customerPoNo: s.customerPoNo,
      periodMonth: iso(s.periodMonth).slice(0, 7),
      receivedOn: iso(s.receivedOn),
      status: s.status,
      notes: s.notes,
      lines: s.lines.map((l) => lineView(l, asOf)),
      totals: adherence(s.lines.map(toCalc), asOf),
    };
  }

  async create(body: CreateScheduleInput, actor: { userId?: string }) {
    await this.customer(body.customerId);
    const periodMonth = monthStart(body.periodMonth);
    this.assertWindow(periodMonth, body.lines);
    await this.assertProducts(body.lines);
    const revision = body.revision ?? 0;
    await this.assertUniqueNo(body.scheduleNo, revision);

    const id = await prisma.$transaction(async (tx: Tx) => {
      const created = await tx.customerSchedule.create({
        data: {
          companyId: requireTenantId(),
          scheduleNo: body.scheduleNo,
          customerId: body.customerId,
          customerPoNo: body.customerPoNo ?? null,
          periodMonth,
          receivedOn: asDate(body.receivedOn),
          revision,
          notes: body.notes ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      if (body.lines.length > 0) {
        await tx.customerScheduleLine.createMany({
          data: body.lines.map((l) => this.lineData(created.id, l)),
        });
      }
      return created.id;
    });
    return this.get(id);
  }

  async update(id: string, body: UpdateScheduleInput) {
    const current = await this.schedule(id);
    const scheduleNo = body.scheduleNo ?? current.scheduleNo;
    const revision = body.revision ?? current.revision;
    if (scheduleNo !== current.scheduleNo || revision !== current.revision) {
      await this.assertUniqueNo(scheduleNo, revision, id);
    }
    await prisma.customerSchedule.update({
      where: { id: current.id },
      data: {
        scheduleNo,
        revision,
        ...(body.customerPoNo !== undefined ? { customerPoNo: body.customerPoNo } : {}),
        ...(body.receivedOn ? { receivedOn: asDate(body.receivedOn) } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
    return this.get(id);
  }

  // ── Lines ──────────────────────────────────────────────────────────────────
  async addLines(id: string, lines: LineInput[]) {
    const schedule = await this.schedule(id);
    this.assertOpen(schedule.status);
    this.assertWindow(schedule.periodMonth, lines);
    await this.assertProducts(lines);
    await prisma.customerScheduleLine.createMany({
      data: lines.map((l) => this.lineData(schedule.id, l)),
    });
    return this.get(id);
  }

  async updateLine(lineId: string, body: UpdateLineInput) {
    const line = await this.line(lineId);
    this.assertOpen(line.schedule.status);
    this.assertWindow(line.schedule.periodMonth, [body]);
    await this.assertProducts([body]);
    await prisma.customerScheduleLine.update({
      where: { id: line.id },
      data: {
        ...(body.customerPartNo !== undefined ? { customerPartNo: body.customerPartNo } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.productId !== undefined ? { productId: BigInt(body.productId) } : {}),
        ...(body.dueDate ? { dueDate: asDate(body.dueDate) } : {}),
        ...(body.firmness ? { firmness: body.firmness } : {}),
        ...(body.scheduledQty !== undefined
          ? { scheduledQty: new Prisma.Decimal(body.scheduledQty) }
          : {}),
      },
    });
    return this.get(line.schedule.id);
  }

  async deleteLine(lineId: string) {
    const line = await this.line(lineId);
    this.assertOpen(line.schedule.status);
    const dispatched = await prisma.customerScheduleDispatch.count({ where: { lineId: line.id } });
    if (dispatched > 0) {
      throw new ApiError(
        409,
        "This line has dispatches against it; remove them first",
        "LINE_HAS_DISPATCHES"
      );
    }
    await prisma.customerScheduleLine.delete({ where: { id: line.id } });
    return { id: line.id };
  }

  // ── Dispatches ─────────────────────────────────────────────────────────────
  async addDispatch(lineId: string, body: DispatchInput, actor: { userId?: string }) {
    const line = await this.line(lineId);
    if (line.schedule.status === "CANCELLED") {
      throw new ApiError(409, "This schedule is cancelled", "SCHEDULE_CANCELLED");
    }
    let invoiceNo = body.invoiceNo ?? null;
    if (body.salesInvoiceId) {
      const invoice = await prisma.salesInvoice.findFirst({
        where: { id: body.salesInvoiceId },
        select: { id: true, invoiceNo: true },
      });
      if (!invoice) throw new ApiError(404, "That sales invoice does not exist");
      invoiceNo = invoiceNo ?? invoice.invoiceNo;
    }
    const dispatch = await prisma.customerScheduleDispatch.create({
      data: {
        companyId: requireTenantId(),
        lineId: line.id,
        dispatchDate: asDate(body.dispatchDate),
        qty: new Prisma.Decimal(body.qty),
        salesInvoiceId: body.salesInvoiceId ?? null,
        invoiceNo,
        asnNo: body.asnNo ?? null,
        createdBy: actor.userId ?? null,
      },
    });
    return { id: dispatch.id, schedule: await this.get(line.schedule.id) };
  }

  async deleteDispatch(dispatchId: string) {
    const dispatch = await prisma.customerScheduleDispatch.findFirst({
      where: { id: dispatchId },
      select: { id: true },
    });
    if (!dispatch) throw new ApiError(404, "That dispatch does not exist");
    await prisma.customerScheduleDispatch.delete({ where: { id: dispatch.id } });
    return { id: dispatch.id };
  }

  // ── Planner and rating ────────────────────────────────────────────────────
  /** Open FIRM lines due within `days` (and overdue ones from the last 31 days) still owed. */
  async due(days: number, asOfStr?: string) {
    const asOf = asOfStr ? asDate(asOfStr) : today();
    const until = new Date(asOf.getTime() + days * 86_400_000);
    const since = new Date(asOf.getTime() - 31 * 86_400_000);
    const lines = await prisma.customerScheduleLine.findMany({
      where: {
        firmness: "FIRM",
        dueDate: { gte: since, lte: until },
        schedule: { status: "OPEN" },
      },
      include: {
        ...lineInclude,
        schedule: {
          select: {
            id: true,
            scheduleNo: true,
            revision: true,
            customer: { select: { id: true, firmName: true, displayName: true } },
          },
        },
      },
      orderBy: [{ dueDate: "asc" }, { customerPartNo: "asc" }],
      take: 1000,
    });
    return lines
      .map((l) => ({ l, m: lineMetrics(toCalc(l), asOf) }))
      .filter(({ m }) => m.remaining > 0)
      .map(({ l, m }) => ({
        lineId: l.id,
        scheduleId: l.schedule.id,
        scheduleNo: l.schedule.scheduleNo,
        revision: l.schedule.revision,
        customerId: l.schedule.customer.id,
        customerName: l.schedule.customer.displayName || l.schedule.customer.firmName,
        customerPartNo: l.customerPartNo,
        description: l.description,
        dueDate: iso(l.dueDate),
        scheduledQty: m.scheduled,
        dispatchedQty: m.dispatched,
        remainingQty: m.remaining,
        overdue: l.dueDate.getTime() < asOf.getTime(),
      }));
  }

  /**
   * Rows per customer × schedule month. Only the latest non-cancelled revision of each schedule
   * number counts, since a revision replaces the release it revises.
   */
  async adherence(q: { from: string; to: string; customerId?: string; asOf?: string }) {
    const from = monthStart(q.from);
    const to = monthStart(q.to);
    if (to < from) throw new ApiError(400, "The end month is before the start month");
    const asOf = q.asOf ? asDate(q.asOf) : today();
    const schedules = await prisma.customerSchedule.findMany({
      where: {
        periodMonth: { gte: from, lt: nextMonth(to) },
        status: { not: "CANCELLED" },
        ...(q.customerId ? { customerId: q.customerId } : {}),
      },
      include: {
        customer: { select: { firmName: true, displayName: true } },
        lines: { include: lineInclude },
      },
      orderBy: [{ revision: "desc" }],
      take: 2000,
    });
    const latest = new Map<string, (typeof schedules)[number]>();
    for (const s of schedules) {
      const key = `${s.customerId}|${s.scheduleNo}`;
      if (!latest.has(key)) latest.set(key, s);
    }
    const groups = new Map<
      string,
      { customerId: string; customerName: string; month: string; lines: CalcLine[] }
    >();
    for (const s of latest.values()) {
      const month = iso(s.periodMonth).slice(0, 7);
      const key = `${s.customerId}|${month}`;
      const g = groups.get(key) ?? {
        customerId: s.customerId,
        customerName: s.customer.displayName || s.customer.firmName,
        month,
        lines: [],
      };
      g.lines.push(...s.lines.map(toCalc));
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({
        customerId: g.customerId,
        customerName: g.customerName,
        month: g.month,
        ...adherence(g.lines, asOf),
      }))
      .sort(
        (a, b) => a.month.localeCompare(b.month) || a.customerName.localeCompare(b.customerName)
      );
  }
}

export const deliveryScheduleService = new DeliveryScheduleService();
