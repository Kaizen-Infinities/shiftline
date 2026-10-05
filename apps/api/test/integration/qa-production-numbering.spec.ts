import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createEmployee,
  createProduct,
  createRawMaterial,
  createSupplier,
} from "../factories";

/**
 * QA findings F3 (employees-by-role), F4 (a form's preview is the number the save assigns,
 * every type from documentNumberService) and the Monday-Sunday week on the assignment API (F10).
 */
const today = new Date().toISOString().slice(0, 10);
const sfx = Date.now().toString(36).slice(-5);

let OWNER: { auth: Record<string, string> };
const get = async (path: string) => (await api()).get(path).set(OWNER.auth);

beforeAll(async () => {
  OWNER = await authed("demo.owner");
});

describe("F3 employees by role", () => {
  it("lists active employees for a provisioned role, including ones not tagged with any role", async () => {
    const prisma = await getPrisma();
    const roles = (await get("/api/machine-operation-assignments/roles")).body.data as {
      id: number;
      code: string;
    }[];
    const production = roles.find((r) => r.code === "PRODUCTION")!;
    const sales = roles.find((r) => r.code === "SALES_EXEC")!;
    expect(production).toBeTruthy();

    const tagged = await createEmployee({ roleId: production.id });
    const untagged = await createEmployee({});
    const otherRole = await createEmployee({ roleId: sales.id });
    const inactive = await createEmployee({ roleId: production.id, status: "inactive" });

    const res = await get(
      `/api/machine-operation-assignments/employees-by-role?roleId=${production.id}`
    );
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(tagged.id.toString());
    expect(ids).toContain(untagged.id.toString());
    expect(ids).not.toContain(otherRole.id.toString());
    expect(ids).not.toContain(inactive.id.toString());

    // The seeded demo operators are tagged with the Production role.
    const seeded = await asDemoTenant(() =>
      prisma.employee.findFirstOrThrow({ where: { empCode: "E001" } })
    );
    expect(seeded.roleId).toBe(production.id);
    expect(ids).toContain(seeded.id.toString());
  });
});

describe("F4 preview equals the assigned number", () => {
  it("sales invoice", async () => {
    const product = await createProduct();
    const customer = await createCustomer({});
    const peek = (await get("/api/documents/next-number?docType=SALES_INVOICE")).body.data.number;
    const res = await (
      await api()
    )
      .post("/api/sales-invoices")
      .set(OWNER.auth)
      .send({
        invoiceDate: today,
        customerId: customer.id,
        items: [{ productId: product.id.toString(), qty: 1, rate: 100 }],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.invoiceNo).toBe(peek);
    // And the next preview has moved on by one.
    const after = (await get("/api/documents/next-number?docType=SALES_INVOICE")).body.data.number;
    expect(after).not.toBe(peek);
  });

  it("peeking neither consumes nor creates the series", async () => {
    const a = (await get("/api/documents/next-number?docType=DELIVERY_CHALLAN")).body.data.number;
    const b = (await get("/api/documents/next-number?docType=DELIVERY_CHALLAN")).body.data.number;
    expect(a).toBe(b);
  });

  it("GRN", async () => {
    const supplier = await createSupplier({ gstin: "33AAAAA0000A1Z1", gstRegType: "REGULAR" });
    const rm = await createRawMaterial({ baseUom: "KG", onHandQty: 0 });
    const peek = (await get(`/api/grn-invoices/next-code?date=${today}`)).body.data;
    const res = await (
      await api()
    )
      .post("/api/grn-invoices")
      .set(OWNER.auth)
      .send({
        invoiceNo: `QA-${sfx}`,
        grnDate: today,
        supplierId: supplier.id,
        storeId: "ST-RM",
        billingAddressLine1: "Plot 1",
        billingCity: "Chennai",
        billingState: "Tamil Nadu",
        billingPincode: "600001",
        shippingAddressLine1: "Plot 1",
        shippingCity: "Chennai",
        shippingState: "Tamil Nadu",
        shippingPincode: "600001",
        items: [
          {
            productId: rm.rawMaterialId,
            description: rm.materialName,
            uom: "KG",
            quantity: 1,
            unitPrice: 10,
            tax: 18,
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.grnNumber).toBe(peek);
  });

  it("production order: distinct MO series, preview consumed by the save, legacy codes untouched", async () => {
    const peek = (await get("/api/production-orders/next-id")).body.data.nextId as string;
    expect(peek).toMatch(/^MO\/\d{4}-\d{2}\/\d{4}$/);
    expect(peek.startsWith("PO")).toBe(false);

    const product = await createProduct();
    const rm = await createRawMaterial();
    const create = async (productionOrderId: string) =>
      (await api())
        .post("/api/production-orders")
        .set(OWNER.auth)
        .send({
          productionOrderId,
          orderDate: "2026-09-01T00:00:00.000Z",
          dueDate: "2026-12-01T00:00:00.000Z",
          targetQty: 10,
          uom: "PCS",
          productItemId: product.id.toString(),
          rawMaterials: [
            { rawMaterialId: rm.rawMaterialId, requiredQty: 1, uom: "KG", storeId: "ST-RM" },
          ],
        });

    // A legacy code does not touch the series.
    const legacy = await create(`PO-2609-${sfx}`);
    expect(legacy.status, JSON.stringify(legacy.body).slice(0, 300)).toBe(201);
    expect((await get("/api/production-orders/next-id")).body.data.nextId).toBe(peek);

    const saved = await create(`${peek}-1`);
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(201);
    expect(saved.body.data.productionOrderId).toBe(`${peek}-1`);
    const next = (await get("/api/production-orders/next-id")).body.data.nextId;
    expect(next).not.toBe(peek);
    // A second line of the same order does not skip a number.
    const second = await create(`${peek}-2`);
    expect(second.status).toBe(201);
    expect((await get("/api/production-orders/next-id")).body.data.nextId).toBe(next);
  });

  it.each([
    ["RECEIPT", "RCT"],
    ["PAYMENT", "PMT"],
    ["CONTRA", "CTR"],
  ])("%s voucher", async (type, prefix) => {
    const prisma = await getPrisma();
    const cash = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { code: "CASH-001" } })
    );
    const bank = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { code: "BANK-001" } })
    );
    const peek = (await get(`/api/vouchers/next-no?type=${type}`)).body.data.voucherNo as string;
    expect(peek).toMatch(new RegExp(`^${prefix}/\\d{4}-\\d{2}/\\d{4}$`));
    const res = await (
      await api()
    )
      .post("/api/vouchers")
      .set(OWNER.auth)
      .send({
        type,
        date: today,
        items: [
          { debitLedgerId: cash.id, debitAmount: 50, creditAmount: 0 },
          { creditLedgerId: bank.id, debitAmount: 0, creditAmount: 50 },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.voucherNo).toBe(peek);
  });
});

describe("F10 assignment weeks are Monday to Sunday", () => {
  it("snaps a Sunday-start range to Monday..Sunday", async () => {
    const prisma = await getPrisma();
    const machine = await asDemoTenant(() =>
      prisma.machine.create({ data: { machineId: `QAW${sfx}`, machineName: "Week test" } })
    );
    const shift = await asDemoTenant(() =>
      prisma.shift.findFirstOrThrow({ where: { isActive: true } })
    );
    const emp = await createEmployee({});
    const res = await (
      await api()
    )
      .post("/api/machine-operation-assignments")
      .set(OWNER.auth)
      .send({
        machineId: machine.machineId,
        shiftId: shift.shiftCode,
        weekStartDate: "2026-10-04", // a Sunday
        weekEndDate: "2026-10-10", // a Saturday
        operators: [
          {
            roleId: (await asDemoTenant(() => prisma.role.findFirstOrThrow())).id,
            employeeId: emp.id.toString(),
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(String(res.body.data.weekStartDate).slice(0, 10)).toBe("2026-09-28");
    expect(String(res.body.data.weekEndDate).slice(0, 10)).toBe("2026-10-11");
  });
});
