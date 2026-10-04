import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { expectCleanError } from "../helpers/clean-error";
import { foreignTenant } from "../helpers/foreign-tenant";
import { asDemoTenant, createCustomer, createEmployee, createProduct } from "../factories";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * Sales orders and quotations (R-04, characterisation). Pins today's behaviour of
 * `apps/api/src/modules/sales-order/`:
 *  - one table serves both orders and quotations: a line with `quotationUnitPrice` makes the
 *    document a quotation (price kept apart from `unitPrice`);
 *  - the totals are computed server-side: subtotal, order discount (PERCENT or FLAT), GST on the
 *    discounted amount (CGST+SGST intra-state, IGST inter-state) and bill sundries;
 *  - status moves through PATCH actions or a plain PUT, which has no transition table;
 *  - only DRAFT-like orders can be deleted, and only while no invoice is linked.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
let seq = 0;
const orderNo = () => `SO-T${sfx}-${++seq}`;

let OWNER: { auth: Record<string, string> };
let FOREIGN: Awaited<ReturnType<typeof foreignTenant>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let productA: Awaited<ReturnType<typeof createProduct>>;
let productB: Awaited<ReturnType<typeof createProduct>>;

const N = (v: unknown) => Number(v);
const line = (p: { id: bigint }, over: Record<string, unknown> = {}) => ({
  productId: p.id.toString(),
  quantity: 10,
  unitPrice: 100,
  ...over,
});
const payload = (over: Record<string, unknown> = {}) => ({
  orderNo: orderNo(),
  orderDate: "2026-09-15",
  customerId: customer.id,
  items: [line(productA)],
  ...over,
});
const create = async (over: Record<string, unknown> = {}, auth = OWNER.auth) =>
  (await api()).post("/api/sales-orders").set(auth).send(payload(over));

describe("sales orders", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    FOREIGN = await foreignTenant("xso");
    customer = await createCustomer();
    productA = await createProduct();
    productB = await createProduct();
  });

  describe("create and read", () => {
    it("creates a DRAFT order with server-computed totals and no tax by default", async () => {
      const res = await create({
        items: [line(productA), line(productB, { quantity: 5, unitPrice: 40 })],
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
      const o = res.body.data;
      expect(o.status).toBe("DRAFT");
      expect(N(o.subtotal)).toBe(1200);
      expect(N(o.netAmount)).toBe(1200);
      expect(N(o.totalTax)).toBe(0);
      expect(o.items).toHaveLength(2);
      expect(N(o.items[0].lineTotal)).toBe(1000);
      expect(o.customer.id).toBe(customer.id);
    });

    it("splits GST into CGST+SGST intra-state and IGST inter-state, on the discounted amount", async () => {
      const intra = await create({
        orderDiscountType: "PERCENT",
        orderDiscountValue: 10,
        items: [line(productA, { cgstRate: 9, sgstRate: 9, igstRate: 18 })],
      });
      expect(intra.status, JSON.stringify(intra.body).slice(0, 400)).toBe(201);
      // 1000 gross, 10% off = 900 taxable; tax 18% of 1000 = 180 scaled by 0.9 = 162.
      expect(N(intra.body.data.totalDiscount)).toBe(100);
      expect(N(intra.body.data.totalCgst)).toBe(90);
      expect(N(intra.body.data.totalSgst)).toBe(90);
      expect(N(intra.body.data.totalIgst)).toBe(0);
      expect(N(intra.body.data.netAmount)).toBe(1062);

      const inter = await create({
        isInterState: true,
        orderDiscountType: "FLAT",
        orderDiscountValue: 50,
        items: [line(productA, { cgstRate: 9, sgstRate: 9, igstRate: 18 })],
      });
      expect(inter.status).toBe(201);
      expect(N(inter.body.data.totalCgst)).toBe(0);
      expect(N(inter.body.data.totalIgst)).toBe(180);
      expect(N(inter.body.data.netAmount)).toBe(950 + 180 * 0.95);
    });

    it("applies bill sundries with their sign", async () => {
      const res = await create({
        billSundry: [
          { type: "LORRY_FREIGHT_PLUS", amount: 75 },
          { type: "DISCOUNT_MINUS", amount: 25 },
        ],
      });
      expect(res.status).toBe(201);
      expect(N(res.body.data.netAmount)).toBe(1050);
    });

    it("treats a line with quotationUnitPrice as a quotation and keeps the unit price at zero", async () => {
      const res = await create({
        items: [line(productA, { unitPrice: undefined, quotationUnitPrice: 120 })],
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
      expect(N(res.body.data.items[0].quotationUnitPrice)).toBe(120);
      expect(N(res.body.data.items[0].unitPrice)).toBe(0);
      expect(N(res.body.data.subtotal)).toBe(1200);

      const list = await (
        await api()
      )
        .get("/api/sales-orders")
        .query({ quotationOnly: "true", search: res.body.data.orderNo })
        .set(OWNER.auth);
      expect(list.body.data.data.map((o: { id: number }) => o.id)).toContain(res.body.data.id);
    });

    it("falls back to the product master rate when no price is sent", async () => {
      const res = await create({ items: [{ productId: productA.id.toString(), quantity: 2 }] });
      expect(res.status).toBe(201);
      expect(N(res.body.data.items[0].unitPrice)).toBe(N(productA.rate));
    });

    it("lists with filters, search, paging and sorting", async () => {
      const a = await create();
      const b = await create({ orderDate: "2026-09-20" });
      const client = await api();
      const res = await client
        .get("/api/sales-orders")
        .query({
          customerId: customer.id,
          pageSize: "1",
          page: "1",
          sortBy: "orderNo",
          sortOrder: "asc",
        })
        .set(OWNER.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.data).toHaveLength(1);
      expect(res.body.data.pageSize).toBe(1);
      expect(res.body.data.total).toBeGreaterThanOrEqual(2);
      expect(res.body.data.totalPages).toBe(res.body.data.total);

      const byNo = await client
        .get("/api/sales-orders")
        .query({ search: b.body.data.orderNo.toLowerCase() })
        .set(OWNER.auth);
      expect(byNo.body.data.data.map((o: { id: number }) => o.id)).toEqual([b.body.data.id]);

      const dated = await client
        .get("/api/sales-orders")
        .query({
          customerId: customer.id,
          fromDate: "2026-09-18",
          toDate: "2026-09-30",
          search: sfx,
        })
        .set(OWNER.auth);
      expect(
        dated.body.data.data.every((o: { orderDate: string }) => o.orderDate >= "2026-09-18")
      ).toBe(true);
      expect(dated.body.data.data.map((o: { id: number }) => o.id)).toContain(b.body.data.id);
      expect(dated.body.data.data.map((o: { id: number }) => o.id)).not.toContain(a.body.data.id);

      const statuses = await client
        .get("/api/sales-orders")
        .query({ status: "CONFIRMED,NOT_A_STATUS", customerId: customer.id })
        .set(OWNER.auth);
      expect(statuses.status).toBe(200);
      expect(
        statuses.body.data.data.every((o: { status: string }) => o.status === "CONFIRMED")
      ).toBe(true);
    });

    it("fetches one order with customer, items and latest invoice, and reports its status", async () => {
      const created = await create();
      const id = created.body.data.id;
      const client = await api();
      const one = await client.get(`/api/sales-orders/${id}`).set(OWNER.auth);
      expect(one.status).toBe(200);
      expect(one.body.data.orderNo).toBe(created.body.data.orderNo);
      expect(one.body.data.salesInvoices).toEqual([]);
      expect(
        one.body.data.customer.customerGrade === null || typeof one.body.data.customer === "object"
      ).toBe(true);

      const status = await client.get(`/api/sales-orders/${id}/status`).set(OWNER.auth);
      expect(status.status).toBe(200);
      expect(status.body.data).toMatchObject({
        id,
        status: "DRAFT",
        canEdit: true,
        canDelete: true,
      });
    });

    it("suggests the next order and quotation codes from the year's last number", async () => {
      const year = new Date().getFullYear();
      const client = await api();
      const so = await client.get("/api/sales-orders/next-code").set(OWNER.auth);
      expect(so.status).toBe(200);
      expect(so.body.data.nextCode).toMatch(new RegExp(`^SO-${year}-\\d{3,}$`));
      const qt = await client.get("/api/sales-orders/next-quotation-code").set(OWNER.auth);
      expect(qt.body.data.nextCode).toMatch(new RegExp(`^QT-${year}-\\d{3,}$`));
    });
  });

  describe("update, workflow and delete", () => {
    it("updates header fields and replaces the lines, recomputing totals", async () => {
      const created = await create();
      const id = created.body.data.id;
      const res = await (
        await api()
      )
        .put(`/api/sales-orders/${id}`)
        .set(OWNER.auth)
        .send({
          narration: "Rush order",
          orderType: "telephone",
          items: [line(productB, { quantity: 3, unitPrice: 50 })],
        });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
      expect(res.body.data.narration).toBe("Rush order");
      expect(res.body.data.orderType).toBe("telephone");
      expect(res.body.data.status).toBe("DRAFT");
      expect(res.body.data.items).toHaveLength(1);
      expect(N(res.body.data.subtotal)).toBe(150);
      // orderNo and customerId are not editable: the update schema drops them.
      const sneaky = await (
        await api()
      )
        .put(`/api/sales-orders/${id}`)
        .set(OWNER.auth)
        .send({ orderNo: "CHANGED", customerId: customer.id });
      expect(sneaky.status).toBe(200);
      expect(sneaky.body.data.orderNo).toBe(created.body.data.orderNo);
    });

    it("confirms, marks in quotation, converts, and then refuses edits and deletion", async () => {
      const created = await create();
      const id = created.body.data.id;
      const client = await api();

      const confirm = await client.patch(`/api/sales-orders/${id}/confirm`).set(OWNER.auth);
      expect(confirm.status, JSON.stringify(confirm.body).slice(0, 300)).toBe(200);
      expect(confirm.body.data.status).toBe("CONFIRMED");
      expect(N(confirm.body.data.netAmount)).toBe(1000);
      // Confirming twice is a conflict.
      expectCleanError(
        await client.patch(`/api/sales-orders/${id}/confirm`).set(OWNER.auth),
        409,
        /Cannot confirm/
      );

      const status = await client.get(`/api/sales-orders/${id}/status`).set(OWNER.auth);
      expect(status.body.data).toMatchObject({ canEdit: true, canDelete: false });

      const quoting = await client
        .patch(`/api/sales-orders/${id}/mark-in-quotation`)
        .set(OWNER.auth);
      expect(quoting.status).toBe(200);
      expect(quoting.body.data.status).toBe("QUOTATION_IN_PROGRESS");
      // Anything that is not CONFIRMED is returned untouched.
      const again = await client.patch(`/api/sales-orders/${id}/mark-in-quotation`).set(OWNER.auth);
      expect(again.body.data).toEqual({ id, status: "QUOTATION_IN_PROGRESS" });

      expectCleanError(
        await client.patch(`/api/sales-orders/${id}/convert-to-order`).set(OWNER.auth),
        409,
        /Cannot convert/
      );
    });

    it("converts a confirmed quotation to a sales order, promoting the quotation price", async () => {
      const created = await create({
        status: "CONFIRMED",
        items: [line(productA, { unitPrice: undefined, quotationUnitPrice: 130 })],
      });
      expect(created.status).toBe(201);
      const client = await api();
      const res = await client
        .patch(`/api/sales-orders/${created.body.data.id}/convert-to-order`)
        .set(OWNER.auth);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      expect(res.body.data.status).toBe("QUOTATION_COMPLETED");
      const one = await client.get(`/api/sales-orders/${created.body.data.id}`).set(OWNER.auth);
      expect(N(one.body.data.items[0].unitPrice)).toBe(130);
    });

    it("moves status through a plain PUT with no transition guard, but refuses edits once in production", async () => {
      const created = await create();
      const id = created.body.data.id;
      const client = await api();
      const jump = await client
        .put(`/api/sales-orders/${id}`)
        .set(OWNER.auth)
        .send({ status: "IN_PRODUCTION" });
      expect(jump.status).toBe(200);
      expect(jump.body.data.status).toBe("IN_PRODUCTION");
      expectCleanError(
        await client.put(`/api/sales-orders/${id}`).set(OWNER.auth).send({ narration: "late" }),
        409,
        /Cannot edit order in status IN_PRODUCTION/
      );
      expectCleanError(
        await client.delete(`/api/sales-orders/${id}`).set(OWNER.auth),
        400,
        /Cannot delete/
      );
    });

    it("deletes a draft order with its lines, and refuses when an invoice is linked", async () => {
      const client = await api();
      const draft = await create();
      const del = await client.delete(`/api/sales-orders/${draft.body.data.id}`).set(OWNER.auth);
      expect(del.status).toBe(200);
      expectCleanError(
        await client.get(`/api/sales-orders/${draft.body.data.id}`).set(OWNER.auth),
        404
      );

      const linked = await create();
      const prisma = await getPrisma();
      const inv = await asDemoTenant(() =>
        prisma.salesInvoice.create({
          data: {
            invoiceNo: `INV-T${sfx}${++seq}`,
            invoiceDate: new Date(),
            customerId: customer.id,
            salesOrderId: linked.body.data.id,
            subTotal: 1,
            taxTotal: 0,
            grandTotal: 1,
            status: "UNPAID",
            payments: [],
          } as never,
        })
      );
      expect(inv.id).toBeTruthy();
      expectCleanError(
        await client.delete(`/api/sales-orders/${linked.body.data.id}`).set(OWNER.auth),
        400,
        /invoice\(s\) are linked/
      );
    });

    it("checks the credit block and lists source orders for a customer", async () => {
      const c = await createCustomer();
      const client = await api();
      const clear = await client
        .get("/api/sales-orders/credit-block-check")
        .query({ customerId: c.id })
        .set(OWNER.auth);
      expect(clear.status).toBe(200);
      expect(clear.body.data.blocked).toBe(false);

      const pending = await create({ customerId: c.id, status: "PENDING_CUSTOMER_APPROVAL" });
      expect(pending.status).toBe(201);
      const blocked = await client
        .get("/api/sales-orders/credit-block-check")
        .query({ customerId: c.id })
        .set(OWNER.auth);
      expect(blocked.body.data.blocked).toBe(true);
      expect(blocked.body.data.blockingOrder.orderNo).toBe(pending.body.data.orderNo);

      const confirmed = await create({ customerId: c.id, status: "CONFIRMED" });
      const sources = await client
        .get("/api/sales-orders/source-orders")
        .query({ customerId: c.id })
        .set(OWNER.auth);
      expect(sources.status).toBe(200);
      expect(sources.body.data.map((o: { id: number }) => o.id)).toEqual([confirmed.body.data.id]);
    });

    it("answers customerId-less credit and source lookups with a clean 400", async () => {
      const client = await api();
      expectCleanError(
        await client.get("/api/sales-orders/credit-block-check").set(OWNER.auth),
        400,
        "customerId is required"
      );
      expectCleanError(
        await client.get("/api/sales-orders/source-orders").set(OWNER.auth),
        400,
        "customerId is required"
      );
    });
  });

  describe("quotation delivery", () => {
    it("asks for a recipient before rendering or sending anything", async () => {
      const created = await create();
      const id = created.body.data.id;
      const client = await api();
      expectCleanError(
        await client.post(`/api/sales-orders/${id}/email-quotation`).set(OWNER.auth).send({}),
        400,
        "Recipient email is required"
      );
      expectCleanError(
        await client.post(`/api/sales-orders/${id}/whatsapp-quotation`).set(OWNER.auth).send({}),
        400,
        "Recipient phone number is required"
      );
    });
  });

  describe("validation", () => {
    const paths = (res: { body: { errors: { path: string }[] } }) =>
      res.body.errors.map((e) => e.path);

    it("rejects an empty body with field-level errors", async () => {
      const res = await (await api()).post("/api/sales-orders").set(OWNER.auth).send({});
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining(["body.orderNo", "body.orderDate", "body.customerId", "body.items"])
      );
    });

    it("rejects bad customer id, date, status, enums, quantity and an empty item list", async () => {
      const res = await create({
        customerId: "not-a-uuid",
        orderDate: "yesterday-ish",
        status: "WHENEVER",
        orderType: "carrier-pigeon",
        orderSource: "SKYWRITING",
        orderDiscountType: "BARTER",
        orderDiscountValue: -5,
        narration: "x".repeat(1001),
        items: [{ productId: "abc", quantity: 0 }],
      });
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(
        expect.arrayContaining([
          "body.customerId",
          "body.orderDate",
          "body.status",
          "body.orderType",
          "body.orderSource",
          "body.orderDiscountType",
          "body.orderDiscountValue",
          "body.narration",
          "body.items.0.productId",
          "body.items.0.quantity",
        ])
      );
      expectCleanError(await create({ items: [] }), 400, "Validation failed");
    });

    it("requires a sales person for salesperson orders, reference text for reference orders, and unique lines", async () => {
      const sp = await create({ orderType: "salesperson" });
      expectCleanError(sp, 400, "Validation failed");
      expect(paths(sp)).toContain("body.salesPersonName");
      const ref = await create({ orderType: "reference" });
      expect(paths(ref)).toContain("body.referenceText");
      const dup = await create({ items: [line(productA), line(productA, { quantity: 1 })] });
      expectCleanError(dup, 400, "Validation failed");
      expect(paths(dup)).toContain("body.items.1.productId");
      expect(paths(dup)).toContain("body.items.0.productId");
    });

    it("rejects out-of-range GST rates and over-long order numbers", async () => {
      const res = await create({
        orderNo: "S".repeat(31),
        items: [line(productA, { cgstRate: 101 })],
      });
      expectCleanError(res, 400, "Validation failed");
      expect(paths(res)).toEqual(expect.arrayContaining(["body.orderNo", "body.items.0.cgstRate"]));
    });

    it("rejects unknown customers and products, and duplicate order numbers", async () => {
      const ghostCustomer = await create({ customerId: "00000000-0000-4000-8000-000000000000" });
      expectCleanError(ghostCustomer, 404, /Customer .* not found/);
      const ghostProduct = await create({ items: [{ productId: "999999999", quantity: 1 }] });
      expectCleanError(ghostProduct, 404, /Product\(s\) not found or inactive/);
      const first = await create();
      expectCleanError(await create({ orderNo: first.body.data.orderNo }), 409, /already exists/);
    });

    it("rejects over-long free text and amounts that overflow the column with a 4xx, never a 500", async () => {
      const mobile = await create({ mobile: "9".repeat(40) });
      expect(mobile.status, JSON.stringify(mobile.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
      expect(mobile.status).toBeLessThan(500);
      const overflow = await create({ items: [line(productA, { quantity: 1e9, unitPrice: 1e9 })] });
      expect(overflow.status, JSON.stringify(overflow.body).slice(0, 300)).toBeGreaterThanOrEqual(
        400
      );
      expect(overflow.status).toBeLessThan(500);
      const name = await create({ orderType: "salesperson", salesPersonName: "N".repeat(150) });
      expect(name.status, JSON.stringify(name.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
      expect(name.status).toBeLessThan(500);
    });

    it("rejects bad update bodies, unknown statuses and bad list filters", async () => {
      const created = await create();
      const client = await api();
      const upd = await client
        .put(`/api/sales-orders/${created.body.data.id}`)
        .set(OWNER.auth)
        .send({ status: "WHENEVER", items: [] });
      expectCleanError(upd, 400, "Validation failed");
      expectCleanError(
        await client.get("/api/sales-orders").query({ page: "0" }).set(OWNER.auth),
        400,
        "Validation failed"
      );
      expectCleanError(
        await client.get("/api/sales-orders").query({ pageSize: "501" }).set(OWNER.auth),
        400,
        "Validation failed"
      );
    });

    it("rejects replacing lines with an unknown product and leaves the order's lines intact", async () => {
      const created = await create();
      const id = created.body.data.id;
      const client = await api();
      const res = await client
        .put(`/api/sales-orders/${id}`)
        .set(OWNER.auth)
        .send({ items: [{ productId: "999999999", quantity: 1 }] });
      expectCleanError(res, 404, /Product\(s\) not found or inactive/);
      const one = await client.get(`/api/sales-orders/${id}`).set(OWNER.auth);
      expect(one.body.data.items).toHaveLength(1);
    });

    it("keeps the lines when an update fails after they were replaced", async () => {
      const created = await create();
      const id = created.body.data.id;
      const client = await api();
      const res = await client
        .put(`/api/sales-orders/${id}`)
        .set(OWNER.auth)
        .send({ sourceEmployeeId: 999999999, items: [line(productB, { quantity: 1 })] });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      const one = await client.get(`/api/sales-orders/${id}`).set(OWNER.auth);
      expect(one.body.data.items).toHaveLength(1);
      expect(one.body.data.items[0].productId).toBe(productA.id.toString());
    });

    it("answers 404 for unknown ids and 4xx (not 500) for malformed or out-of-range ids", async () => {
      const client = await api();
      for (const path of ["", "/status"]) {
        expectCleanError(
          await client.get(`/api/sales-orders/999999999${path}`).set(OWNER.auth),
          404
        );
      }
      expectCleanError(
        await client.put("/api/sales-orders/999999999").set(OWNER.auth).send({ narration: "x" }),
        404
      );
      expectCleanError(await client.delete("/api/sales-orders/999999999").set(OWNER.auth), 404);
      expectCleanError(
        await client.patch("/api/sales-orders/999999999/confirm").set(OWNER.auth),
        404
      );
      expectCleanError(
        await client.patch("/api/sales-orders/999999999/mark-in-quotation").set(OWNER.auth),
        404
      );
      expectCleanError(
        await client.get("/api/sales-orders/abc").set(OWNER.auth),
        400,
        "Validation failed"
      );
      for (const bad of ["1.5", "99999999999", "1e99"]) {
        const res = await client.get(`/api/sales-orders/${bad}`).set(OWNER.auth);
        expect(
          res.status,
          `${bad}: ${JSON.stringify(res.body).slice(0, 200)}`
        ).toBeGreaterThanOrEqual(400);
        expect(res.status, bad).toBeLessThan(500);
      }
    });
  });

  describe("permissions", () => {
    it("lets a sales executive view and create but not edit, delete or confirm", async () => {
      const sales = await authed("demo.sales");
      const client = await api();
      const created = await create({}, sales.auth);
      expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
      const id = created.body.data.id;
      expect((await client.get(`/api/sales-orders/${id}`).set(sales.auth)).status).toBe(200);
      expect((await client.get("/api/sales-orders").set(sales.auth)).status).toBe(200);
      expectCleanError(
        await client.put(`/api/sales-orders/${id}`).set(sales.auth).send({ narration: "x" }),
        403
      );
      expectCleanError(await client.delete(`/api/sales-orders/${id}`).set(sales.auth), 403);
      expectCleanError(await client.patch(`/api/sales-orders/${id}/confirm`).set(sales.auth), 403);
      expectCleanError(
        await client.patch(`/api/sales-orders/${id}/convert-to-order`).set(sales.auth),
        403
      );
      expectCleanError(
        await client
          .post(`/api/sales-orders/${id}/email-quotation`)
          .set(sales.auth)
          .send({ recipientEmail: "a@b.co" }),
        403
      );
      expectCleanError(
        await client
          .post(`/api/sales-orders/${id}/whatsapp-quotation`)
          .set(sales.auth)
          .send({ to: "9876543210" }),
        403
      );
    });

    it("refuses every route to a role without sales-orders.* and to anonymous callers", async () => {
      const stores = await authed("demo.stores");
      const client = await api();
      const h = stores.auth;
      expectCleanError(await client.get("/api/sales-orders").set(h), 403);
      expectCleanError(await client.get("/api/sales-orders/next-code").set(h), 403);
      expectCleanError(await client.get("/api/sales-orders/next-quotation-code").set(h), 403);
      expectCleanError(
        await client
          .get("/api/sales-orders/source-orders")
          .query({ customerId: customer.id })
          .set(h),
        403
      );
      expectCleanError(
        await client
          .get("/api/sales-orders/credit-block-check")
          .query({ customerId: customer.id })
          .set(h),
        403
      );
      expectCleanError(await client.get("/api/sales-orders/1").set(h), 403);
      expectCleanError(await client.get("/api/sales-orders/1/status").set(h), 403);
      expectCleanError(await client.post("/api/sales-orders").set(h).send(payload()), 403);
      expectCleanError(await client.patch("/api/sales-orders/1/mark-in-quotation").set(h), 403);
      expect((await client.get("/api/sales-orders")).status).toBe(401);
    });
  });

  describe("tenancy", () => {
    let foreignOrder: { id: number; orderNo: string };
    let foreignCustomer: { id: string };
    let foreignEmployee: { id: bigint };
    let foreignProduct: { id: bigint };

    beforeAll(async () => {
      const prisma = await getPrisma();
      await runAsTenant(FOREIGN.companyId, async () => {
        foreignCustomer = await prisma.customer.findFirstOrThrow();
        foreignEmployee = await prisma.employee.findFirstOrThrow();
        foreignProduct = await prisma.product.findFirstOrThrow();
        const owner = await prisma.user.findFirstOrThrow();
        foreignOrder = await prisma.salesOrder.create({
          data: {
            orderNo: `SO-FOREIGN-${sfx}`,
            orderDate: new Date(),
            customerId: foreignCustomer.id,
            createdBy: owner.userId,
            status: "DRAFT",
          },
        });
      });
    });

    it("hides a foreign order from list, get, status and workflow, and cannot update or delete it", async () => {
      const client = await api();
      const list = await client
        .get("/api/sales-orders")
        .query({ search: foreignOrder.orderNo })
        .set(OWNER.auth);
      expect(list.status).toBe(200);
      expect(list.body.data.data).toEqual([]);
      expect(JSON.stringify(list.body)).not.toContain(FOREIGN.companyId);

      const id = foreignOrder.id;
      expectCleanError(await client.get(`/api/sales-orders/${id}`).set(OWNER.auth), 404);
      expectCleanError(await client.get(`/api/sales-orders/${id}/status`).set(OWNER.auth), 404);
      expectCleanError(
        await client.put(`/api/sales-orders/${id}`).set(OWNER.auth).send({ narration: "Hijacked" }),
        404
      );
      expectCleanError(await client.delete(`/api/sales-orders/${id}`).set(OWNER.auth), 404);
      expectCleanError(await client.patch(`/api/sales-orders/${id}/confirm`).set(OWNER.auth), 404);
      expectCleanError(
        await client.patch(`/api/sales-orders/${id}/convert-to-order`).set(OWNER.auth),
        404
      );
      expectCleanError(
        await client.patch(`/api/sales-orders/${id}/mark-in-quotation`).set(OWNER.auth),
        404
      );

      const prisma = await getPrisma();
      const after = await runAsTenant(FOREIGN.companyId, () =>
        prisma.salesOrder.findUniqueOrThrow({ where: { id } })
      );
      expect(after.status).toBe("DRAFT");
      expect(after.narration).toBeNull();
    });

    it("returns nothing for a foreign customer's credit check and source orders", async () => {
      const client = await api();
      const credit = await client
        .get("/api/sales-orders/credit-block-check")
        .query({ customerId: foreignCustomer.id })
        .set(OWNER.auth);
      expect(credit.body.data.blocked).toBe(false);
      const sources = await client
        .get("/api/sales-orders/source-orders")
        .query({ customerId: foreignCustomer.id })
        .set(OWNER.auth);
      expect(sources.body.data).toEqual([]);
      const filtered = await client
        .get("/api/sales-orders")
        .query({ customerId: foreignCustomer.id })
        .set(OWNER.auth);
      expect(filtered.body.data.total).toBe(0);
    });

    it("refuses an order for a foreign customer or with a foreign product", async () => {
      expectCleanError(
        await create({ customerId: foreignCustomer.id }),
        404,
        /Customer .* not found/
      );
      expectCleanError(
        await create({ items: [{ productId: foreignProduct.id.toString(), quantity: 1 }] }),
        404,
        /Product\(s\) not found or inactive/
      );
    });

    it("refuses to link a foreign employee or customer as the source or referrer", async () => {
      const emp = await create({ sourceEmployeeId: Number(foreignEmployee.id) });
      expectCleanError(emp, 400, /employee/i);
      const ref = await create({ referredByCustomerId: foreignCustomer.id });
      expectCleanError(ref, 400, /customer/i);

      const own = await create();
      const client = await api();
      expectCleanError(
        await client
          .put(`/api/sales-orders/${own.body.data.id}`)
          .set(OWNER.auth)
          .send({ sourceEmployeeId: Number(foreignEmployee.id) }),
        400,
        /employee/i
      );
      expectCleanError(
        await client
          .put(`/api/sales-orders/${own.body.data.id}`)
          .set(OWNER.auth)
          .send({ referredByCustomerId: foreignCustomer.id }),
        400,
        /customer/i
      );
    });

    it("links an own employee as the source and blocks that employee's deletion", async () => {
      const emp = await createEmployee();
      const res = await create({ orderSource: "SALES_PERSON", sourceEmployeeId: Number(emp.id) });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      expect(res.body.data.sourceEmployee.empCode).toBe(emp.empCode);
      const del = await (await api()).delete(`/api/employees/${emp.id}`).set(OWNER.auth);
      expectCleanError(del, 400, /Source Employee on Sales Orders/);
    });

    it("stamps the creator from the token, ignoring a createdBy in the body", async () => {
      const prisma = await getPrisma();
      const foreignUser = await runAsTenant(FOREIGN.companyId, () =>
        prisma.user.findFirstOrThrow()
      );
      const res = await create({ createdBy: foreignUser.userId });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      expect(res.body.data.createdBy).not.toBe(foreignUser.userId);
      expect(res.body.data.createdByUser?.fullName ?? "").not.toBe(foreignUser.fullName);
      const owner = await asDemoTenant(() =>
        prisma.user.findFirstOrThrow({ where: { username: "demo.owner" } })
      );
      expect(res.body.data.createdBy).toBe(owner.userId);
    });

    it("allows the same order number in two tenants", async () => {
      const res = await create({ orderNo: foreignOrder.orderNo });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    });
  });
});
