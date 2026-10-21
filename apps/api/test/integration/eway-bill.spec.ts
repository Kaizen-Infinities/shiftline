import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct } from "../factories";
import { ewayBillService } from "../../src/modules/eway-bill/eway-bill.service";
import { validityDays, validUptoFor } from "../../src/modules/eway-bill/eway-bill.types";

/**
 * E-way bills (P1-12): transporter master, generation from an invoice (through the IRN when
 * there is one) and from a dispatch challan, Part B, the extension window, cancellation within
 * 24 hours, trip sheets, and the expiry sweep with its warning.
 */
const BUYER = "27AAPFU0939F1ZV";
const sfx = Date.now().toString(36);

const enableEInvoicing = async () => {
  const owner = await authed("demo.owner");
  const res = await (
    await api()
  )
    .put("/api/e-invoice/settings")
    .set(owner.auth)
    .send({ provider: "FIXTURE", enabled: true, applicableFrom: "2026-04-01" });
  expect(res.status).toBe(200);
};

const b2bInvoice = async () => {
  const owner = await authed("demo.owner");
  const customer = await createCustomer({
    gstin: BUYER,
    gstRegType: "REGULAR",
    stateCode: "27",
    addresses: {
      create: [
        {
          label: "Billing",
          is_default: true,
          state_code: "27",
          address: {
            addressLine1: "12 Industrial Estate",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
          },
        },
      ],
    },
  });
  const product = await createProduct({ gstRate: 18, rate: 500 });
  const res = await (
    await api()
  )
    .post("/api/sales-invoices")
    .set(owner.auth)
    .send({
      invoiceDate: "2026-09-07",
      customerId: customer.id,
      items: [
        { productId: product.id.toString(), qty: 4, rate: 500, taxPercent: 18, hsnCode: "3923" },
      ],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; invoiceNo: string };
};

describe("e-way bills", () => {
  it("keeps a transporter master with GSTIN or TRANSIN ids and retires instead of deleting", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    expect((await client.get("/api/transporters").set(supervisor.auth)).status).toBe(403);
    const bad = await client
      .post("/api/transporters")
      .set(owner.auth)
      .send({ code: `TR${sfx}`, name: "Fast Freight", transporterId: "NOTANID" });
    expect(bad.status).toBe(400);
    // GSTIN-shaped ids need a valid checksum and a real state code (CMP-B03)
    for (const transporterId of ["27AAPFU0939F1ZX", "99AAPFU0939F1Z5"]) {
      const res = await client
        .post("/api/transporters")
        .set(owner.auth)
        .send({ code: `TX${sfx}`, name: "Bad Id", transporterId });
      expect(res.status, transporterId).toBe(400);
    }
    const created = await client
      .post("/api/transporters")
      .set(owner.auth)
      .send({
        code: `TR${sfx}`,
        name: "Fast Freight",
        transporterId: "27AAPFU0939F1ZV",
        phone: "9000000001",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.data.id as string;
    expect(
      (
        await client
          .post("/api/transporters")
          .set(owner.auth)
          .send({ code: `TR${sfx}`, name: "Dup" })
      ).status
    ).toBe(409);
    const updated = await client
      .put(`/api/transporters/${id}`)
      .set(owner.auth)
      .send({ name: "Fast Freight Ltd" });
    expect(updated.body.data.name).toBe("Fast Freight Ltd");
    const retired = await client.delete(`/api/transporters/${id}`).set(owner.auth);
    expect(retired.body.data.isActive).toBe(false);
    const list = await client.get("/api/transporters").set(owner.auth);
    expect(list.body.data.some((t: { id: string }) => t.id === id)).toBe(false);
    const all = await client
      .get("/api/transporters")
      .query({ includeInactive: "true" })
      .set(owner.auth);
    expect(all.body.data.some((t: { id: string }) => t.id === id)).toBe(true);
  });

  it("raises a bill from an invoice through its IRN, updates Part B, refuses a second live bill, cancels within 24 hours", async () => {
    await enableEInvoicing();
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const invoice = await b2bInvoice();
    const irn = await client
      .post("/api/e-invoice/generate")
      .set(owner.auth)
      .send({ docType: "INV", docId: invoice.id });
    expect(irn.status).toBe(200);

    expect(
      (
        await client
          .post("/api/eway-bills/generate")
          .set(supervisor.auth)
          .send({ docType: "INV", docRef: invoice.id })
      ).status
    ).toBe(403);
    // Road transport without vehicle or transporter is refused before any call.
    const noVehicle = await client
      .post("/api/eway-bills/generate")
      .set(owner.auth)
      .send({ docType: "INV", docRef: invoice.id, distanceKm: 850 });
    expect(noVehicle.status).toBe(400);

    const gen = await client.post("/api/eway-bills/generate").set(owner.auth).send({
      docType: "INV",
      docRef: invoice.id,
      distanceKm: 850,
      vehicleNo: "tn01ab1234",
      transporterName: "Fast Freight",
    });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    const bill = gen.body.data;
    expect(bill).toMatchObject({
      status: "ACTIVE",
      docType: "INV",
      docNo: invoice.invoiceNo,
      irn: irn.body.data.irn,
      vehicleNo: "TN01AB1234",
    });
    expect(bill.ewbNo).toMatch(/^\d{12}$/);
    expect(bill.request.byIrn.Irn).toBe(irn.body.data.irn);
    expect(bill.request.full.toGstin).toBe(BUYER);
    expect(bill.request.full.itemList[0]).toMatchObject({
      hsnCode: "3923",
      igstRate: 18,
      quantity: 4,
    });
    // 850 km in a regular vehicle: five days.
    expect(validityDays(850, "R")).toBe(5);
    const validUpto = new Date(bill.validUpto);
    expect(validUpto.getTime() - Date.now()).toBeGreaterThan(4 * 24 * 3600 * 1000);

    const again = await client
      .post("/api/eway-bills/generate")
      .set(owner.auth)
      .send({ docType: "INV", docRef: invoice.id, distanceKm: 850, vehicleNo: "TN01AB1234" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("EWB_ACTIVE");

    const partB = await client.post(`/api/eway-bills/${bill.id}/part-b`).set(owner.auth).send({
      vehicleNo: "KA05CD9876",
      fromPlace: "Hosur",
      fromState: 33,
      reasonCode: "2",
      reasonRem: "Transhipment at Hosur",
    });
    expect(partB.status, JSON.stringify(partB.body)).toBe(200);
    expect(partB.body.data.vehicleNo).toBe("KA05CD9876");
    expect(partB.body.data.updates.at(-1)).toMatchObject({
      kind: "PART_B",
      vehicleNo: "KA05CD9876",
    });

    // Extension is only possible near expiry.
    const early = await client.post(`/api/eway-bills/${bill.id}/extend`).set(owner.auth).send({
      fromPlace: "Hosur",
      fromState: 33,
      fromPincode: 635109,
      remainingDistance: 300,
      extnRsnCode: "5",
      extnRemarks: "Breakdown",
    });
    expect(early.status, JSON.stringify(early.body)).toBe(409);
    expect(early.body.code).toBe("EWB_EXTEND_WINDOW");

    const byDoc = await client.get(`/api/eway-bills/document/INV/${invoice.id}`).set(owner.auth);
    expect(byDoc.body.data[0].id).toBe(bill.id);

    expect(
      (await client.post(`/api/eway-bills/${bill.id}/cancel`).set(owner.auth).send({ reason: "3" }))
        .status
    ).toBe(400);
    const cancelled = await client
      .post(`/api/eway-bills/${bill.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "3", remarks: "Wrong vehicle keyed" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
    expect(
      (
        await client.post(`/api/eway-bills/${bill.id}/part-b`).set(owner.auth).send({
          vehicleNo: "KA05CD9876",
          fromPlace: "Hosur",
          fromState: 33,
          reasonCode: "3",
          reasonRem: "after cancel",
        })
      ).status
    ).toBe(409);

    // A fresh bill can be raised for the same document once the old one is cancelled.
    const redo = await client
      .post("/api/eway-bills/generate")
      .set(owner.auth)
      .send({ docType: "INV", docRef: invoice.id, distanceKm: 850, vehicleNo: "TN01AB1234" });
    expect(redo.status).toBe(201);

    const prisma = await getPrisma();
    const audit = await asDemoTenant(() =>
      prisma.auditLog.count({ where: { entityName: "eway_bills", entityId: bill.id } })
    );
    expect(audit).toBeGreaterThanOrEqual(3);
  });

  it("raises a standalone bill for a dispatch challan, consolidates bills into a trip sheet, and refuses cancelling a consolidated one", async () => {
    await enableEInvoicing();
    const owner = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();
    const product = await createProduct({ gstRate: 12, rate: 250 });
    const dispatch = await asDemoTenant(async () => {
      const po = await prisma.productionOrder.create({
        data: {
          productionOrderId: `PO-EWB-${sfx}`,
          orderDate: new Date(),
          productItemId: product.id,
          targetQty: 100,
          uom: "NOS",
          dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000),
          status: "IN_PRODUCTION",
        },
      });
      return prisma.goodsDispatch.create({
        data: {
          dispatchNumber: `GD-EWB-${sfx}`,
          dispatchDate: new Date(),
          vehicleNumber: "TN22EF4321",
          driverName: "Driver",
          status: "GATE_APPROVED",
          items: {
            create: [
              {
                productionOrderId: po.productionOrderId,
                productItemId: product.id,
                dispatchQty: 40,
                uom: "NOS",
              },
            ],
          },
        },
      });
    });
    const gen = await client
      .post("/api/eway-bills/generate")
      .set(owner.auth)
      .send({
        docType: "CHL",
        docRef: String(dispatch.id),
        distanceKm: 40,
        vehicleNo: "TN22EF4321",
      });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    const chl = gen.body.data;
    expect(chl).toMatchObject({
      docType: "CHL",
      docNo: `GD-EWB-${sfx}`,
      status: "ACTIVE",
      irn: null,
    });
    expect(chl.request).toMatchObject({
      docType: "CHL",
      subSupplyType: "5",
      totalValue: 10000,
      cgstValue: 600,
      sgstValue: 600,
      totInvValue: 11200,
    });
    expect(chl.request.itemList[0]).toMatchObject({
      quantity: 40,
      taxableAmount: 10000,
      cgstRate: 6,
    });

    const invoice = await b2bInvoice();
    const inv = await client
      .post("/api/eway-bills/generate")
      .set(owner.auth)
      .send({ docType: "INV", docRef: invoice.id, distanceKm: 850, vehicleNo: "TN22EF4321" });
    expect(inv.status).toBe(201);
    expect(inv.body.data.irn).toBeNull();
    expect(inv.body.data.request.docType).toBe("INV");

    const sheet = await client
      .post("/api/eway-bills/consolidated")
      .set(owner.auth)
      .send({
        fromPlace: "Chennai",
        fromState: 33,
        vehicleNo: "TN22EF4321",
        ewbIds: [chl.id, inv.body.data.id],
      });
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(201);
    expect(sheet.body.data.cewbNo).toMatch(/^\d{12}$/);
    expect(sheet.body.data.ewbNos).toEqual([chl.ewbNo, inv.body.data.ewbNo]);
    const after = await client.get(`/api/eway-bills/${chl.id}`).set(owner.auth);
    expect(after.body.data.consolidatedNo).toBe(sheet.body.data.cewbNo);
    const blocked = await client
      .post(`/api/eway-bills/${chl.id}/cancel`)
      .set(owner.auth)
      .send({ reason: "4", remarks: "Trip dropped" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("EWB_CONSOLIDATED");
    const sheets = await client.get("/api/eway-bills/consolidated").set(owner.auth);
    expect(sheets.body.data.some((s: { id: string }) => s.id === sheet.body.data.id)).toBe(true);
  });

  it("expires lapsed bills and warns once on those lapsing within 12 hours; extension works inside the window", async () => {
    await enableEInvoicing();
    const owner = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();
    const invoice = await b2bInvoice();
    const gen = await client
      .post("/api/eway-bills/generate")
      .set(owner.auth)
      .send({ docType: "INV", docRef: invoice.id, distanceKm: 100, vehicleNo: "TN09GH1111" });
    expect(gen.status).toBe(201);
    const id = gen.body.data.id as string;
    // About to lapse: warned once, then extended within the window.
    await asDemoTenant(() =>
      prisma.ewayBill.update({
        where: { id },
        data: { validUpto: new Date(Date.now() + 2 * 3600 * 1000) },
      })
    );
    const first = await asDemoTenant(() => ewayBillService.sweepExpiry());
    expect(first.warned).toBeGreaterThanOrEqual(1);
    const second = await asDemoTenant(() => ewayBillService.sweepExpiry());
    expect(second.warned).toBe(0);
    const extended = await client.post(`/api/eway-bills/${id}/extend`).set(owner.auth).send({
      fromPlace: "Hosur",
      fromState: 33,
      fromPincode: 635109,
      remainingDistance: 300,
      extnRsnCode: "5",
      extnRemarks: "Breakdown near Hosur",
    });
    expect(extended.status, JSON.stringify(extended.body)).toBe(200);
    expect(extended.body.data.extensions).toBe(1);
    expect(new Date(extended.body.data.validUpto).getTime()).toBeGreaterThan(
      Date.now() + 20 * 3600 * 1000
    );
    // Lapsed: expired by the sweep.
    await asDemoTenant(() =>
      prisma.ewayBill.update({
        where: { id },
        data: { validUpto: new Date(Date.now() - 3600 * 1000) },
      })
    );
    const sweep = await asDemoTenant(() => ewayBillService.sweepExpiry());
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    expect((await client.get(`/api/eway-bills/${id}`).set(owner.auth)).body.data.status).toBe(
      "EXPIRED"
    );
    const expiring = await client
      .get("/api/eway-bills")
      .query({ expiringWithinHours: 12 })
      .set(owner.auth);
    expect(expiring.status).toBe(200);
  });

  it("computes validity per NIC rules", () => {
    expect(validityDays(1, "R")).toBe(1);
    expect(validityDays(200, "R")).toBe(1);
    expect(validityDays(201, "R")).toBe(2);
    expect(validityDays(50, "O")).toBe(3);
    const from = new Date("2026-09-07T10:00:00+05:30");
    expect(validUptoFor(from, 450, "R").toISOString()).toBe(
      new Date("2026-09-10T23:59:59+05:30").toISOString()
    );
  });
});
