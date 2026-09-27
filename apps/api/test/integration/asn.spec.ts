import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createProduct,
  createSalesInvoice,
  demoCompany,
} from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * OEM ASN, packing labels and part-number cross-reference (TN-07): part-map CRUD, an ASN
 * prefilled from a sales invoice and the customer's open schedule lines, the TN-02 dispatch
 * booked when it is sent (and removed when it is cancelled), the CSV export and labels, every
 * validation rejection, permissions and tenancy.
 */
const sfx = Date.now().toString(36).slice(-5);
const BASE = "/api/asn";
const D = (n: number) => new Prisma.Decimal(n);
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const nowLocal = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);

let OWNER: { auth: Record<string, string> };
let STORES: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let CUSTOMER_ID: string;
let OTHER_CUSTOMER_ID: string;
let P1: string;
let P2: string;
let P3: string;
let INVOICE_ID: string;
let INVOICE_NO: string;
let SCHEDULE_ID: string;
let LINE_A: string;
let LINE_B: string;
let LINE_C: string;
let ASN_ID: string;

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

/** A sales invoice in the demo tenant with the given product lines. */
const invoiceWith = async (
  customerId: string,
  items: { productId: string; qty: number }[],
  over: Partial<Prisma.SalesInvoiceUncheckedCreateInput> = {}
) => {
  const inv = await createSalesInvoice({
    customerId,
    invoiceDate: new Date(`${today}T00:00:00Z`),
    ...over,
  });
  const prisma = await getPrisma();
  await asDemoTenant(() =>
    prisma.salesInvoiceItem.createMany({
      data: items.map((i) => ({
        companyId: inv.companyId,
        salesInvoiceId: inv.id,
        productId: BigInt(i.productId),
        quantity: D(i.qty),
        unitPrice: D(10),
        lineTotal: D(i.qty * 10),
        uom: "NOS",
        hsnCode: "8708",
      })),
    })
  );
  return inv;
};

describe("OEM ASN and packing labels (TN-07)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    STORES = await authed("demo.stores");
    ACCOUNTS = await authed("demo.accounts");
    CUSTOMER_ID = (await createCustomer({ firmName: `ASN OEM ${sfx}` })).id;
    OTHER_CUSTOMER_ID = (await createCustomer({ firmName: `ASN Other ${sfx}` })).id;
    P1 = String((await createProduct({ productName: `Bracket ${sfx}` })).id);
    P2 = String((await createProduct({ productName: `Clip ${sfx}` })).id);
    P3 = String((await createProduct({ productName: `Unmapped ${sfx}` })).id);
    const inv = await invoiceWith(CUSTOMER_ID, [
      { productId: P1, qty: 200 },
      { productId: P1, qty: 50 }, // same product twice on one invoice
      { productId: P2, qty: 40 },
    ]);
    INVOICE_ID = inv.id;
    INVOICE_NO = inv.invoiceNo;

    const sched = await (
      await api()
    )
      .post("/api/delivery-schedules")
      .set(OWNER.auth)
      .send({
        scheduleNo: `ASN-SCH-${sfx}`,
        customerId: CUSTOMER_ID,
        periodMonth: month,
        receivedOn: today,
        lines: [
          { customerPartNo: "OEM-P1", dueDate: `${month}-05`, scheduledQty: 100 },
          { customerPartNo: "OEM-P1", dueDate: `${month}-20`, scheduledQty: 200 },
          { customerPartNo: "OEM-P2", dueDate: `${month}-10`, scheduledQty: 50, productId: P2 },
        ],
      });
    expect(sched.status, JSON.stringify(sched.body).slice(0, 300)).toBe(201);
    SCHEDULE_ID = sched.body.data.id;
    const lines = sched.body.data.lines as {
      id: string;
      dueDate: string;
      customerPartNo: string;
    }[];
    LINE_A = lines.find((l) => l.dueDate.endsWith("-05"))!.id;
    LINE_B = lines.find((l) => l.dueDate.endsWith("-20"))!.id;
    LINE_C = lines.find((l) => l.customerPartNo === "OEM-P2")!.id;
  });

  it("maps customer part numbers (create, duplicate, list, edit, delete)", async () => {
    const client = await api();
    const m1 = await client
      .post(`${BASE}/part-maps`)
      .set(OWNER.auth)
      .send({ customerId: CUSTOMER_ID, productId: P1, customerPartNo: "OEM-P1", packQty: 100 });
    expect(m1.status, JSON.stringify(m1.body)).toBe(201);
    expect(m1.body.data).toMatchObject({ customerPartNo: "OEM-P1", packQty: 100, isActive: true });
    const m2 = await client.post(`${BASE}/part-maps`).set(STORES.auth).send({
      customerId: CUSTOMER_ID,
      productId: P2,
      customerPartNo: "OEM-P2",
      description: "Clip, zinc",
      packQty: 25,
      packType: "BIN",
    });
    expect(m2.status).toBe(201);

    const dup = await client
      .post(`${BASE}/part-maps`)
      .set(OWNER.auth)
      .send({ customerId: CUSTOMER_ID, productId: P3, customerPartNo: "oem-p1" });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("DUPLICATE_CUSTOMER_PART_NO");

    // The same part number is fine for another customer.
    const other = await client
      .post(`${BASE}/part-maps`)
      .set(OWNER.auth)
      .send({ customerId: OTHER_CUSTOMER_ID, productId: P1, customerPartNo: "OEM-P1" });
    expect(other.status).toBe(201);

    const list = await client
      .get(`${BASE}/part-maps`)
      .query({ customerId: CUSTOMER_ID })
      .set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((m: { customerPartNo: string }) => m.customerPartNo)).toEqual([
      "OEM-P1",
      "OEM-P2",
    ]);

    const edited = await client
      .patch(`${BASE}/part-maps/${m1.body.data.id}`)
      .set(OWNER.auth)
      .send({ description: "Bracket LH" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.description).toBe("Bracket LH");

    const del = await client.delete(`${BASE}/part-maps/${other.body.data.id}`).set(OWNER.auth);
    expect(del.status).toBe(200);
    expect(
      (
        await client
          .get(`${BASE}/part-maps`)
          .query({ customerId: OTHER_CUSTOMER_ID })
          .set(OWNER.auth)
      ).body.data
    ).toHaveLength(0);
  });

  it("rejects every invalid part mapping", async () => {
    const client = await api();
    const bad = (patch: Record<string, unknown>) =>
      client
        .post(`${BASE}/part-maps`)
        .set(OWNER.auth)
        .send({ customerId: CUSTOMER_ID, productId: P3, customerPartNo: `X-${sfx}`, ...patch });
    expect((await bad({ customerPartNo: "" })).status).toBe(400);
    expect((await bad({ customerPartNo: "X".repeat(41) })).status).toBe(400);
    expect((await bad({ packQty: 0 })).status).toBe(400);
    expect((await bad({ packQty: -5 })).status).toBe(400);
    expect((await bad({ customerId: "nope" })).status).toBe(400);
    expect((await bad({ productId: "abc" })).status).toBe(400);
    expect((await bad({ customerId: randomUUID() })).status).toBe(404);
    expect((await bad({ productId: "999999999999" })).status).toBe(404);
    const map = (
      await client.get(`${BASE}/part-maps`).query({ customerId: CUSTOMER_ID }).set(OWNER.auth)
    ).body.data[0];
    expect(
      (await client.patch(`${BASE}/part-maps/${map.id}`).set(OWNER.auth).send({})).status
    ).toBe(400);
    expect(
      (
        await client
          .patch(`${BASE}/part-maps/${map.id}`)
          .set(OWNER.auth)
          .send({ customerPartNo: "OEM-P2" })
      ).status
    ).toBe(409);
    expect(
      (await client.patch(`${BASE}/part-maps/${randomUUID()}`).set(OWNER.auth).send({ packQty: 5 }))
        .status
    ).toBe(404);
    expect((await client.delete(`${BASE}/part-maps/${randomUUID()}`).set(OWNER.auth)).status).toBe(
      404
    );
  });

  it("prefills an ASN from the invoice, the part map and the open schedule lines", async () => {
    const res = await (
      await api()
    )
      .get(`${BASE}/prefill`)
      .query({ salesInvoiceId: INVOICE_ID })
      .set(STORES.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const d = res.body.data;
    expect(d.invoice).toMatchObject({ id: INVOICE_ID, customerId: CUSTOMER_ID });
    expect(d.existingAsn).toBeNull();
    expect(d.unmappedProducts).toEqual([]);
    const lines = d.lines.map(
      (l: {
        customerPartNo: string;
        qty: number;
        packs: number;
        scheduleLineId: string | null;
      }) => [l.customerPartNo, l.qty, l.packs, l.scheduleLineId]
    );
    // 250 of P1 fills the line due on the 5th (100) then the one due on the 20th (150).
    expect(lines).toEqual([
      ["OEM-P1", 100, 1, LINE_A],
      ["OEM-P1", 150, 2, LINE_B],
      ["OEM-P2", 40, 2, LINE_C],
    ]);
  });

  it("creates the ASN from the prefill and refuses a second live ASN for the invoice", async () => {
    const client = await api();
    const res = await client
      .post(BASE)
      .set(STORES.auth)
      .send({ salesInvoiceId: INVOICE_ID, dispatchAt: nowLocal(), vehicleNo: "tn 09 ab 1234" });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
    ASN_ID = res.body.data.id;
    expect(res.body.data).toMatchObject({
      asnNo: `ASN-${INVOICE_NO}`,
      status: "DRAFT",
      customerId: CUSTOMER_ID,
      vehicleNo: "TN09AB1234",
      totalQty: 290,
      totalPacks: 5,
    });
    expect(res.body.data.lines[0].schedule.scheduleNo).toBe(`ASN-SCH-${sfx}`);

    const again = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({ salesInvoiceId: INVOICE_ID, dispatchAt: nowLocal() });
    expect(again.status).toBe(409);

    const pre = await client
      .get(`${BASE}/prefill`)
      .query({ salesInvoiceId: INVOICE_ID })
      .set(OWNER.auth);
    expect(pre.body.data.existingAsn.id).toBe(ASN_ID);

    const list = await client.get(BASE).query({ customerId: CUSTOMER_ID }).set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({ id: ASN_ID, lineCount: 3, totalPacks: 5 });
  });

  it("edits a draft, then books TN-02 dispatches when sent", async () => {
    const client = await api();
    const edit = await client
      .patch(`${BASE}/${ASN_ID}`)
      .set(OWNER.auth)
      .send({ transporterName: "VRL Logistics", lrNo: "LR-778", lrDate: today });
    expect(edit.status).toBe(200);
    expect(edit.body.data.transporterName).toBe("VRL Logistics");

    // Draft → acknowledged skips a step.
    expect(
      (
        await client
          .post(`${BASE}/${ASN_ID}/status`)
          .set(OWNER.auth)
          .send({ status: "ACKNOWLEDGED" })
      ).status
    ).toBe(409);

    const sent = await client
      .post(`${BASE}/${ASN_ID}/status`)
      .set(STORES.auth)
      .send({ status: "SENT" });
    expect(sent.status, JSON.stringify(sent.body).slice(0, 300)).toBe(200);
    expect(sent.body.data.status).toBe("SENT");
    expect(sent.body.data.lines.every((l: { dispatchBooked: boolean }) => l.dispatchBooked)).toBe(
      true
    );

    const sched = await client.get(`/api/delivery-schedules/${SCHEDULE_ID}`).set(OWNER.auth);
    const byId = Object.fromEntries(
      (sched.body.data.lines as { id: string; dispatches: { qty: number; asnNo: string }[] }[]).map(
        (l) => [l.id, l.dispatches]
      )
    );
    expect(byId[LINE_A]).toEqual([
      expect.objectContaining({ qty: 100, asnNo: `ASN-${INVOICE_NO}` }),
    ]);
    expect(byId[LINE_B]).toEqual([expect.objectContaining({ qty: 150 })]);
    expect(byId[LINE_C]).toEqual([expect.objectContaining({ qty: 40 })]);

    // A sent ASN is frozen.
    expect(
      (await client.patch(`${BASE}/${ASN_ID}`).set(OWNER.auth).send({ notes: "late change" }))
        .status
    ).toBe(409);

    const ack = await client
      .post(`${BASE}/${ASN_ID}/status`)
      .set(OWNER.auth)
      .send({ status: "ACKNOWLEDGED", ackRef: "GRN-5501" });
    expect(ack.status).toBe(200);
    expect(ack.body.data).toMatchObject({ status: "ACKNOWLEDGED", ackRef: "GRN-5501" });
    // Acknowledged is final.
    expect(
      (
        await client
          .post(`${BASE}/${ASN_ID}/status`)
          .set(OWNER.auth)
          .send({ status: "CANCELLED", reason: "wrong truck" })
      ).status
    ).toBe(409);
  });

  it("exports the generic CSV and refuses unknown or unbuilt formats", async () => {
    const client = await api();
    const formats = await client.get(`${BASE}/export-formats`).set(OWNER.auth);
    expect(formats.status).toBe(200);
    expect(formats.body.data.find((f: { key: string }) => f.key === "GENERIC_CSV").available).toBe(
      true
    );

    const csv = await client
      .get(`${BASE}/${ASN_ID}/export`)
      .query({ format: "GENERIC_CSV" })
      .set(STORES.auth);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const rows = csv.text
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("Customer Part No");
    expect(rows[1]).toContain(`ASN-${INVOICE_NO}`);
    expect(rows[1]).toContain("TN09AB1234");
    expect(rows[1]).toContain("OEM-P1");

    expect(
      (await client.get(`${BASE}/${ASN_ID}/export`).query({ format: "NOPE" }).set(OWNER.auth))
        .status
    ).toBe(400);
    const todo = formats.body.data.find((f: { available: boolean }) => !f.available);
    const unbuilt = await client
      .get(`${BASE}/${ASN_ID}/export`)
      .query({ format: todo.key })
      .set(OWNER.auth);
    expect(unbuilt.status).toBe(501);
  });

  it("prints the packing labels as a PDF on both sheet sizes", async () => {
    const client = await api();
    for (const size of ["A4", "100X150"]) {
      const pdf = await client
        .get(`${BASE}/${ASN_ID}/labels`)
        .query({ size })
        .set(OWNER.auth)
        .buffer(true)
        .parse(binary);
      expect(pdf.status).toBe(200);
      expect(pdf.headers["content-type"]).toContain("application/pdf");
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    }
    expect(
      (await client.get(`${BASE}/${ASN_ID}/labels`).query({ size: "A5" }).set(OWNER.auth)).status
    ).toBe(400);
  }, 60_000);

  it("cancelling a sent ASN removes its dispatches from adherence", async () => {
    const client = await api();
    const inv = await invoiceWith(CUSTOMER_ID, [{ productId: P1, qty: 30 }]);
    const created = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({
        salesInvoiceId: inv.id,
        asnNo: `ASN-X-${sfx}`,
        dispatchAt: `${today}T09:15:00+05:30`,
        lines: [
          { productId: P1, customerPartNo: "OEM-P1", qty: 30, packQty: 12, scheduleLineId: LINE_B },
        ],
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(created.body.data.totalPacks).toBe(3);
    const id = created.body.data.id;
    expect(
      (await client.post(`${BASE}/${id}/status`).set(OWNER.auth).send({ status: "SENT" })).status
    ).toBe(200);

    const dispatchesOnB = async () =>
      (
        (await client.get(`/api/delivery-schedules/${SCHEDULE_ID}`).set(OWNER.auth)).body.data
          .lines as {
          id: string;
          dispatches: unknown[];
        }[]
      ).find((l) => l.id === LINE_B)!.dispatches.length;
    expect(await dispatchesOnB()).toBe(2);

    // A reason is required.
    expect(
      (await client.post(`${BASE}/${id}/status`).set(OWNER.auth).send({ status: "CANCELLED" }))
        .status
    ).toBe(400);
    const cancelled = await client
      .post(`${BASE}/${id}/status`)
      .set(OWNER.auth)
      .send({ status: "CANCELLED", reason: "Truck broke down" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      status: "CANCELLED",
      cancelReason: "Truck broke down",
    });
    expect(await dispatchesOnB()).toBe(1);

    // No export or labels for a cancelled ASN; a new one may now be raised for the invoice.
    expect((await client.get(`${BASE}/${id}/export`).set(OWNER.auth)).status).toBe(409);
    expect((await client.get(`${BASE}/${id}/labels`).set(OWNER.auth)).status).toBe(409);
    const redo = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({
        salesInvoiceId: inv.id,
        dispatchAt: nowLocal(),
        lines: [{ productId: P1, customerPartNo: "OEM-P1", qty: 30, packQty: 30 }],
      });
    expect(redo.status).toBe(201);
    expect(redo.body.data.asnNo).toBe(`ASN-${inv.invoiceNo}`);
    expect((await client.delete(`${BASE}/${id}`).set(OWNER.auth)).status).toBe(404);
  });

  it("rejects every invalid ASN", async () => {
    const client = await api();
    const inv = await invoiceWith(CUSTOMER_ID, [{ productId: P1, qty: 10 }]);
    const unmappedInv = await invoiceWith(CUSTOMER_ID, [{ productId: P3, qty: 5 }]);
    const cancelledInv = await invoiceWith(CUSTOMER_ID, [{ productId: P1, qty: 5 }], {
      status: "CANCELLED",
    });
    const oldInv = await invoiceWith(CUSTOMER_ID, [{ productId: P1, qty: 5 }]);
    const line = (over: Record<string, unknown> = {}) => ({
      productId: P1,
      customerPartNo: "OEM-P1",
      qty: 10,
      packQty: 5,
      ...over,
    });
    const post = (body: Record<string, unknown>) =>
      client
        .post(BASE)
        .set(OWNER.auth)
        .send({ salesInvoiceId: inv.id, dispatchAt: nowLocal(), lines: [line()], ...body });
    const code = (res: { body: Record<string, unknown> }) => JSON.stringify(res.body);

    expect((await post({ salesInvoiceId: "nope" })).status).toBe(400);
    expect((await post({ salesInvoiceId: randomUUID() })).status).toBe(404);
    expect((await post({ dispatchAt: "27/09/2026 10:00" })).status).toBe(400);
    expect((await post({ dispatchAt: undefined })).status).toBe(400);
    expect((await post({ vehicleNo: "12" })).status).toBe(400);
    expect((await post({ asnNo: "has space" })).status).toBe(400);
    expect((await post({ asnNo: "A".repeat(41) })).status).toBe(400);
    expect((await post({ lrDate: "yesterday" })).status).toBe(400);
    expect((await post({ lines: [] })).status).toBe(400);
    expect((await post({ lines: [line({ qty: 0 })] })).status).toBe(400);
    expect((await post({ lines: [line({ packQty: -1 })] })).status).toBe(400);
    expect((await post({ lines: [line({ customerPartNo: "" })] })).status).toBe(400);
    expect((await post({ lines: [line({ scheduleLineId: "x" })] })).status).toBe(400);

    const notOnInvoice = await post({ lines: [line({ productId: P2 })] });
    expect(notOnInvoice.status).toBe(400);
    expect(code(notOnInvoice)).toContain("PRODUCT_NOT_ON_INVOICE");
    const tooMuch = await post({ lines: [line({ qty: 6 }), line({ qty: 5 })] });
    expect(tooMuch.status).toBe(400);
    expect(code(tooMuch)).toContain("QTY_EXCEEDS_INVOICE");
    const tooManyPacks = await post({ lines: [line({ packQty: 0.001 })] });
    expect(tooManyPacks.status).toBe(400);
    expect(code(tooManyPacks)).toContain("TOO_MANY_PACKS");
    expect((await post({ lines: [line({ scheduleLineId: randomUUID() })] })).status).toBe(404);
    const wrongPart = await post({ lines: [line({ scheduleLineId: LINE_C })] });
    expect(wrongPart.status).toBe(400);
    expect(code(wrongPart)).toContain("SCHEDULE_PART_MISMATCH");
    const past = await post({ dispatchAt: "2020-01-01T10:00" });
    expect(past.status).toBe(400);
    expect(code(past)).toContain("DISPATCH_BEFORE_INVOICE");

    const unmapped = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({ salesInvoiceId: unmappedInv.id, dispatchAt: nowLocal() });
    expect(unmapped.status).toBe(400);
    expect(code(unmapped)).toContain("PART_NOT_MAPPED");

    const cancelled = await post({ salesInvoiceId: cancelledInv.id });
    expect(cancelled.status).toBe(409);

    // A schedule line of another customer.
    const otherSched = await client
      .post("/api/delivery-schedules")
      .set(OWNER.auth)
      .send({
        scheduleNo: `ASN-OTH-${sfx}`,
        customerId: OTHER_CUSTOMER_ID,
        periodMonth: month,
        receivedOn: today,
        lines: [{ customerPartNo: "OEM-P1", dueDate: `${month}-15`, scheduledQty: 10 }],
      });
    const foreignLine = otherSched.body.data.lines[0].id;
    const mismatch = await post({ lines: [line({ scheduleLineId: foreignLine })] });
    expect(mismatch.status).toBe(400);
    expect(code(mismatch)).toContain("SCHEDULE_CUSTOMER_MISMATCH");

    // Duplicate ASN number.
    const first = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({
        salesInvoiceId: oldInv.id,
        asnNo: `DUP-${sfx}`,
        dispatchAt: nowLocal(),
        lines: [line({ qty: 5 })],
      });
    expect(first.status).toBe(201);
    const dup = await post({ asnNo: `DUP-${sfx}` });
    expect(dup.status).toBe(409);

    // Update and status validation.
    const id = first.body.data.id;
    expect((await client.patch(`${BASE}/${id}`).set(OWNER.auth).send({})).status).toBe(400);
    expect(
      (await client.patch(`${BASE}/${id}`).set(OWNER.auth).send({ vehicleNo: "?" })).status
    ).toBe(400);
    expect(
      (
        await client
          .patch(`${BASE}/${id}`)
          .set(OWNER.auth)
          .send({ lines: [line({ qty: 50 })] })
      ).status
    ).toBe(400);
    expect(
      (await client.post(`${BASE}/${id}/status`).set(OWNER.auth).send({ status: "DRAFT" })).status
    ).toBe(400);
    expect((await client.get(`${BASE}/not-a-uuid`).set(OWNER.auth)).status).toBe(400);
    expect((await client.get(`${BASE}/${randomUUID()}`).set(OWNER.auth)).status).toBe(404);
    expect((await client.get(`${BASE}/prefill`).set(OWNER.auth)).status).toBe(400);
    // No raw error text leaks out.
    expect(code(mismatch)).not.toMatch(/prisma|stack|at .*\.ts/i);
  });

  it("refuses a role without asn permissions", async () => {
    const client = await api();
    expect((await client.get(BASE).set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.get(`${BASE}/part-maps`).set(ACCOUNTS.auth)).status).toBe(403);
    expect(
      (
        await client
          .post(BASE)
          .set(ACCOUNTS.auth)
          .send({ salesInvoiceId: INVOICE_ID, dispatchAt: nowLocal() })
      ).status
    ).toBe(403);
    expect((await client.get(`${BASE}/${ASN_ID}/export`).set(ACCOUNTS.auth)).status).toBe(403);
    expect((await client.get(BASE).set(STORES.auth)).status).toBe(200);
  });

  it("a foreign company sees none of this, and its invoice, customer and schedule are rejected", async () => {
    const prisma = await getPrisma();
    const client = await api();
    const other = await withoutTenant(() =>
      prisma.company.create({ data: { companyName: "ASN Tenant B", companyCode: `ASB-${sfx}` } })
    );
    expect(await runAsTenant(other.id, () => prisma.asn.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.asnLine.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.customerPartMap.count())).toBe(0);
    expect(
      await runAsTenant(other.id, () => prisma.asn.findFirst({ where: { id: ASN_ID } }))
    ).toBeNull();
    expect(await asDemoTenant(() => prisma.asn.count())).toBeGreaterThan(0);

    const demo = await demoCompany();
    const { customer, invoice, scheduleLine } = await runAsTenant(other.id, async () => {
      const customer = await prisma.customer.create({
        data: {
          companyId: other.id,
          customerCode: `FC${sfx}`,
          firmName: "Foreign OEM",
          createdBy: "test",
        },
      });
      const invoice = await prisma.salesInvoice.create({
        data: {
          companyId: other.id,
          invoiceNo: `FINV-${sfx}`,
          invoiceDate: new Date(`${today}T00:00:00Z`),
          customerId: customer.id,
          subTotal: D(1),
          taxTotal: D(0),
          grandTotal: D(1),
        },
      });
      const schedule = await prisma.customerSchedule.create({
        data: {
          companyId: other.id,
          scheduleNo: `FS-${sfx}`,
          customerId: customer.id,
          periodMonth: new Date(`${month}-01T00:00:00Z`),
          receivedOn: new Date(`${today}T00:00:00Z`),
          lines: {
            create: {
              companyId: other.id,
              customerPartNo: "OEM-P1",
              dueDate: new Date(`${month}-10T00:00:00Z`),
              scheduledQty: D(10),
            },
          },
        },
        include: { lines: true },
      });
      return { customer, invoice, scheduleLine: schedule.lines[0] };
    });
    expect(demo.id).not.toBe(other.id);

    const foreignInvoice = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({ salesInvoiceId: invoice.id, dispatchAt: nowLocal() });
    expect(foreignInvoice.status).toBe(404);
    expect(
      (await client.get(`${BASE}/prefill`).query({ salesInvoiceId: invoice.id }).set(OWNER.auth))
        .status
    ).toBe(404);
    const foreignCustomer = await client
      .post(`${BASE}/part-maps`)
      .set(OWNER.auth)
      .send({ customerId: customer.id, productId: P1, customerPartNo: `F-${sfx}` });
    expect(foreignCustomer.status).toBe(404);

    const inv = await invoiceWith(CUSTOMER_ID, [{ productId: P1, qty: 5 }]);
    const foreignSchedule = await client
      .post(BASE)
      .set(OWNER.auth)
      .send({
        salesInvoiceId: inv.id,
        dispatchAt: nowLocal(),
        lines: [
          {
            productId: P1,
            customerPartNo: "OEM-P1",
            qty: 5,
            packQty: 5,
            scheduleLineId: scheduleLine.id,
          },
        ],
      });
    expect(foreignSchedule.status).toBe(404);
  });
});
