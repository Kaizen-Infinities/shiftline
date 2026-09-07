/**
 * Reusable tenant seed: masters, roles and users for one company. Used by the
 * development seed (demo tenant) and by the cross-tenant leak suite (a second
 * tenant with the same shape). Idempotent per company.
 */
import { Prisma, type Company } from "@prisma/client";
import { ROLE_DEFS, provisioningService } from "../src/modules/platform/provisioning.service";
export { ROLE_DEFS };
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/utils/hashPassword";
import { runAsTenant, withoutTenant } from "../src/lib/tenant-context";
import { byCode } from "../src/lib/prisma";

export interface SeedTenantOptions {
  companyCode: string;
  companyName: string;
  /** Prefix for usernames/emails (globally unique). */
  slug: string;
  /** Prefix for codes that are still global primary keys (stores, machines, raw materials, shifts). */
  globalPrefix: string;
  password: string;
  log?: (msg: string) => void;
}

const D = (n: number | string) => new Prisma.Decimal(n);

export async function seedTenant(opts: SeedTenantOptions): Promise<Company> {
  const log = opts.log ?? (() => {});
  const P = opts.globalPrefix ? `${opts.globalPrefix}-` : "";

  // Everything a real tenant gets on sign-up: chart of accounts, head office,
  // roles, units, financial year, sequences, settings (modules/platform/provisioning.service.ts).
  const provisioned = await provisioningService.provisionTenant({
    companyCode: opts.companyCode,
    companyName: opts.companyName,
    legalName: `${opts.companyName} Private Limited`,
    slug: opts.slug,
    gstin: "33AAAAA0000A1Z9", // syntactically valid, not a real registration
    phone: "0000000000",
    email: `hello@${opts.slug}.shiftline.local`,
    addressLine1: "Plot 1, Demo Industrial Estate",
    city: "Chennai",
    state: "Tamil Nadu",
    zipcode: "600001",
    country: "India",
    isOnboarded: true,
    planCode: "ENTERPRISE",
    subscriptionStatus: "ACTIVE",
  });
  const company = provisioned.company;
  const roles = provisioned.roles;
  log(`company ${company.companyName} provisioned`);

  await runAsTenant(company.id, async () => {
    // Demo data on top of the provisioned defaults.
    if (!(await prisma.businessPlace.findFirst({ where: { code: "F1" } }))) {
      await prisma.businessPlace.create({
        data: { code: "F1", name: "Factory 1", type: "FACTORY", gstPlaceCode: "33" },
      });
    }
    const factory = await prisma.businessPlace.findFirstOrThrow({ where: { code: "F1" } });

    // The provisioned Main Bank Account gets bank details, as the onboarding wizard would add.
    const mainBank = await prisma.accountLedger.findFirstOrThrow({ where: { code: "BANK-001" } });
    await prisma.bankAccount.upsert({
      where: { ledgerId: mainBank.id },
      update: {},
      create: {
        ledgerId: mainBank.id,
        bankName: "Demo Bank",
        accountName: `${opts.companyName} Private Limited`,
        accountNumber: "000000000001",
        ifsc: "DEMO0000001",
        branch: "Chennai Main",
        isDefault: true,
      },
    });

    // Users (username/email are global uniques, hence the slug)
    const passwordHash = await hashPassword(opts.password);
    const users: Record<string, string> = {};
    for (const u of [
      { key: "owner", fullName: "Owner", role: "OWNER" },
      { key: "accounts", fullName: "Accountant", role: "ACCOUNTS" },
      { key: "stores", fullName: "Storekeeper", role: "STORES" },
      { key: "production", fullName: "Supervisor", role: "PRODUCTION" },
      { key: "sales", fullName: "Sales Executive", role: "SALES_EXEC" },
      { key: "auditor", fullName: "Auditor", role: "AUDITOR" },
    ]) {
      const username = `${opts.slug}.${u.key}`;
      const user = await withoutTenant(() =>
        prisma.user.upsert({
          where: { username },
          update: { fullName: `${opts.companyCode} ${u.fullName}`, roleId: roles[u.role] },
          create: {
            username,
            fullName: `${opts.companyCode} ${u.fullName}`,
            email: `${u.key}@${opts.slug}.shiftline.local`,
            passwordHash,
            roleId: roles[u.role],
            companyId: company.id,
          },
        })
      );
      users[u.role] = user.userId;
    }
    const owner = users.OWNER;
    log(`roles and users seeded (${opts.slug}.*)`);

    for (const userId of Object.values(users)) {
      if (!(await prisma.notification.findFirst({ where: { userId, category: "welcome" } }))) {
        await prisma.notification.create({
          data: {
            userId,
            category: "welcome",
            level: "INFO",
            title: `Welcome to ${opts.companyName}`,
            body: "Notices about imports, retention sweeps, stock snapshots and your team show up here.",
            link: "/notifications",
          },
        });
      }
    }

    // Organisation masters
    for (const name of ["Production", "Stores", "Accounts", "Sales", "Quality"]) {
      if (!(await prisma.department.findFirst({ where: { name } })))
        await prisma.department.create({ data: { name } });
    }
    const deptProduction = await prisma.department.findFirstOrThrow({
      where: { name: "Production" },
    });
    for (const s of [
      {
        shiftCode: `${P}A`,
        shiftName: `${P}Shift A`,
        startTime: "06:00",
        endTime: "14:00",
        breakDuration: 30,
        gracePeriod: 10,
      },
      {
        shiftCode: `${P}B`,
        shiftName: `${P}Shift B`,
        startTime: "14:00",
        endTime: "22:00",
        breakDuration: 30,
        gracePeriod: 10,
      },
      {
        shiftCode: `${P}C`,
        shiftName: `${P}Shift C`,
        startTime: "22:00",
        endTime: "06:00",
        breakDuration: 30,
        gracePeriod: 10,
      },
    ]) {
      await prisma.shift.upsert({ where: byCode("shiftCode", s.shiftCode), update: {}, create: s });
    }
    const shiftA = await prisma.shift.findFirstOrThrow({ where: { shiftCode: `${P}A` } });
    for (const u of [
      { uomCode: "NOS", uomName: "Numbers" },
      { uomCode: "KG", uomName: "Kilogram" },
      { uomCode: "G", uomName: "Gram" },
      { uomCode: "MTR", uomName: "Metre" },
      { uomCode: "LTR", uomName: "Litre" },
    ]) {
      await prisma.unitOfMeasure.upsert({
        where: { companyId_uomCode: { companyId: company.id, uomCode: u.uomCode } },
        update: {},
        create: u,
      });
    }
    const nos = await prisma.unitOfMeasure.findFirstOrThrow({ where: { uomCode: "NOS" } });
    for (const c of [
      { code: "RM-POLY", name: "Polymers", type: "RAW_MATERIAL" as const },
      { code: "RM-MB", name: "Masterbatch", type: "RAW_MATERIAL" as const },
      { code: "FG-HOUSE", name: "Household", type: "PRODUCT" as const },
      { code: "FG-IND", name: "Industrial", type: "PRODUCT" as const },
      { code: "WS-SCRAP", name: "Scrap", type: "WASTAGE" as const },
    ]) {
      await prisma.category.upsert({
        where: { companyId_code: { companyId: company.id, code: c.code } },
        update: {},
        create: c,
      });
    }
    const catPoly = await prisma.category.findFirstOrThrow({ where: { code: "RM-POLY" } });
    const catHouse = await prisma.category.findFirstOrThrow({ where: { code: "FG-HOUSE" } });

    // Employees (two, so payroll and assignments have someone to point at)
    for (const e of [
      { empCode: "E001", fullName: `${opts.companyCode} Operator One` },
      { empCode: "E002", fullName: `${opts.companyCode} Operator Two` },
    ]) {
      if (!(await prisma.employee.findFirst({ where: { empCode: e.empCode } }))) {
        await prisma.employee.create({
          data: {
            ...e,
            departmentId: deptProduction.id,
            shiftId: shiftA.shiftCode,
            createdBy: owner,
          },
        });
      }
    }

    // Stores (global PK today: prefixed)
    for (const s of [
      {
        storeId: `${P}ST-RM`,
        storeCode: `${P}ST-RM`,
        storeName: "Raw Material Store",
        storeCategory: "RAW_MATERIAL" as const,
      },
      {
        storeId: `${P}ST-FG`,
        storeCode: `${P}ST-FG`,
        storeName: "Finished Goods Store",
        storeCategory: "FINISHED_GOODS" as const,
      },
      {
        storeId: `${P}ST-WS`,
        storeCode: `${P}ST-WS`,
        storeName: "Wastage Store",
        storeCategory: "WASTAGE" as const,
      },
    ]) {
      await prisma.store.upsert({
        where: byCode("storeId", s.storeId),
        update: {},
        create: { ...s, businessPlaceId: factory.id, createdBy: owner },
      });
    }

    // Raw materials (global PK today: prefixed)
    for (const r of [
      {
        rawMaterialId: `${P}RM001`,
        materialName: "Virgin PP Copolymer",
        rate: 98,
        reorderLevel: 500,
      },
      { rawMaterialId: `${P}RM002`, materialName: "HDPE Blow Grade", rate: 92, reorderLevel: 500 },
      { rawMaterialId: `${P}RM003`, materialName: "LDPE Film Grade", rate: 105, reorderLevel: 300 },
      { rawMaterialId: `${P}RM004`, materialName: "Blue Masterbatch", rate: 260, reorderLevel: 50 },
      {
        rawMaterialId: `${P}RM005`,
        materialName: "White Masterbatch",
        rate: 240,
        reorderLevel: 50,
      },
    ]) {
      await prisma.rawMaterial.upsert({
        where: byCode("rawMaterialId", r.rawMaterialId),
        update: {},
        create: {
          ...r,
          baseUom: "KG",
          rate: D(r.rate),
          reorderLevel: D(r.reorderLevel),
          onHandQty: D(1000),
          storeId: `${P}ST-RM`,
          categoryId: catPoly.id,
          createdBy: owner,
        },
      });
    }

    // Products with BOM
    const products = [
      {
        productCode: "P001",
        productName: "Bucket 20L Blue",
        capacityLitres: 20,
        weightPerPiece: 620,
        rate: 145,
        bom: [
          [`${P}RM001`, 0.6],
          [`${P}RM004`, 0.02],
        ],
      },
      {
        productCode: "P002",
        productName: "Storage Box 30L",
        capacityLitres: 30,
        weightPerPiece: 900,
        rate: 260,
        bom: [
          [`${P}RM001`, 0.88],
          [`${P}RM005`, 0.02],
        ],
      },
      {
        productCode: "P003",
        productName: "Jerry Can 5L",
        capacityLitres: 5,
        weightPerPiece: 210,
        rate: 62,
        bom: [[`${P}RM002`, 0.21]],
      },
      {
        productCode: "P004",
        productName: "Crate 600x400",
        capacityLitres: null,
        weightPerPiece: 1450,
        rate: 410,
        bom: [
          [`${P}RM002`, 1.4],
          [`${P}RM004`, 0.05],
        ],
      },
      {
        productCode: "P005",
        productName: "Carry Bag 12x16",
        capacityLitres: null,
        weightPerPiece: 8,
        rate: 1.2,
        bom: [[`${P}RM003`, 0.008]],
      },
    ] as const;
    for (const p of products) {
      const product = await prisma.product.upsert({
        where: { companyId_productCode: { companyId: company.id, productCode: p.productCode } },
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
      if ((await prisma.billOfMaterial.count({ where: { productId: product.id } })) === 0) {
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

    // Machines (global PK today: prefixed)
    for (const m of [
      {
        machineId: `${P}M001`,
        machineName: "IMM 250T #1",
        technologyType: "INJECTION_MOULDING" as const,
        cycleTime: 28,
      },
      {
        machineId: `${P}M002`,
        machineName: "IMM 350T #2",
        technologyType: "INJECTION_MOULDING" as const,
        cycleTime: 34,
      },
      {
        machineId: `${P}M003`,
        machineName: "Blow Moulder 5L",
        technologyType: "BLOW_MOULDING" as const,
        cycleTime: 12,
      },
      {
        machineId: `${P}M004`,
        machineName: "Film Extruder 1200",
        technologyType: "EXTRUSION" as const,
        cycleTime: null,
      },
    ]) {
      await prisma.machine.upsert({
        where: byCode("machineId", m.machineId),
        update: {},
        create: {
          ...m,
          manufacturer: "Demo Machines",
          machineType: "PRODUCTION",
          cycleTime: m.cycleTime === null ? null : D(m.cycleTime),
          businessPlaceId: factory.id,
        },
      });
    }

    // Customers and suppliers (fictional)
    for (const name of ["Distributor", "Retailer", "Institutional"]) {
      await prisma.customerType.upsert({
        where: { companyId_name: { companyId: company.id, name } },
        update: {},
        create: { name },
      });
    }
    for (const name of ["A", "B", "C"]) {
      await prisma.customerGrade.upsert({
        where: { companyId_name: { companyId: company.id, name } },
        update: {},
        create: { name },
      });
    }
    const typeDist = await prisma.customerType.findFirstOrThrow({ where: { name: "Distributor" } });
    const gradeA = await prisma.customerGrade.findFirstOrThrow({ where: { name: "A" } });
    for (const c of [
      {
        customerCode: "C001",
        firmName: `Aster Traders (${opts.companyCode})`,
        displayName: "Aster Traders",
        creditLimit: 200000,
        creditDays: 30,
      },
      {
        customerCode: "C002",
        firmName: `Bluebell Stores (${opts.companyCode})`,
        displayName: "Bluebell Stores",
        creditLimit: 100000,
        creditDays: 15,
      },
      {
        customerCode: "C003",
        firmName: `Cedar Enterprises (${opts.companyCode})`,
        displayName: "Cedar Enterprises",
        creditLimit: 350000,
        creditDays: 45,
      },
      {
        customerCode: "C004",
        firmName: `Dune Plastics Mart (${opts.companyCode})`,
        displayName: "Dune Plastics",
        creditLimit: 50000,
        creditDays: 7,
      },
      {
        customerCode: "C005",
        firmName: `Elm Institutional Supplies (${opts.companyCode})`,
        displayName: "Elm Supplies",
        creditLimit: 500000,
        creditDays: 60,
      },
    ]) {
      await prisma.customer.upsert({
        where: { companyId_customerCode: { companyId: company.id, customerCode: c.customerCode } },
        update: {},
        create: {
          ...c,
          creditLimit: D(c.creditLimit),
          createdBy: owner,
          customerTypeId: typeDist.id,
          customerGradeId: gradeA.id,
          mobile: ["9000000001"],
        },
      });
    }
    for (const s of [
      {
        supplierCode: "S001",
        legalName: `Polymer Source (${opts.companyCode}) Pvt Ltd`,
        displayName: "Polymer Source",
        billingCity: "Chennai",
        billingState: "Tamil Nadu",
        stateCode: "33",
        gstRegType: "REGULAR" as const,
      },
      {
        supplierCode: "S002",
        legalName: `Colour Masters (${opts.companyCode}) LLP`,
        displayName: "Colour Masters",
        billingCity: "Coimbatore",
        billingState: "Tamil Nadu",
        stateCode: "33",
        gstRegType: "REGULAR" as const,
      },
      {
        supplierCode: "S003",
        legalName: `Packwell Cartons (${opts.companyCode})`,
        displayName: "Packwell",
        billingCity: "Bengaluru",
        billingState: "Karnataka",
        stateCode: "29",
        gstRegType: "COMPOSITION" as const,
      },
    ]) {
      await prisma.supplier.upsert({
        where: { companyId_supplierCode: { companyId: company.id, supplierCode: s.supplierCode } },
        update: {},
        create: {
          ...s,
          billingAddressLine1: "Demo address",
          billingPincode: "600001",
          createdBy: owner,
          mobile: ["9000000002"],
        },
      });
    }

    // Financial year and invoice numbering
    const fyStart = new Date(Date.UTC(2026, 3, 1));
    const fyEnd = new Date(Date.UTC(2027, 2, 31));
    await prisma.invoiceSetting.upsert({
      where: { companyId: company.id },
      update: {},
      create: { invoicePrefix: "INV", financialYearStart: fyStart, financialYearEnd: fyEnd },
    });
    if (!(await prisma.accountingPeriod.findFirst({ where: { periodName: "FY 2026-27" } }))) {
      await prisma.accountingPeriod.create({
        data: { periodName: "FY 2026-27", startDate: fyStart, endDate: fyEnd },
      });
    }
    await prisma.systemSetting.upsert({
      where: { companyId_key: { companyId: company.id, key: "EOD_CUTOFF_TIME" } },
      update: {},
      create: { key: "EOD_CUTOFF_TIME", value: "23:59" },
    });

    // One field route for the Field app: three customers, covered by the sales user every day.
    const route = await prisma.route.upsert({
      where: { companyId_routeCode: { companyId: company.id, routeCode: "R01" } },
      update: {},
      create: { routeCode: "R01", routeName: "City Route 1" },
    });
    const routeCustomers = await prisma.customer.findMany({
      where: { customerCode: { in: ["C001", "C002", "C003"] } },
      select: { id: true, customerCode: true },
      orderBy: { customerCode: "asc" },
    });
    for (const [idx, c] of routeCustomers.entries()) {
      await prisma.mobileRouteCustomer.upsert({
        where: { routeId_customerId: { routeId: route.id, customerId: c.id } },
        update: { sequence: idx + 1, deletedAt: null },
        create: {
          routeId: route.id,
          customerId: c.id,
          sequence: idx + 1,
          plannedTime: `${9 + idx}:30`.padStart(5, "0"),
        },
      });
    }
    const salesUser = await prisma.user.findUnique({ where: { username: `${opts.slug}.sales` } });
    if (
      salesUser &&
      !(await prisma.mobileRouteAssignment.findFirst({ where: { routeId: route.id } }))
    ) {
      await prisma.mobileRouteAssignment.create({
        data: { routeId: route.id, agentUserId: salesUser.userId, dayOfWeek: null },
      });
    }
    log("masters seeded");
  });

  return company;
}
