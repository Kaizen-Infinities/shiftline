import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { lineMetrics } from "../delivery-schedules/delivery-schedules.calc";
import {
  MAX_LABELS,
  allocateToSchedule,
  buildLabels,
  canTransition,
  packsFor,
  type PackLabel,
} from "./asn.calc";
import { renderLabelsPdf, type LabelSize } from "./asn.labels";
import { EXPORT_PROVIDERS, exportProviderFor, type AsnExportDoc } from "./providers";
import {
  withOffset,
  type AsnLineInput,
  type CreateAsnInput,
  type CreatePartMapInput,
  type ListInput,
  type StatusInput,
  type UpdateAsnInput,
  type UpdatePartMapInput,
} from "./asn.validation";

/**
 * OEM ASNs, packing labels and the customer part-number map (TN-07). Every read and write goes
 * through the tenant-scoped client; the invoice, customer, product and schedule line an ASN
 * points at are all looked up with `findFirst` first, so a foreign id is a 404 and never a link.
 *
 * Adherence: an ASN line may name a TN-02 schedule line. When the ASN is marked SENT (the truck
 * has left), each such line books a `CustomerScheduleDispatch` — the same row TN-02's manual
 * dispatch entry writes — so the quantity counts toward adherence and OTIF; cancelling a sent
 * ASN removes those dispatches again.
 */
type Tx = Prisma.TransactionClient;

const num = (v: unknown) => Number(v ?? 0);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (v: string) => new Date(`${v.slice(0, 10)}T00:00:00Z`);
/** The India calendar date of an instant. */
const istDay = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const nameOf = (c: { firmName: string; displayName: string | null }) => c.displayName || c.firmName;

const conflict = (message: string, code: string, details?: Record<string, unknown>) =>
  new ApiError(409, message, code, details);
const bad = (message: string, code: string, details?: Record<string, unknown>) =>
  new ApiError(400, message, code, details);

const asnInclude = {
  customer: { select: { id: true, firmName: true, displayName: true, customerCode: true } },
  lines: {
    orderBy: { seq: "asc" as const },
    include: {
      product: { select: { productCode: true, productName: true } },
      scheduleLine: {
        select: {
          id: true,
          dueDate: true,
          customerPartNo: true,
          schedule: { select: { id: true, scheduleNo: true, revision: true } },
        },
      },
    },
  },
};
type AsnRow = Prisma.AsnGetPayload<{ include: typeof asnInclude }>;

const asnView = (a: AsnRow) => {
  const lines = a.lines.map((l) => ({
    id: l.id,
    seq: l.seq,
    productId: String(l.productId),
    productCode: l.product.productCode,
    productName: l.product.productName,
    customerPartNo: l.customerPartNo,
    description: l.description,
    uom: l.uom,
    qty: num(l.qty),
    packQty: num(l.packQty),
    packs: l.packs,
    scheduleLineId: l.scheduleLineId,
    schedule: l.scheduleLine
      ? {
          scheduleId: l.scheduleLine.schedule.id,
          scheduleNo: l.scheduleLine.schedule.scheduleNo,
          revision: l.scheduleLine.schedule.revision,
          dueDate: iso(l.scheduleLine.dueDate),
        }
      : null,
    dispatchBooked: l.dispatchId !== null,
  }));
  return {
    id: a.id,
    asnNo: a.asnNo,
    status: a.status,
    customerId: a.customerId,
    customerName: nameOf(a.customer),
    salesInvoiceId: a.salesInvoiceId,
    invoiceNo: a.invoiceNo,
    invoiceDate: iso(a.invoiceDate),
    vehicleNo: a.vehicleNo,
    transporterName: a.transporterName,
    lrNo: a.lrNo,
    lrDate: a.lrDate ? iso(a.lrDate) : null,
    dispatchAt: a.dispatchAt.toISOString(),
    sentAt: a.sentAt?.toISOString() ?? null,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    ackRef: a.ackRef,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    cancelReason: a.cancelReason,
    notes: a.notes,
    lines,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
    totalPacks: lines.reduce((s, l) => s + l.packs, 0),
  };
};

interface ProposedLine {
  productId: string;
  productCode: string;
  productName: string;
  customerPartNo: string | null;
  description: string | null;
  uom: string | null;
  qty: number;
  packQty: number;
  packs: number;
  scheduleLineId: string | null;
  schedule: { scheduleNo: string; revision: number; dueDate: string; remaining: number } | null;
  mapped: boolean;
}

class AsnService {
  // ── Lookups ────────────────────────────────────────────────────────────────
  private async customer(customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new ApiError(404, "That customer does not exist");
    return customer;
  }

  private async product(productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: BigInt(productId) },
      select: { id: true },
    });
    if (!product) throw new ApiError(404, "That product does not exist");
    return product;
  }

  private async invoice(id: string) {
    const invoice = await prisma.salesInvoice.findFirst({
      where: { id },
      select: {
        id: true,
        invoiceNo: true,
        invoiceDate: true,
        status: true,
        customerId: true,
        customer: { select: { firmName: true, displayName: true } },
        items: {
          select: {
            productId: true,
            description: true,
            uom: true,
            quantity: true,
            hsnCode: true,
            product: { select: { productCode: true, productName: true } },
          },
        },
      },
    });
    if (!invoice) throw new ApiError(404, "That sales invoice does not exist");
    if (invoice.status === "CANCELLED") {
      throw conflict("That sales invoice is cancelled", "INVOICE_CANCELLED");
    }
    return invoice;
  }
  private async asnRow(id: string) {
    const asn = await prisma.asn.findFirst({ where: { id }, include: asnInclude });
    if (!asn) throw new ApiError(404, "That ASN does not exist");
    return asn;
  }

  /** Invoice quantity per product (an invoice can carry the same product on several rows). */
  private invoicedQty(invoice: Awaited<ReturnType<AsnService["invoice"]>>) {
    const map = new Map<string, number>();
    for (const it of invoice.items) {
      const k = String(it.productId);
      map.set(k, (map.get(k) ?? 0) + num(it.quantity));
    }
    return map;
  }

  /**
   * Open schedule lines of a customer for the given products or part numbers, earliest due
   * first, with what is still owed after booked dispatches and other draft ASNs.
   */
  private async openScheduleLines(
    customerId: string,
    productIds: bigint[],
    partNos: string[],
    exceptAsnId?: string
  ) {
    if (productIds.length === 0 && partNos.length === 0) return [];
    const lines = await prisma.customerScheduleLine.findMany({
      where: {
        schedule: { customerId, status: "OPEN" },
        OR: [
          ...(productIds.length ? [{ productId: { in: productIds } }] : []),
          ...(partNos.length ? [{ customerPartNo: { in: partNos } }] : []),
        ],
      },
      include: {
        dispatches: { select: { dispatchDate: true, qty: true } },
        schedule: { select: { scheduleNo: true, revision: true } },
        asnLines: {
          where: {
            dispatchId: null,
            asn: { status: "DRAFT", ...(exceptAsnId ? { id: { not: exceptAsnId } } : {}) },
          },
          select: { qty: true },
        },
      },
      orderBy: [{ firmness: "asc" }, { dueDate: "asc" }],
      take: 500,
    });
    const asOf = asDate(new Date().toISOString());
    return lines
      .map((l) => {
        const m = lineMetrics(
          {
            dueDate: l.dueDate,
            firmness: l.firmness,
            scheduledQty: num(l.scheduledQty),
            dispatches: l.dispatches.map((d) => ({
              dispatchDate: d.dispatchDate,
              qty: num(d.qty),
            })),
          },
          asOf
        );
        const pending = l.asnLines.reduce((s, a) => s + num(a.qty), 0);
        return {
          id: l.id,
          productId: l.productId === null ? null : String(l.productId),
          customerPartNo: l.customerPartNo,
          scheduleNo: l.schedule.scheduleNo,
          revision: l.schedule.revision,
          dueDate: iso(l.dueDate),
          firmness: l.firmness,
          remaining: Math.max(0, Math.round((m.remaining - pending) * 1000) / 1000),
        };
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  // ── Part map ───────────────────────────────────────────────────────────────
  private partMapView(m: {
    id: string;
    customerId: string;
    productId: bigint;
    customerPartNo: string;
    description: string | null;
    packQty: Prisma.Decimal | null;
    packType: string | null;
    isActive: boolean;
    customer: { firmName: string; displayName: string | null };
    product: { productCode: string; productName: string };
  }) {
    return {
      id: m.id,
      customerId: m.customerId,
      customerName: nameOf(m.customer),
      productId: String(m.productId),
      productCode: m.product.productCode,
      productName: m.product.productName,
      customerPartNo: m.customerPartNo,
      description: m.description,
      packQty: m.packQty === null ? null : num(m.packQty),
      packType: m.packType,
      isActive: m.isActive,
    };
  }

  private partMapInclude = {
    customer: { select: { firmName: true, displayName: true } },
    product: { select: { productCode: true, productName: true } },
  };

  private async assertUniquePart(customerId: string, customerPartNo: string, exceptId?: string) {
    const clash = await prisma.customerPartMap.findFirst({
      where: {
        customerId,
        customerPartNo: { equals: customerPartNo, mode: "insensitive" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) {
      throw conflict(
        "This customer already has that part number mapped",
        "DUPLICATE_CUSTOMER_PART_NO"
      );
    }
  }

  async listPartMaps(q: { customerId?: string; productId?: string; q?: string }) {
    const rows = await prisma.customerPartMap.findMany({
      where: {
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.productId ? { productId: BigInt(q.productId) } : {}),
        ...(q.q
          ? {
              OR: [
                { customerPartNo: { contains: q.q, mode: "insensitive" as const } },
                { description: { contains: q.q, mode: "insensitive" as const } },
                { product: { productName: { contains: q.q, mode: "insensitive" as const } } },
                { product: { productCode: { contains: q.q, mode: "insensitive" as const } } },
              ],
            }
          : {}),
      },
      include: this.partMapInclude,
      orderBy: [{ customerId: "asc" }, { customerPartNo: "asc" }],
      take: 1000,
    });
    return rows.map((m) => this.partMapView(m));
  }

  async createPartMap(body: CreatePartMapInput, actor: { userId?: string }) {
    await this.customer(body.customerId);
    await this.product(body.productId);
    await this.assertUniquePart(body.customerId, body.customerPartNo);
    const created = await prisma.customerPartMap.create({
      data: {
        companyId: requireTenantId(),
        customerId: body.customerId,
        productId: BigInt(body.productId),
        customerPartNo: body.customerPartNo,
        description: body.description || null,
        packQty: body.packQty === undefined ? null : new Prisma.Decimal(body.packQty),
        packType: body.packType || null,
        isActive: body.isActive ?? true,
        createdBy: actor.userId ?? null,
      },
      include: this.partMapInclude,
    });
    return this.partMapView(created);
  }

  async updatePartMap(id: string, body: UpdatePartMapInput) {
    const current = await prisma.customerPartMap.findFirst({ where: { id } });
    if (!current) throw new ApiError(404, "That part mapping does not exist");
    if (body.productId !== undefined) await this.product(body.productId);
    if (body.customerPartNo !== undefined && body.customerPartNo !== current.customerPartNo) {
      await this.assertUniquePart(current.customerId, body.customerPartNo, id);
    }
    const updated = await prisma.customerPartMap.update({
      where: { id: current.id },
      data: {
        ...(body.productId !== undefined ? { productId: BigInt(body.productId) } : {}),
        ...(body.customerPartNo !== undefined ? { customerPartNo: body.customerPartNo } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.packQty !== undefined
          ? { packQty: body.packQty === null ? null : new Prisma.Decimal(body.packQty) }
          : {}),
        ...(body.packType !== undefined ? { packType: body.packType || null } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: this.partMapInclude,
    });
    return this.partMapView(updated);
  }

  /** A mapping is master data, not a book: ASN lines copy the part number, so it can go. */
  async deletePartMap(id: string) {
    const current = await prisma.customerPartMap.findFirst({ where: { id }, select: { id: true } });
    if (!current) throw new ApiError(404, "That part mapping does not exist");
    await prisma.customerPartMap.delete({ where: { id: current.id } });
    return { id: current.id };
  }

  // ── Prefill ────────────────────────────────────────────────────────────────
  /**
   * What an ASN for this invoice would hold: one line per invoiced product (split across open
   * schedule lines, earliest due first), the customer's part number and standard pack from the
   * part map, and the vehicle / transporter from the invoice's live e-way bill if it has one.
   */
  async prefill(salesInvoiceId: string) {
    const invoice = await this.invoice(salesInvoiceId);
    const existing = await prisma.asn.findFirst({
      where: { salesInvoiceId: invoice.id, status: { not: "CANCELLED" } },
      select: { id: true, asnNo: true },
    });
    const lines = await this.proposeLines(invoice);
    const ewb = await prisma.ewayBill.findFirst({
      where: { docType: "INV", docRef: invoice.id, status: { in: ["ACTIVE", "PENDING"] } },
      orderBy: { createdAt: "desc" },
      select: { vehicleNo: true, transporterName: true, transDocNo: true, transDocDate: true },
    });
    const open = await this.openScheduleLines(
      invoice.customerId,
      [...new Set(invoice.items.map((i) => i.productId))],
      lines.map((l) => l.customerPartNo).filter((v): v is string => !!v)
    );
    return {
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        invoiceDate: iso(invoice.invoiceDate),
        customerId: invoice.customerId,
        customerName: nameOf(invoice.customer),
      },
      existingAsn: existing,
      transport: {
        vehicleNo: ewb?.vehicleNo ?? null,
        transporterName: ewb?.transporterName ?? null,
        lrNo: ewb?.transDocNo ?? null,
        lrDate: ewb?.transDocDate ? iso(ewb.transDocDate) : null,
      },
      lines,
      unmappedProducts: lines.filter((l) => !l.mapped).map((l) => l.productId),
      openScheduleLines: open,
    };
  }

  private async proposeLines(
    invoice: Awaited<ReturnType<AsnService["invoice"]>>
  ): Promise<ProposedLine[]> {
    const byProduct = new Map<string, { qty: number; item: (typeof invoice.items)[number] }>();
    for (const it of invoice.items) {
      const k = String(it.productId);
      const cur = byProduct.get(k);
      if (cur) cur.qty += num(it.quantity);
      else byProduct.set(k, { qty: num(it.quantity), item: it });
    }
    const productIds = [...byProduct.keys()].map((k) => BigInt(k));
    const maps = await prisma.customerPartMap.findMany({
      where: { customerId: invoice.customerId, productId: { in: productIds }, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    const mapOf = new Map<string, (typeof maps)[number]>();
    for (const m of maps) if (!mapOf.has(String(m.productId))) mapOf.set(String(m.productId), m);
    const open = await this.openScheduleLines(
      invoice.customerId,
      productIds,
      maps.map((m) => m.customerPartNo)
    );

    const out: ProposedLine[] = [];
    for (const [pid, { qty, item }] of byProduct) {
      const map = mapOf.get(pid);
      const partNo = map?.customerPartNo ?? null;
      const candidates = open.filter(
        (o) => o.productId === pid || (partNo !== null && o.customerPartNo === partNo)
      );
      const packQty = map?.packQty ? num(map.packQty) : qty;
      for (const a of allocateToSchedule(qty, candidates)) {
        const sl = a.scheduleLineId ? candidates.find((c) => c.id === a.scheduleLineId) : null;
        out.push({
          productId: pid,
          productCode: item.product.productCode,
          productName: item.product.productName,
          customerPartNo: partNo,
          description: map?.description ?? item.description ?? item.product.productName,
          uom: item.uom,
          qty: a.qty,
          packQty,
          packs: packsFor(a.qty, packQty),
          scheduleLineId: a.scheduleLineId,
          schedule: sl
            ? {
                scheduleNo: sl.scheduleNo,
                revision: sl.revision,
                dueDate: sl.dueDate,
                remaining: sl.remaining,
              }
            : null,
          mapped: !!map,
        });
      }
    }
    return out;
  }

  // ── ASN ────────────────────────────────────────────────────────────────────
  /** Checks every line against the invoice and the customer's schedules; returns row data. */
  private async resolveLines(
    invoice: Awaited<ReturnType<AsnService["invoice"]>>,
    lines: AsnLineInput[]
  ) {
    const invoiced = this.invoicedQty(invoice);
    const uomOf = new Map(invoice.items.map((i) => [String(i.productId), i.uom]));
    const asked = new Map<string, number>();
    for (const l of lines) {
      if (!invoiced.has(l.productId)) {
        throw bad("A line names a product that is not on this invoice", "PRODUCT_NOT_ON_INVOICE", {
          productId: l.productId,
        });
      }
      asked.set(l.productId, (asked.get(l.productId) ?? 0) + l.qty);
    }
    for (const [pid, q] of asked) {
      if (Math.round(q * 1000) > Math.round((invoiced.get(pid) ?? 0) * 1000)) {
        throw bad("The ASN ships more than the invoice bills", "QTY_EXCEEDS_INVOICE", {
          productId: pid,
          invoiced: invoiced.get(pid),
          asked: q,
        });
      }
    }
    const totalPacks = lines.reduce((s, l) => s + packsFor(l.qty, l.packQty), 0);
    if (totalPacks > MAX_LABELS) {
      throw bad(
        `At most ${MAX_LABELS} packs on one ASN; check the pack quantities`,
        "TOO_MANY_PACKS"
      );
    }
    for (const l of lines) {
      if (!l.scheduleLineId) continue;
      const sl = await prisma.customerScheduleLine.findFirst({
        where: { id: l.scheduleLineId },
        select: {
          productId: true,
          customerPartNo: true,
          schedule: { select: { customerId: true, status: true } },
        },
      });
      if (!sl) throw new ApiError(404, "That schedule line does not exist");
      if (sl.schedule.customerId !== invoice.customerId) {
        throw bad("That schedule belongs to a different customer", "SCHEDULE_CUSTOMER_MISMATCH");
      }
      if (sl.schedule.status !== "OPEN") {
        throw conflict("That schedule is not open", "SCHEDULE_NOT_OPEN");
      }
      const sameProduct = sl.productId !== null && String(sl.productId) === l.productId;
      const samePart = sl.customerPartNo.toUpperCase() === l.customerPartNo.toUpperCase();
      if (!sameProduct && !samePart) {
        throw bad("That schedule line is for a different part", "SCHEDULE_PART_MISMATCH");
      }
    }
    return lines.map((l, i) => ({
      companyId: requireTenantId(),
      seq: i + 1,
      productId: BigInt(l.productId),
      customerPartNo: l.customerPartNo,
      description: l.description || null,
      uom: uomOf.get(l.productId) ?? null,
      qty: new Prisma.Decimal(l.qty),
      packQty: new Prisma.Decimal(l.packQty),
      packs: packsFor(l.qty, l.packQty),
      scheduleLineId: l.scheduleLineId ?? null,
    }));
  }

  private assertDispatchAfterInvoice(dispatchAt: Date, invoiceDate: Date) {
    if (istDay(dispatchAt) < iso(invoiceDate)) {
      throw bad("Dispatch cannot be before the invoice date", "DISPATCH_BEFORE_INVOICE");
    }
  }

  private async nextAsnNo(invoiceNo: string) {
    const base = `ASN-${invoiceNo}`.replace(/[^A-Za-z0-9/_.-]/g, "-").slice(0, 36);
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-R${i}`;
      const taken = await prisma.asn.findFirst({
        where: { asnNo: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw conflict("Give this ASN a number", "ASN_NO_REQUIRED");
  }

  async list(q: ListInput) {
    const rows = await prisma.asn.findMany({
      where: {
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.from || q.to
          ? {
              dispatchAt: {
                ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}),
                ...(q.to
                  ? { lt: new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + 86_400_000) }
                  : {}),
              },
            }
          : {}),
        ...(q.q
          ? {
              OR: [
                { asnNo: { contains: q.q, mode: "insensitive" as const } },
                { invoiceNo: { contains: q.q, mode: "insensitive" as const } },
                { vehicleNo: { contains: q.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      include: {
        customer: { select: { firmName: true, displayName: true } },
        lines: { select: { qty: true, packs: true } },
      },
      orderBy: [{ dispatchAt: "desc" }, { asnNo: "desc" }],
      take: 500,
    });
    return rows.map((a) => ({
      id: a.id,
      asnNo: a.asnNo,
      status: a.status,
      customerId: a.customerId,
      customerName: nameOf(a.customer),
      salesInvoiceId: a.salesInvoiceId,
      invoiceNo: a.invoiceNo,
      vehicleNo: a.vehicleNo,
      dispatchAt: a.dispatchAt.toISOString(),
      lineCount: a.lines.length,
      totalQty: a.lines.reduce((s, l) => s + num(l.qty), 0),
      totalPacks: a.lines.reduce((s, l) => s + l.packs, 0),
    }));
  }

  async get(id: string) {
    return asnView(await this.asnRow(id));
  }

  async create(body: CreateAsnInput, actor: { userId?: string }) {
    const invoice = await this.invoice(body.salesInvoiceId);
    const live = await prisma.asn.findFirst({
      where: { salesInvoiceId: invoice.id, status: { not: "CANCELLED" } },
      select: { asnNo: true },
    });
    if (live) {
      throw conflict(`This invoice already has ASN ${live.asnNo}`, "ASN_EXISTS_FOR_INVOICE");
    }
    let input: AsnLineInput[];
    if (body.lines) {
      input = body.lines;
    } else {
      const proposed = await this.proposeLines(invoice);
      const unmapped = proposed.filter((l) => !l.customerPartNo);
      if (unmapped.length > 0) {
        throw bad("Map the customer's part number for every product first", "PART_NOT_MAPPED", {
          productIds: [...new Set(unmapped.map((l) => l.productId))],
        });
      }
      input = proposed.map((l) => ({
        productId: l.productId,
        customerPartNo: l.customerPartNo as string,
        description: l.description ?? undefined,
        qty: l.qty,
        packQty: l.packQty,
        scheduleLineId: l.scheduleLineId,
      }));
    }
    const rows = await this.resolveLines(invoice, input);
    const dispatchAt = new Date(withOffset(body.dispatchAt));
    this.assertDispatchAfterInvoice(dispatchAt, invoice.invoiceDate);

    let asnNo: string;
    if (body.asnNo) {
      const taken = await prisma.asn.findFirst({
        where: { asnNo: body.asnNo },
        select: { id: true },
      });
      if (taken) throw conflict("An ASN with this number already exists", "DUPLICATE_ASN_NO");
      asnNo = body.asnNo;
    } else {
      asnNo = await this.nextAsnNo(invoice.invoiceNo);
    }

    const id = await prisma.$transaction(async (tx: Tx) => {
      const created = await tx.asn.create({
        data: {
          companyId: requireTenantId(),
          asnNo,
          customerId: invoice.customerId,
          salesInvoiceId: invoice.id,
          invoiceNo: invoice.invoiceNo.slice(0, 40),
          invoiceDate: invoice.invoiceDate,
          vehicleNo: body.vehicleNo || null,
          transporterName: body.transporterName || null,
          lrNo: body.lrNo || null,
          lrDate: body.lrDate ? asDate(body.lrDate) : null,
          dispatchAt,
          notes: body.notes || null,
          createdBy: actor.userId ?? null,
        },
      });
      await tx.asnLine.createMany({ data: rows.map((r) => ({ ...r, asnId: created.id })) });
      return created.id;
    });
    return this.get(id);
  }

  async update(id: string, body: UpdateAsnInput) {
    const current = await this.asnRow(id);
    if (current.status !== "DRAFT") {
      throw conflict("Only a draft ASN can be changed", "ASN_NOT_DRAFT");
    }
    const dispatchAt = body.dispatchAt ? new Date(withOffset(body.dispatchAt)) : undefined;
    if (dispatchAt) this.assertDispatchAfterInvoice(dispatchAt, current.invoiceDate);
    const rows = body.lines
      ? await this.resolveLines(await this.invoice(current.salesInvoiceId), body.lines)
      : null;
    await prisma.$transaction(async (tx: Tx) => {
      await tx.asn.update({
        where: { id: current.id },
        data: {
          ...(body.vehicleNo !== undefined ? { vehicleNo: body.vehicleNo || null } : {}),
          ...(body.transporterName !== undefined
            ? { transporterName: body.transporterName || null }
            : {}),
          ...(body.lrNo !== undefined ? { lrNo: body.lrNo || null } : {}),
          ...(body.lrDate !== undefined
            ? { lrDate: body.lrDate ? asDate(body.lrDate) : null }
            : {}),
          ...(dispatchAt ? { dispatchAt } : {}),
          ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
        },
      });
      if (rows) {
        await tx.asnLine.deleteMany({ where: { asnId: current.id } });
        await tx.asnLine.createMany({ data: rows.map((r) => ({ ...r, asnId: current.id })) });
      }
    });
    return this.get(id);
  }

  async setStatus(id: string, body: StatusInput, actor: { userId?: string }) {
    const current = await this.asnRow(id);
    if (!canTransition(current.status, body.status)) {
      throw conflict(
        `A ${current.status.toLowerCase()} ASN cannot be marked ${body.status.toLowerCase()}`,
        "INVALID_ASN_TRANSITION"
      );
    }
    const now = new Date();
    await prisma.$transaction(async (tx: Tx) => {
      if (body.status === "SENT") {
        await this.bookDispatches(tx, current, actor);
        await tx.asn.update({ where: { id: current.id }, data: { status: "SENT", sentAt: now } });
      } else if (body.status === "ACKNOWLEDGED") {
        await tx.asn.update({
          where: { id: current.id },
          data: { status: "ACKNOWLEDGED", acknowledgedAt: now, ackRef: body.ackRef || null },
        });
      } else {
        const dispatchIds = current.lines
          .map((l) => l.dispatchId)
          .filter((v): v is string => v !== null);
        if (dispatchIds.length > 0) {
          await tx.asnLine.updateMany({
            where: { asnId: current.id },
            data: { dispatchId: null },
          });
          await tx.customerScheduleDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
        }
        await tx.asn.update({
          where: { id: current.id },
          data: { status: "CANCELLED", cancelledAt: now, cancelReason: body.reason ?? null },
        });
      }
    });
    return this.get(id);
  }

  /** TN-02 link: one dispatch per schedule-linked line, dated the India day the truck left. */
  private async bookDispatches(tx: Tx, asn: AsnRow, actor: { userId?: string }) {
    const dispatchDate = asDate(istDay(asn.dispatchAt));
    for (const l of asn.lines) {
      if (!l.scheduleLineId || l.dispatchId) continue;
      const sl = await tx.customerScheduleLine.findFirst({
        where: { id: l.scheduleLineId },
        select: { id: true, schedule: { select: { status: true } } },
      });
      if (!sl || sl.schedule.status === "CANCELLED") {
        throw conflict(
          `Line ${l.seq}: its schedule has been cancelled; relink or unlink the line first`,
          "SCHEDULE_NOT_OPEN"
        );
      }
      const dispatch = await tx.customerScheduleDispatch.create({
        data: {
          companyId: requireTenantId(),
          lineId: sl.id,
          dispatchDate,
          qty: l.qty,
          salesInvoiceId: asn.salesInvoiceId,
          invoiceNo: asn.invoiceNo.slice(0, 30),
          asnNo: asn.asnNo,
          createdBy: actor.userId ?? null,
        },
      });
      await tx.asnLine.update({ where: { id: l.id }, data: { dispatchId: dispatch.id } });
    }
  }

  // ── Export and labels ──────────────────────────────────────────────────────
  exportFormats() {
    return EXPORT_PROVIDERS.map((p) => ({
      key: p.key,
      label: p.label,
      available: p.available,
      note: p.note ?? null,
    }));
  }

  private assertPrintable(status: string) {
    if (status === "CANCELLED") throw conflict("This ASN is cancelled", "ASN_CANCELLED");
  }

  async export(id: string, format: string) {
    const provider = exportProviderFor(format);
    const a = await this.asnRow(id);
    this.assertPrintable(a.status);
    const [company, customer, invoice] = await Promise.all([
      prisma.company.findFirst({
        where: { id: requireTenantId() },
        select: { companyName: true, legalName: true, gstin: true },
      }),
      prisma.customer.findFirst({
        where: { id: a.customerId },
        select: { gstin: true, customerCode: true },
      }),
      prisma.salesInvoice.findFirst({
        where: { id: a.salesInvoiceId },
        select: { items: { select: { productId: true, hsnCode: true } } },
      }),
    ]);
    const hsn = new Map(
      (invoice?.items ?? []).map((i) => [String(i.productId), i.hsnCode ?? null])
    );
    const doc: AsnExportDoc = {
      asnNo: a.asnNo,
      status: a.status,
      dispatchAt: a.dispatchAt,
      supplier: {
        name: company?.legalName || company?.companyName || "",
        gstin: company?.gstin ?? null,
      },
      customer: {
        name: nameOf(a.customer),
        gstin: customer?.gstin ?? null,
        code: customer?.customerCode ?? null,
      },
      invoiceNo: a.invoiceNo,
      invoiceDate: iso(a.invoiceDate),
      vehicleNo: a.vehicleNo,
      transporterName: a.transporterName,
      lrNo: a.lrNo,
      lrDate: a.lrDate ? iso(a.lrDate) : null,
      lines: a.lines.map((l) => ({
        seq: l.seq,
        customerPartNo: l.customerPartNo,
        description: l.description,
        itemCode: l.product.productCode,
        hsnCode: hsn.get(String(l.productId)) ?? null,
        uom: l.uom,
        qty: num(l.qty),
        packQty: num(l.packQty),
        packs: l.packs,
        scheduleNo: l.scheduleLine?.schedule.scheduleNo ?? null,
        scheduleDueDate: l.scheduleLine ? iso(l.scheduleLine.dueDate) : null,
      })),
    };
    return provider.render(doc);
  }

  async labelList(id: string): Promise<{ asn: AsnRow; labels: PackLabel[] }> {
    const asn = await this.asnRow(id);
    this.assertPrintable(asn.status);
    const labels = buildLabels(
      asn.asnNo,
      asn.lines.map((l) => ({
        seq: l.seq,
        customerPartNo: l.customerPartNo,
        description: l.description,
        qty: num(l.qty),
        packQty: num(l.packQty),
      }))
    );
    return { asn, labels };
  }

  async labelsPdf(id: string, size: LabelSize) {
    const { asn, labels } = await this.labelList(id);
    const company = await prisma.company.findFirst({
      where: { id: requireTenantId() },
      select: { companyName: true, shortName: true },
    });
    const pdf = await renderLabelsPdf(
      {
        supplierName: company?.shortName || company?.companyName || "",
        customerName: nameOf(asn.customer),
        asnNo: asn.asnNo,
        invoiceNo: asn.invoiceNo,
        dispatchDate: istDay(asn.dispatchAt),
        vehicleNo: asn.vehicleNo,
      },
      labels,
      size
    );
    return { fileName: `${asn.asnNo.replace(/[^A-Za-z0-9_.-]/g, "_")}-labels.pdf`, pdf };
  }
}

export const asnService = new AsnService();
