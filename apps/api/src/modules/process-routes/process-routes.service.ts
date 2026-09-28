import { Prisma } from "@prisma/client";
import type { z } from "zod";

import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  GAIN_TOLERANCE_PCT,
  ROUTE_TEMPLATES,
  STEP_NAME_PRESETS,
  checkMovement,
  checkRouteSteps,
  computeLot,
  sameUom,
  type LotProgress,
  type RouteStep,
} from "./process-route.calc";
import type {
  cancelLotBody,
  challanOptionsQuery,
  createLotBody,
  createRouteBody,
  lotListQuery,
  movementBody,
  replaceStepsBody,
  routeListQuery,
  stepBody,
  updateRouteBody,
} from "./process-routes.validation";

/**
 * Multi-step process routes (TN-06): the route master (ordered steps, in-house or at a job
 * worker, with a loss norm and a unit change) and the lots that travel it. A lot movement at a
 * job-work step can carry the delivery challan that moved it; the challan and its own return flow
 * (P2-08) are read, never changed. Every query goes through the tenant-scoped client, so another
 * company's route, lot, job worker, challan or product reads as absent (404).
 */
type Actor = { userId?: string };

const routeInclude = {
  product: { select: { id: true, productCode: true, productName: true } },
  steps: {
    orderBy: { seq: "asc" },
    include: { defaultJobWorker: { select: { id: true, code: true, name: true } } },
  },
  _count: { select: { lots: true } },
} satisfies Prisma.ProcessRouteInclude;

const lotInclude = {
  product: { select: { id: true, productCode: true, productName: true } },
  route: { include: { steps: { orderBy: { seq: "asc" } } } },
  movements: {
    orderBy: [{ movementDate: "asc" }, { createdAt: "asc" }],
    include: {
      jobWorker: { select: { id: true, code: true, name: true } },
      challan: { select: { id: true, challanNo: true, kind: true } },
    },
  },
} satisfies Prisma.LotRouteProgressInclude;

type Route = Prisma.ProcessRouteGetPayload<{ include: typeof routeInclude }>;
type Lot = Prisma.LotRouteProgressGetPayload<{ include: typeof lotInclude }>;
type StepInput = z.infer<typeof stepBody>;

const n = (d: Prisma.Decimal | null | undefined) => (d == null ? null : Number(d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

const productDto = (p: { id: bigint; productCode: string; productName: string } | null) =>
  p ? { id: p.id.toString(), code: p.productCode, name: p.productName } : null;

const routeDto = (r: Route) => ({
  id: r.id,
  routeCode: r.routeCode,
  name: r.name,
  description: r.description,
  product: productDto(r.product),
  active: r.active,
  lotCount: r._count.lots,
  locked: r._count.lots > 0,
  steps: r.steps.map((s) => ({
    id: s.id,
    seq: s.seq,
    name: s.name,
    mode: s.mode,
    defaultJobWorker: s.defaultJobWorker,
    lossNormPct: n(s.lossNormPct) ?? 0,
    uomIn: s.uomIn,
    uomOut: s.uomOut,
    conversionFactor: n(s.conversionFactor),
    remarks: s.remarks,
  })),
});

const routeSteps = (lot: Lot): RouteStep[] =>
  lot.route.steps.map((s) => ({
    id: s.id,
    seq: s.seq,
    name: s.name,
    mode: s.mode,
    uomIn: s.uomIn,
    uomOut: s.uomOut,
    factor: n(s.conversionFactor),
    lossNormPct: n(s.lossNormPct) ?? 0,
  }));

const progressOf = (lot: Lot): LotProgress =>
  computeLot(
    routeSteps(lot),
    { qty: Number(lot.inputQty), status: lot.status },
    lot.movements.map((m) => ({
      stepSeq: m.stepSeq,
      direction: m.direction,
      qty: Number(m.qty),
      jobWorkerId: m.jobWorkerId,
      date: iso(m.movementDate),
      closesStep: m.closesStep,
    }))
  );

class ProcessRoutesService {
  // ─── options ───────────────────────────────────────────────────────────────

  async options() {
    const [workers, products] = await Promise.all([
      prisma.jobWorker.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, processType: true },
        orderBy: { name: "asc" },
        take: 500,
      }),
      prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, productCode: true, productName: true },
        orderBy: { productName: "asc" },
        take: 1000,
      }),
    ]);
    return {
      jobWorkers: workers,
      products: products.map((p) => productDto(p)),
      stepNames: STEP_NAME_PRESETS,
      templates: ROUTE_TEMPLATES,
      gainTolerancePct: GAIN_TOLERANCE_PCT,
    };
  }

  // ─── routes ────────────────────────────────────────────────────────────────

  private async loadRoute(id: string): Promise<Route> {
    const route = await prisma.processRoute.findFirst({ where: { id }, include: routeInclude });
    if (!route) throw new ApiError(404, "That process route does not exist");
    return route;
  }

  private async assertProduct(productId: bigint | null | undefined) {
    if (productId == null) return;
    const p = await prisma.product.findFirst({ where: { id: productId }, select: { id: true } });
    if (!p) throw new ApiError(404, "That product does not exist");
  }

  /** Unit chain, in-house without a worker, and every default job worker is this tenant's. */
  private async assertSteps(steps: StepInput[]) {
    const problem = checkRouteSteps(steps);
    if (problem) throw new ApiError(400, problem);
    const ids = [
      ...new Set(steps.map((s) => s.defaultJobWorkerId).filter((v): v is string => !!v)),
    ];
    if (ids.length === 0) return;
    const found = await prisma.jobWorker.findMany({
      where: { id: { in: ids } },
      select: { id: true, isActive: true, name: true },
    });
    if (found.length !== ids.length) throw new ApiError(404, "That job worker does not exist");
    const inactive = found.find((w) => !w.isActive);
    if (inactive) throw new ApiError(400, `${inactive.name} is inactive; pick another job worker`);
  }

  private stepRows(companyId: string, routeId: string, steps: StepInput[]) {
    return steps.map((s, i) => ({
      companyId,
      routeId,
      seq: i + 1,
      name: s.name,
      mode: s.mode,
      defaultJobWorkerId: s.defaultJobWorkerId ?? null,
      lossNormPct: new Prisma.Decimal(s.lossNormPct),
      uomIn: s.uomIn,
      uomOut: s.uomOut,
      conversionFactor:
        s.conversionFactor == null || sameUom(s.uomIn, s.uomOut)
          ? null
          : new Prisma.Decimal(s.conversionFactor),
      remarks: s.remarks ?? null,
    }));
  }

  async listRoutes(q: z.infer<typeof routeListQuery>) {
    const where: Prisma.ProcessRouteWhereInput = {};
    if (q.active) where.active = q.active === "true";
    if (q.q) {
      where.OR = [
        { routeCode: { contains: q.q, mode: "insensitive" } },
        { name: { contains: q.q, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.processRoute.findMany({
      where,
      include: routeInclude,
      orderBy: [{ active: "desc" }, { routeCode: "asc" }],
      take: 500,
    });
    return rows.map(routeDto);
  }

  async getRoute(id: string) {
    return routeDto(await this.loadRoute(id));
  }

  async createRoute(body: z.infer<typeof createRouteBody>, actor: Actor) {
    const clash = await prisma.processRoute.findFirst({
      where: { routeCode: body.routeCode },
      select: { id: true },
    });
    if (clash) throw new ApiError(409, "A route with that code already exists");
    await this.assertProduct(body.productId);
    await this.assertSteps(body.steps);
    const created = await prisma.$transaction(async (tx) => {
      const route = await tx.processRoute.create({
        data: {
          routeCode: body.routeCode,
          name: body.name,
          description: body.description ?? null,
          productId: body.productId ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      await tx.processRouteStep.createMany({
        data: this.stepRows(route.companyId, route.id, body.steps),
      });
      return route;
    });
    return this.getRoute(created.id);
  }

  async updateRoute(id: string, body: z.infer<typeof updateRouteBody>) {
    const route = await this.loadRoute(id);
    if (body.productId !== undefined) await this.assertProduct(body.productId);
    await prisma.processRoute.update({
      where: { id: route.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.productId !== undefined ? { productId: body.productId } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    return this.getRoute(id);
  }

  /** Steps can be rewritten only until a lot has used the route; after that, copy it. */
  async replaceSteps(id: string, body: z.infer<typeof replaceStepsBody>) {
    const route = await this.loadRoute(id);
    if (route._count.lots > 0) {
      throw new ApiError(
        409,
        "Lots already run on this route, so its steps are fixed; create a new route instead"
      );
    }
    await this.assertSteps(body.steps);
    await prisma.$transaction(async (tx) => {
      await tx.processRouteStep.deleteMany({ where: { routeId: route.id } });
      await tx.processRouteStep.createMany({
        data: this.stepRows(route.companyId, route.id, body.steps),
      });
    });
    return this.getRoute(id);
  }

  async removeRoute(id: string) {
    const route = await this.loadRoute(id);
    if (route._count.lots > 0) {
      throw new ApiError(409, "Lots already run on this route; deactivate it instead of deleting");
    }
    await prisma.$transaction(async (tx) => {
      await tx.processRouteStep.deleteMany({ where: { routeId: route.id } });
      await tx.processRoute.delete({ where: { id: route.id } });
    });
    return { id, deleted: true };
  }

  // ─── lots ──────────────────────────────────────────────────────────────────

  private async loadLot(id: string): Promise<Lot> {
    const lot = await prisma.lotRouteProgress.findFirst({ where: { id }, include: lotInclude });
    if (!lot) throw new ApiError(404, "That lot does not exist");
    return lot;
  }

  private cardDto(lot: Lot, names: Map<string, string>) {
    const p = progressOf(lot);
    return {
      id: lot.id,
      lotNo: lot.lotNo,
      route: { id: lot.route.id, routeCode: lot.route.routeCode, name: lot.route.name },
      product: productDto(lot.product),
      inputQty: Number(lot.inputQty),
      inputUom: lot.inputUom,
      startDate: iso(lot.startDate),
      status: lot.status,
      remarks: lot.remarks,
      closedAt: lot.closedAt?.toISOString() ?? null,
      cancelReason: lot.cancelReason,
      currentStepSeq: p.currentSeq,
      finalOutput: p.finalOutput,
      finalUom: p.finalUom,
      cumulativeYieldPct: p.cumulativeYieldPct,
      normYieldPct: p.normYieldPct,
      overNormSteps: p.overNormSteps,
      closeBlockers: p.closeBlockers,
      steps: p.steps.map((s) => {
        const def = lot.route.steps.find((d) => d.seq === s.seq);
        return {
          ...s,
          id: def?.id ?? null,
          defaultJobWorkerId: def?.defaultJobWorkerId ?? null,
          holders: s.holders.map((h) => ({
            ...h,
            jobWorkerName: h.jobWorkerId ? (names.get(h.jobWorkerId) ?? null) : null,
          })),
        };
      }),
      locations:
        lot.status === "CANCELLED"
          ? []
          : p.locations.map((l) => ({
              ...l,
              jobWorkerName: l.jobWorkerId ? (names.get(l.jobWorkerId) ?? null) : null,
            })),
    };
  }

  private namesOf(lots: Lot[]) {
    const names = new Map<string, string>();
    for (const lot of lots) {
      for (const m of lot.movements) if (m.jobWorker) names.set(m.jobWorker.id, m.jobWorker.name);
    }
    return names;
  }

  private detailDto(lot: Lot) {
    return {
      ...this.cardDto(lot, this.namesOf([lot])),
      movements: lot.movements.map((m, i, all) => ({
        id: m.id,
        stepSeq: m.stepSeq,
        stepName: lot.route.steps.find((s) => s.id === m.stepId)?.name ?? null,
        direction: m.direction,
        qty: Number(m.qty),
        uom: m.uom,
        movementDate: iso(m.movementDate),
        jobWorker: m.jobWorker,
        challan: m.challan,
        closesStep: m.closesStep,
        remarks: m.remarks,
        createdAt: m.createdAt.toISOString(),
        undoable:
          lot.status === "OPEN" &&
          all.every((o) => o.createdAt.getTime() <= m.createdAt.getTime() || o.id === m.id),
      })),
    };
  }

  async listLots(q: z.infer<typeof lotListQuery>) {
    const where: Prisma.LotRouteProgressWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.routeId) where.routeId = q.routeId;
    if (q.q) where.lotNo = { contains: q.q, mode: "insensitive" };
    const lots = await prisma.lotRouteProgress.findMany({
      where,
      include: lotInclude,
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
    const names = this.namesOf(lots);
    return lots.map((l) => this.cardDto(l, names));
  }

  /** The lot board: every open lot as a card, the counts, and what sits at each job worker. */
  async board() {
    const [open, counts] = await Promise.all([
      prisma.lotRouteProgress.findMany({
        where: { status: "OPEN" },
        include: lotInclude,
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
        take: 300,
      }),
      prisma.lotRouteProgress.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const names = this.namesOf(open);
    const cards = open.map((l) => this.cardDto(l, names));
    const atWorkers = new Map<
      string,
      { jobWorkerId: string; name: string | null; lots: Set<string>; qty: Map<string, number> }
    >();
    for (const c of cards) {
      for (const l of c.locations) {
        if (l.kind !== "JOB_WORKER" || !l.jobWorkerId) continue;
        const w = atWorkers.get(l.jobWorkerId) ?? {
          jobWorkerId: l.jobWorkerId,
          name: l.jobWorkerName,
          lots: new Set<string>(),
          qty: new Map<string, number>(),
        };
        w.lots.add(c.id);
        w.qty.set(l.uom, Math.round(((w.qty.get(l.uom) ?? 0) + (l.qty ?? 0)) * 1000) / 1000);
        atWorkers.set(l.jobWorkerId, w);
      }
    }
    const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
    return {
      summary: {
        open: count("OPEN"),
        completed: count("COMPLETED"),
        cancelled: count("CANCELLED"),
        overNormLots: cards.filter((c) => c.overNormSteps > 0).length,
        atJobWorkers: [...atWorkers.values()].map((w) => ({
          jobWorkerId: w.jobWorkerId,
          name: w.name,
          lots: w.lots.size,
          qty: [...w.qty.entries()].map(([uom, qty]) => ({ uom, qty })),
        })),
      },
      lots: cards,
    };
  }

  async getLot(id: string) {
    return this.detailDto(await this.loadLot(id));
  }

  async createLot(body: z.infer<typeof createLotBody>, actor: Actor) {
    const clash = await prisma.lotRouteProgress.findFirst({
      where: { lotNo: body.lotNo },
      select: { id: true },
    });
    if (clash) throw new ApiError(409, "A lot with that number already exists");
    const route = await this.loadRoute(body.routeId);
    if (!route.active)
      throw new ApiError(409, "That route is inactive; activate it or pick another");
    await this.assertProduct(body.productId);
    if (route.productId != null && body.productId != null && route.productId !== body.productId) {
      throw new ApiError(400, "This route is for a different product");
    }
    const first = route.steps[0];
    if (!first) throw new ApiError(409, "That route has no steps");
    if (body.inputUom && !sameUom(body.inputUom, first.uomIn)) {
      throw new ApiError(
        400,
        `The lot goes into ${first.name} in ${first.uomIn}; enter the input in ${first.uomIn}`
      );
    }
    const lot = await prisma.lotRouteProgress.create({
      data: {
        lotNo: body.lotNo,
        routeId: route.id,
        productId: body.productId ?? route.productId ?? null,
        inputQty: new Prisma.Decimal(body.inputQty),
        inputUom: first.uomIn,
        startDate: asDate(body.startDate),
        remarks: body.remarks ?? null,
        createdBy: actor.userId ?? null,
      },
    });
    return this.getLot(lot.id);
  }

  private assertOpen(lot: Lot) {
    if (lot.status !== "OPEN") {
      throw new ApiError(
        409,
        `This lot is ${lot.status.toLowerCase()}; nothing more can be recorded`
      );
    }
  }

  async addMovement(id: string, body: z.infer<typeof movementBody>, actor: Actor) {
    return prisma.$transaction(async (tx) => {
      // One movement at a time per lot, so two people cannot both send the last kilo.
      await tx.$queryRaw`SELECT id FROM lot_route_progress WHERE id = ${id}::uuid FOR UPDATE`;
      const lot = await tx.lotRouteProgress.findFirst({ where: { id }, include: lotInclude });
      if (!lot) throw new ApiError(404, "That lot does not exist");
      this.assertOpen(lot);
      const step = lot.route.steps.find((s) => s.seq === body.stepSeq);
      if (!step) throw new ApiError(400, "That step is not on this lot's route");
      const unit = body.direction === "OUT" ? step.uomIn : step.uomOut;
      if (body.uom && !sameUom(body.uom, unit)) {
        throw new ApiError(
          400,
          `${step.name} ${body.direction === "OUT" ? "takes" : "gives"} ${unit}; enter the quantity in ${unit}`
        );
      }

      let jobWorkerId = body.jobWorkerId ?? null;
      let challan: Awaited<ReturnType<typeof this.challanFor>> = null;
      if (step.mode === "IN_HOUSE") {
        if (body.challanId) {
          throw new ApiError(400, `${step.name} is in-house; a delivery challan cannot be linked`);
        }
      } else {
        challan = await this.challanFor(tx, body.challanId, body.direction);
        if (!jobWorkerId && challan?.jobWorkerId) jobWorkerId = challan.jobWorkerId;
        if (!jobWorkerId && body.direction === "OUT") jobWorkerId = step.defaultJobWorkerId;
      }
      if (jobWorkerId) {
        const w = await tx.jobWorker.findFirst({
          where: { id: jobWorkerId },
          select: { id: true },
        });
        if (!w) throw new ApiError(404, "That job worker does not exist");
      }

      const check = checkMovement(
        progressOf(lot),
        { startDate: iso(lot.startDate) },
        {
          stepSeq: step.seq,
          direction: body.direction,
          qty: body.qty,
          jobWorkerId,
          date: body.movementDate,
        }
      );
      if (!check.ok) throw new ApiError(check.status, check.message);
      jobWorkerId = check.jobWorkerId;

      if (challan) {
        if (challan.jobWorkerId && challan.jobWorkerId !== jobWorkerId) {
          throw new ApiError(400, `Challan ${challan.challanNo} is for a different job worker`);
        }
        if (iso(challan.challanDate) !== body.movementDate) {
          // The challan date is the movement date for a job-work step; keep them together.
          throw new ApiError(
            400,
            `Challan ${challan.challanNo} is dated ${iso(challan.challanDate)}; use that date`
          );
        }
        const dup = await tx.lotStepMovement.findFirst({
          where: {
            lotId: lot.id,
            stepId: step.id,
            direction: body.direction,
            challanId: challan.id,
          },
          select: { id: true },
        });
        if (dup)
          throw new ApiError(409, `Challan ${challan.challanNo} is already linked to this step`);
        await this.assertChallanQty(tx, challan, body.direction, body.qty, unit);
      }

      await tx.lotStepMovement.create({
        data: {
          companyId: lot.companyId,
          lotId: lot.id,
          stepId: step.id,
          stepSeq: step.seq,
          direction: body.direction,
          qty: new Prisma.Decimal(body.qty),
          uom: unit,
          movementDate: asDate(body.movementDate),
          jobWorkerId,
          challanId: challan?.id ?? null,
          closesStep: body.direction === "IN" ? (body.closesStep ?? false) : false,
          remarks: body.remarks ?? null,
          createdBy: actor.userId ?? null,
        },
      });
      const after = await tx.lotRouteProgress.findFirstOrThrow({
        where: { id },
        include: lotInclude,
      });
      const p = progressOf(after);
      if (p.currentSeq !== after.currentStepSeq) {
        await tx.lotRouteProgress.update({ where: { id }, data: { currentStepSeq: p.currentSeq } });
        after.currentStepSeq = p.currentSeq;
      }
      return this.detailDto(after);
    });
  }

  /**
   * The challan a job-work movement links to: this tenant's, not cancelled, an outward challan for
   * OUT and a return (or the outward challan it is received against) for IN.
   */
  private async challanFor(
    tx: Prisma.TransactionClient,
    challanId: string | undefined,
    direction: "OUT" | "IN"
  ) {
    if (!challanId) return null;
    const c = await tx.deliveryChallan.findFirst({
      where: { id: challanId },
      select: {
        id: true,
        challanNo: true,
        challanDate: true,
        kind: true,
        status: true,
        jobWorkerId: true,
        items: { select: { quantitySent: true, uom: true } },
      },
    });
    if (!c) throw new ApiError(404, "That delivery challan does not exist");
    if (c.status === "CANCELLED") throw new ApiError(409, `Challan ${c.challanNo} is cancelled`);
    const allowed = direction === "OUT" ? ["JOB_WORK_OUT"] : ["JOB_WORK_RETURN", "JOB_WORK_OUT"];
    if (!allowed.includes(c.kind)) {
      throw new ApiError(
        400,
        direction === "OUT"
          ? `Challan ${c.challanNo} is not a job-work outward challan`
          : `Challan ${c.challanNo} is not a job-work challan`
      );
    }
    return c;
  }

  /**
   * What lots book against one challan cannot exceed what the challan carries, when the challan's
   * lines are in the same unit (a receipt booked against the outward challan is not compared: it
   * may come back in another unit).
   */
  private async assertChallanQty(
    tx: Prisma.TransactionClient,
    challan: NonNullable<Awaited<ReturnType<typeof this.challanFor>>>,
    direction: "OUT" | "IN",
    qty: number,
    unit: string
  ) {
    const outward = challan.kind === "JOB_WORK_OUT";
    if (direction === "IN" && outward) return;
    if (challan.items.length === 0 || !challan.items.every((i) => i.uom && sameUom(i.uom, unit))) {
      return;
    }
    const carried = challan.items.reduce(
      (s, i) => s + Math.round(Number(i.quantitySent) * 1000),
      0
    );
    const booked = await tx.lotStepMovement.aggregate({
      where: { challanId: challan.id, direction },
      _sum: { qty: true },
    });
    const bookedM = Math.round(Number(booked._sum.qty ?? 0) * 1000);
    if (bookedM + Math.round(qty * 1000) > carried) {
      throw new ApiError(
        400,
        `Challan ${challan.challanNo} carries ${carried / 1000} ${unit}; ${bookedM / 1000} is already booked to lots`
      );
    }
  }

  /** Takes back the lot's latest movement (a wrong entry); earlier ones stay put. */
  async undoMovement(id: string, movementId: string) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM lot_route_progress WHERE id = ${id}::uuid FOR UPDATE`;
      const lot = await tx.lotRouteProgress.findFirst({ where: { id }, include: lotInclude });
      if (!lot) throw new ApiError(404, "That lot does not exist");
      this.assertOpen(lot);
      const mv = lot.movements.find((m) => m.id === movementId);
      if (!mv) throw new ApiError(404, "That movement does not exist");
      const latest = [...lot.movements].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )[0];
      if (latest.id !== mv.id) {
        throw new ApiError(409, "Only the latest movement can be taken back");
      }
      await tx.lotStepMovement.delete({ where: { id: mv.id } });
      const after = await tx.lotRouteProgress.findFirstOrThrow({
        where: { id },
        include: lotInclude,
      });
      const p = progressOf(after);
      if (p.currentSeq !== after.currentStepSeq) {
        await tx.lotRouteProgress.update({ where: { id }, data: { currentStepSeq: p.currentSeq } });
      }
      return this.detailDto({ ...after, currentStepSeq: p.currentSeq });
    });
  }

  async closeLot(id: string) {
    const lot = await this.loadLot(id);
    this.assertOpen(lot);
    const p = progressOf(lot);
    if (p.closeBlockers.length > 0) {
      throw new ApiError(409, `The lot cannot close yet: ${p.closeBlockers.join("; ")}`);
    }
    await prisma.lotRouteProgress.update({
      where: { id },
      data: { status: "COMPLETED", closedAt: new Date(), currentStepSeq: p.currentSeq },
    });
    return this.getLot(id);
  }

  async cancelLot(id: string, body: z.infer<typeof cancelLotBody>) {
    const lot = await this.loadLot(id);
    this.assertOpen(lot);
    await prisma.lotRouteProgress.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: body.reason },
    });
    return this.getLot(id);
  }

  /** Job-work challans a movement can link to, without needing the job-work permission. */
  async challanOptions(q: z.infer<typeof challanOptionsQuery>) {
    const rows = await prisma.deliveryChallan.findMany({
      where: {
        kind: q.kind ? q.kind : { in: ["JOB_WORK_OUT", "JOB_WORK_RETURN"] },
        status: { not: "CANCELLED" },
        ...(q.jobWorkerId ? { jobWorkerId: q.jobWorkerId } : {}),
      },
      select: {
        id: true,
        challanNo: true,
        challanDate: true,
        kind: true,
        status: true,
        jobWorker: { select: { id: true, name: true } },
        items: { select: { quantitySent: true, uom: true } },
      },
      orderBy: [{ challanDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    return rows.map((c) => ({
      id: c.id,
      challanNo: c.challanNo,
      challanDate: iso(c.challanDate),
      kind: c.kind,
      status: c.status,
      jobWorker: c.jobWorker,
      qty: c.items.reduce((s, i) => s + Number(i.quantitySent), 0),
      uom: [...new Set(c.items.map((i) => i.uom ?? ""))].join("/"),
    }));
  }
}

export const processRoutesService = new ProcessRoutesService();
