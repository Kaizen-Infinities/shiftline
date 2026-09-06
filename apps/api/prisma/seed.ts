/**
 * Anonymised development seed: one demo tenant with masters, roles and users.
 * Idempotent (upserts by code). No real customers, GSTINs or phone numbers.
 *
 *   npm run -w @shiftline/api db:seed
 *
 * Passwords come from SEED_PASSWORD (default below, development only).
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { PERMISSION_REGISTRY } from "@shiftline/shared";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/hashPassword";
import { bootstrapAdmin } from "../src/utils/bootstrapAdmin";
import { accountsService } from "../src/modules/accounts/accounts.service";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Demo@12345678";
const D = (n: number | string) => new Prisma.Decimal(n);

const log = (msg: string) => process.stdout.write(`[seed] ${msg}\n`);

/** Permission keys for a role, from module names in the registry. */
const keysFor = (modules: string[], actions?: string[]) =>
  PERMISSION_REGISTRY.filter((m) => modules.includes(m.module)).flatMap((m) =>
    m.actions.filter((a) => !actions || actions.includes(a)).map((a) => `${m.module}.${a}`)
  );

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data in production");
  }

  // Platform admin, permissions and the super-admin role come from the same
  // bootstrap the server runs on start.
  await bootstrapAdmin(prisma);
  await accountsService.ensureSystemLedgersExist();

  // ── Company ────────────────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { companyCode: "DEMO" },
    update: {},
    create: {
      companyCode: "DEMO",
      companyName: "Shiftline Demo Industries",
      legalName: "Shiftline Demo Industries Private Limited",
      shortName: "Demo",
      gstin: "33AAAAA0000A1Z5", // syntactically valid, not a real registration
      phone: "0000000000",
      email: "hello@demo.shiftline.local",
      addressLine1: "Plot 1, Demo Industrial Estate",
      city: "Chennai",
      state: "Tamil Nadu",
      zipcode: "600001",
      country: "India",
      isOnboarded: true,
    },
  });
  log(`company ${company.companyName}`);

  const existingPlaces = await prisma.businessPlace.findMany({ where: { companyId: company.id } });
  if (existingPlaces.length === 0) {
    await prisma.businessPlace.createMany({
      data: [
        {
          companyId: company.id,
          code: "HO",
          name: "Head Office",
          type: "HEAD_OFFICE",
          gstPlaceCode: "33",
          isHeadOffice: true,
        },
        {
          companyId: company.id,
          code: "F1",
          name: "Factory 1",
          type: "FACTORY",
          gstPlaceCode: "33",
        },
      ],
    });
  }
  const factory = await prisma.businessPlace.findFirstOrThrow({
    where: { companyId: company.id, code: "F1" },
  });

  // ── Roles and users ────────────────────────────────────────────────────────
  const roleDefs: { code: string; name: string; description: string; keys: string[] }[] = [
    {
      code: "OWNER",
      name: "Owner",
      description: "Everything except platform administration",
      keys: PERMISSION_REGISTRY.flatMap((m) => m.actions.map((a) => `${m.module}.${a}`)),
    },
    {
      code: "ACCOUNTS",
      name: "Accounts",
      description: "Books, invoices, payments, reports",
      keys: keysFor([
        "accounts",
        "payable",
        "receivable",
        "vouchers",
        "petty-cash",
        "chart-of-accounts",
        "sales-invoices",
        "purchase-orders",
        "sales-returns",
        "purchase-returns",
        "customers",
        "suppliers",
        "reports",
        "dash-overview",
        "invoice-settings",
        "gst_tax",
        "expenses",
      ]),
    },
    {
      code: "STORES",
      name: "Stores",
      description: "Inventory and dispatch",
      keys: keysFor([
        "raw_materials",
        "raw_material_categories",
        "wastage-store",
        "stores",
        "stock-adjustments",
        "goods-dispatch",
        "eod-stock",
        "inventory",
        "dash-inventory",
        "products",
        "categories",
        "uoms",
      ]),
    },
    {
      code: "PRODUCTION",
      name: "Production",
      description: "Planning and shop floor",
      keys: keysFor([
        "production-orders",
        "weekly-programs",
        "daily-plans",
        "hourly-production",
        "production-wastage",
        "machines",
        "machine-assignments",
        "shifts",
        "dash-machines",
        "oee",
        "products",
        "raw_materials",
      ]),
    },
    {
      code: "SALES_EXEC",
      name: "Sales Executive",
      description: "Field sales via the mobile app",
      keys: keysFor(
        ["customers", "sales-orders", "quotations", "dash-overview"],
        ["view", "create"]
      ),
    },
  ];
  const allPerms = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permByKey = new Map(allPerms.map((p) => [p.key, p.id]));
  const roles: Record<string, number> = {};
  for (const r of roleDefs) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description },
      create: { code: r.code, name: r.name, description: r.description, isSystem: false },
    });
    roles[r.code] = role.id;
    const ids = r.keys
      .map((k) => permByKey.get(k))
      .filter((x): x is number => typeof x === "number");
    if (ids.length) {
      await prisma.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
  log(`roles ${Object.keys(roles).join(", ")}`);

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const userDefs = [
    {
      username: "demo.owner",
      fullName: "Demo Owner",
      email: "owner@demo.shiftline.local",
      role: "OWNER",
    },
    {
      username: "demo.accounts",
      fullName: "Demo Accountant",
      email: "accounts@demo.shiftline.local",
      role: "ACCOUNTS",
    },
    {
      username: "demo.stores",
      fullName: "Demo Storekeeper",
      email: "stores@demo.shiftline.local",
      role: "STORES",
    },
    {
      username: "demo.production",
      fullName: "Demo Supervisor",
      email: "production@demo.shiftline.local",
      role: "PRODUCTION",
    },
    {
      username: "demo.sales",
      fullName: "Demo Sales Executive",
      email: "sales@demo.shiftline.local",
      role: "SALES_EXEC",
    },
  ];
  const users: Record<string, string> = {};
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { fullName: u.fullName, roleId: roles[u.role] },
      create: {
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        passwordHash,
        roleId: roles[u.role],
      },
    });
    users[u.role] = user.userId;
  }
  log(`users ${userDefs.map((u) => u.username).join(", ")} (password: SEED_PASSWORD)`);
  const owner = users.OWNER;

  // ── Organisation masters ───────────────────────────────────────────────────
  for (const name of ["Production", "Stores", "Accounts", "Sales", "Quality"]) {
    const dept = await prisma.department.findFirst({ where: { name } });
    if (!dept) await prisma.department.create({ data: { name } });
  }
  for (const s of [
    {
      shiftCode: "A",
      shiftName: "Shift A",
      startTime: "06:00",
      endTime: "14:00",
      breakDuration: 30,
      gracePeriod: 10,
    },
    {
      shiftCode: "B",
      shiftName: "Shift B",
      startTime: "14:00",
      endTime: "22:00",
      breakDuration: 30,
      gracePeriod: 10,
    },
    {
      shiftCode: "C",
      shiftName: "Shift C",
      startTime: "22:00",
      endTime: "06:00",
      breakDuration: 30,
      gracePeriod: 10,
    },
  ]) {
    await prisma.shift.upsert({ where: { shiftCode: s.shiftCode }, update: {}, create: s });
  }
  for (const u of [
    { uomCode: "NOS", uomName: "Numbers" },
    { uomCode: "KG", uomName: "Kilogram" },
    { uomCode: "G", uomName: "Gram" },
    { uomCode: "MTR", uomName: "Metre" },
    { uomCode: "LTR", uomName: "Litre" },
  ]) {
    await prisma.unitOfMeasure.upsert({ where: { uomCode: u.uomCode }, update: {}, create: u });
  }
  const nos = await prisma.unitOfMeasure.findUniqueOrThrow({ where: { uomCode: "NOS" } });

  for (const c of [
    { code: "RM-POLY", name: "Polymers", type: "RAW_MATERIAL" as const },
    { code: "RM-MB", name: "Masterbatch", type: "RAW_MATERIAL" as const },
    { code: "FG-HOUSE", name: "Household", type: "PRODUCT" as const },
    { code: "FG-IND", name: "Industrial", type: "PRODUCT" as const },
    { code: "WS-SCRAP", name: "Scrap", type: "WASTAGE" as const },
  ]) {
    await prisma.category.upsert({ where: { code: c.code }, update: {}, create: c });
  }
  const catPoly = await prisma.category.findUniqueOrThrow({ where: { code: "RM-POLY" } });
  const catHouse = await prisma.category.findUniqueOrThrow({ where: { code: "FG-HOUSE" } });

  // ── Stores ─────────────────────────────────────────────────────────────────
  for (const s of [
    {
      storeId: "ST-RM",
      storeCode: "ST-RM",
      storeName: "Raw Material Store",
      storeCategory: "RAW_MATERIAL" as const,
    },
    {
      storeId: "ST-FG",
      storeCode: "ST-FG",
      storeName: "Finished Goods Store",
      storeCategory: "FINISHED_GOODS" as const,
    },
    {
      storeId: "ST-WS",
      storeCode: "ST-WS",
      storeName: "Wastage Store",
      storeCategory: "WASTAGE" as const,
    },
  ]) {
    await prisma.store.upsert({
      where: { storeId: s.storeId },
      update: {},
      create: { ...s, businessPlaceId: factory.id, createdBy: owner },
    });
  }

  // ── Raw materials ──────────────────────────────────────────────────────────
  const rms = [
    {
      rawMaterialId: "RM001",
      materialName: "Virgin PP Copolymer",
      baseUom: "KG",
      rate: 98,
      reorderLevel: 500,
    },
    {
      rawMaterialId: "RM002",
      materialName: "HDPE Blow Grade",
      baseUom: "KG",
      rate: 92,
      reorderLevel: 500,
    },
    {
      rawMaterialId: "RM003",
      materialName: "LDPE Film Grade",
      baseUom: "KG",
      rate: 105,
      reorderLevel: 300,
    },
    {
      rawMaterialId: "RM004",
      materialName: "Blue Masterbatch",
      baseUom: "KG",
      rate: 260,
      reorderLevel: 50,
    },
    {
      rawMaterialId: "RM005",
      materialName: "White Masterbatch",
      baseUom: "KG",
      rate: 240,
      reorderLevel: 50,
    },
  ];
  for (const r of rms) {
    await prisma.rawMaterial.upsert({
      where: { rawMaterialId: r.rawMaterialId },
      update: {},
      create: {
        ...r,
        rate: D(r.rate),
        reorderLevel: D(r.reorderLevel),
        onHandQty: D(1000),
        storeId: "ST-RM",
        categoryId: catPoly.id,
        createdBy: owner,
      },
    });
  }

  // ── Products with BOM ──────────────────────────────────────────────────────
  const products = [
    {
      productCode: "P001",
      productName: "Bucket 20L Blue",
      capacityLitres: 20,
      weightPerPiece: 620,
      rate: 145,
      bom: [
        ["RM001", 0.6],
        ["RM004", 0.02],
      ],
    },
    {
      productCode: "P002",
      productName: "Storage Box 30L",
      capacityLitres: 30,
      weightPerPiece: 900,
      rate: 260,
      bom: [
        ["RM001", 0.88],
        ["RM005", 0.02],
      ],
    },
    {
      productCode: "P003",
      productName: "Jerry Can 5L",
      capacityLitres: 5,
      weightPerPiece: 210,
      rate: 62,
      bom: [["RM002", 0.21]],
    },
    {
      productCode: "P004",
      productName: "Crate 600x400",
      capacityLitres: null,
      weightPerPiece: 1450,
      rate: 410,
      bom: [
        ["RM002", 1.4],
        ["RM004", 0.05],
      ],
    },
    {
      productCode: "P005",
      productName: "Carry Bag 12x16",
      capacityLitres: null,
      weightPerPiece: 8,
      rate: 1.2,
      bom: [["RM003", 0.008]],
    },
  ] as const;
  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { productCode: p.productCode },
      update: {},
      create: {
        productCode: p.productCode,
        productName: p.productName,
        uomId: nos.id,
        capacityLitres: p.capacityLitres === null ? null : D(p.capacityLitres),
        weightPerPiece: D(p.weightPerPiece),
        rate: D(p.rate),
        categoryId: catHouse.id,
        createdBy: owner,
      },
    });
    const bomCount = await prisma.billOfMaterial.count({ where: { productId: product.id } });
    if (bomCount === 0) {
      await prisma.billOfMaterial.createMany({
        data: p.bom.map(([rawMaterialId, qty]) => ({
          productId: product.id,
          rawMaterialId,
          requiredQuantity: D(qty),
          uom: "KG",
        })),
      });
    }
  }

  // ── Machines ───────────────────────────────────────────────────────────────
  for (const m of [
    {
      machineId: "M001",
      machineName: "IMM 250T #1",
      technologyType: "INJECTION_MOULDING" as const,
      manufacturer: "Demo Machines",
      cycleTime: 28,
    },
    {
      machineId: "M002",
      machineName: "IMM 350T #2",
      technologyType: "INJECTION_MOULDING" as const,
      manufacturer: "Demo Machines",
      cycleTime: 34,
    },
    {
      machineId: "M003",
      machineName: "Blow Moulder 5L",
      technologyType: "BLOW_MOULDING" as const,
      manufacturer: "Demo Machines",
      cycleTime: 12,
    },
    {
      machineId: "M004",
      machineName: "Film Extruder 1200",
      technologyType: "EXTRUSION" as const,
      manufacturer: "Demo Machines",
      cycleTime: null,
    },
  ]) {
    await prisma.machine.upsert({
      where: { machineId: m.machineId },
      update: {},
      create: {
        ...m,
        machineType: "PRODUCTION",
        cycleTime: m.cycleTime === null ? null : D(m.cycleTime),
        businessPlaceId: factory.id,
      },
    });
  }

  // ── Customers and suppliers (fictional) ────────────────────────────────────
  for (const name of ["Distributor", "Retailer", "Institutional"]) {
    await prisma.customerType.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const name of ["A", "B", "C"]) {
    await prisma.customerGrade.upsert({ where: { name }, update: {}, create: { name } });
  }
  const typeDist = await prisma.customerType.findUniqueOrThrow({ where: { name: "Distributor" } });
  const gradeA = await prisma.customerGrade.findUniqueOrThrow({ where: { name: "A" } });
  const customers = [
    {
      customerCode: "C001",
      firmName: "Aster Traders (Demo)",
      displayName: "Aster Traders",
      creditLimit: 200000,
      creditDays: 30,
    },
    {
      customerCode: "C002",
      firmName: "Bluebell Stores (Demo)",
      displayName: "Bluebell Stores",
      creditLimit: 100000,
      creditDays: 15,
    },
    {
      customerCode: "C003",
      firmName: "Cedar Enterprises (Demo)",
      displayName: "Cedar Enterprises",
      creditLimit: 350000,
      creditDays: 45,
    },
    {
      customerCode: "C004",
      firmName: "Dune Plastics Mart (Demo)",
      displayName: "Dune Plastics",
      creditLimit: 50000,
      creditDays: 7,
    },
    {
      customerCode: "C005",
      firmName: "Elm Institutional Supplies (Demo)",
      displayName: "Elm Supplies",
      creditLimit: 500000,
      creditDays: 60,
    },
  ];
  for (const c of customers) {
    await prisma.customer.upsert({
      where: { companyId_customerCode: { companyId: company.id, customerCode: c.customerCode } },
      update: {},
      create: {
        ...c,
        creditLimit: D(c.creditLimit),
        companyId: company.id,
        createdBy: owner,
        customerTypeId: typeDist.id,
        customerGradeId: gradeA.id,
        mobile: ["9000000001"],
      },
    });
  }
  const suppliers = [
    {
      supplierCode: "S001",
      legalName: "Polymer Source (Demo) Pvt Ltd",
      displayName: "Polymer Source",
      billingCity: "Chennai",
      billingState: "Tamil Nadu",
      stateCode: "33",
      gstRegType: "Regular",
    },
    {
      supplierCode: "S002",
      legalName: "Colour Masters (Demo) LLP",
      displayName: "Colour Masters",
      billingCity: "Coimbatore",
      billingState: "Tamil Nadu",
      stateCode: "33",
      gstRegType: "Regular",
    },
    {
      supplierCode: "S003",
      legalName: "Packwell Cartons (Demo)",
      displayName: "Packwell",
      billingCity: "Bengaluru",
      billingState: "Karnataka",
      stateCode: "29",
      gstRegType: "Composition",
    },
  ];
  for (const s of suppliers) {
    await prisma.supplier.upsert({
      where: { companyId_supplierCode: { companyId: company.id, supplierCode: s.supplierCode } },
      update: {},
      create: {
        ...s,
        billingAddressLine1: "Demo address",
        billingPincode: "600001",
        companyId: company.id,
        createdBy: owner,
        mobile: ["9000000002"],
      },
    });
  }

  // ── Financial year and invoice numbering ───────────────────────────────────
  const fyStart = new Date(Date.UTC(2026, 3, 1));
  const fyEnd = new Date(Date.UTC(2027, 2, 31));
  await prisma.invoiceSetting.upsert({
    where: { companyId: company.id },
    update: {},
    create: {
      companyId: company.id,
      invoicePrefix: "INV",
      financialYearStart: fyStart,
      financialYearEnd: fyEnd,
    },
  });
  const period = await prisma.accountingPeriod.findFirst({
    where: { companyId: company.id, periodName: "FY 2026-27" },
  });
  if (!period) {
    await prisma.accountingPeriod.create({
      data: { companyId: company.id, periodName: "FY 2026-27", startDate: fyStart, endDate: fyEnd },
    });
  }

  log("done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
