import { randomUUID } from "node:crypto";
import { faker } from "@faker-js/faker";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../helpers/db";
import { runAsTenant } from "../../src/lib/tenant-context";

const D = (n: number | string) => new Prisma.Decimal(n);
const code = (prefix: string) =>
  `${prefix}${faker.string.alphanumeric({ length: 6, casing: "upper" })}`;

export const demoCompany = async () => {
  const prisma = await getPrisma();
  return prisma.company.findUniqueOrThrow({ where: { companyCode: "DEMO" } });
};

export const demoOwner = async () => {
  const prisma = await getPrisma();
  return asDemoTenant(() => prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } }));
};

/** Runs `fn` inside the demo tenant's context (factories are called outside any request). */
export const asDemoTenant = async <T>(fn: () => Promise<T>): Promise<T> => {
  const company = await demoCompany();
  return runAsTenant(company.id, fn);
};

export const createCustomer = async (
  overrides: Partial<Prisma.CustomerUncheckedCreateInput> = {}
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const owner = await demoOwner();
    return prisma.customer.create({
      data: {
        companyId: company.id,
        createdBy: owner.userId,
        customerCode: code("C"),
        firmName: `${faker.company.name()} (Test)`,
        displayName: faker.company.name(),
        creditLimit: D(100000),
        creditDays: 30,
        mobile: ["9000000000"],
        ...overrides,
      },
    });
  });
};

export const createSupplier = async (
  overrides: Partial<Prisma.SupplierUncheckedCreateInput> = {}
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const owner = await demoOwner();
    return prisma.supplier.create({
      data: {
        companyId: company.id,
        createdBy: owner.userId,
        supplierCode: code("S"),
        legalName: `${faker.company.name()} (Test)`,
        billingAddressLine1: faker.location.streetAddress(),
        billingCity: "Chennai",
        billingState: "Tamil Nadu",
        billingPincode: "600001",
        stateCode: "33",
        mobile: ["9000000000"],
        ...overrides,
      },
    });
  });
};

export const createProduct = async (
  overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const owner = await demoOwner();
    const nos = await prisma.unitOfMeasure.findFirstOrThrow({ where: { uomCode: "NOS" } });
    return prisma.product.create({
      data: {
        productCode: code("P"),
        productName: faker.commerce.productName(),
        uomId: nos.id,
        rate: D(faker.number.int({ min: 10, max: 900 })),
        createdBy: owner.userId,
        ...overrides,
      },
    });
  });
};

export const createRawMaterial = async (
  overrides: Partial<Prisma.RawMaterialUncheckedCreateInput> = {}
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const owner = await demoOwner();
    return prisma.rawMaterial.create({
      data: {
        rawMaterialId: code("RM"),
        materialName: `${faker.commerce.productMaterial()} ${faker.string.alpha(4)}`,
        baseUom: "KG",
        rate: D(100),
        onHandQty: D(500),
        storeId: "ST-RM",
        createdBy: owner.userId,
        ...overrides,
      },
    });
  });
};

export const createEmployee = async (
  overrides: Partial<Prisma.EmployeeUncheckedCreateInput> = {}
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const owner = await demoOwner();
    return prisma.employee.create({
      data: {
        empCode: code("EMP"),
        fullName: faker.person.fullName(),
        status: "active",
        designation: "Operator",
        createdBy: owner.userId,
        ...overrides,
      },
    });
  });
};

export const createAttendanceRecord = async (
  overrides: Partial<Prisma.AttendanceRecordUncheckedCreateInput> & {
    employeeId: bigint;
    date: string;
  }
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    return prisma.attendanceRecord.create({
      data: {
        period: overrides.date.slice(0, 7),
        status: "PRESENT",
        otHours: D(0),
        lateMinutes: 0,
        permissionMinutes: 0,
        salaryAdvance: D(0),
        ...overrides,
      },
    });
  });
};

export const createPayrollRun = async (
  overrides: Partial<Prisma.PayrollRunUncheckedCreateInput> = {}
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const owner = await demoOwner();
    return prisma.payrollRun.create({
      data: {
        runCode: code("PR-T"),
        period: "2026-09",
        type: "MONTHLY",
        status: "DRAFT",
        createdById: owner.userId,
        ...overrides,
      },
    });
  });
};

export const createPayrollResult = async (
  overrides: Partial<Prisma.PayrollResultUncheckedCreateInput> & {
    payrollRunId: number;
    employeeId: bigint;
  }
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    return prisma.payrollResult.create({
      data: {
        employeeCode: code("EMP"),
        employeeName: faker.person.fullName(),
        department: "",
        salaryType: "FIXED_MONTHLY",
        ...overrides,
      },
    });
  });
};

export const createSalaryAdvance = async (
  overrides: Partial<Prisma.SalaryAdvanceUncheckedCreateInput> & { employeeId: bigint }
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    return prisma.salaryAdvance.create({
      data: {
        amount: D(1000),
        disbursedDate: new Date(),
        status: "PENDING",
        ...overrides,
      },
    });
  });
};

export const createFineDeduction = async (
  overrides: Partial<Prisma.EmployeeFineDeductionUncheckedCreateInput> & { employeeId: bigint }
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const occurredOn = overrides.occurredOn ? new Date(overrides.occurredOn as any) : new Date();
    return prisma.employeeFineDeduction.create({
      data: {
        kind: "FINE",
        occurredOn,
        cause: "Late to shift without notice",
        amount: D(50),
        shownCauseGiven: true,
        // Registers (P2-03/P2-13) only show APPROVED rows; factory-created rows simulate
        // already-approved data unless a test overrides status explicitly.
        status: "APPROVED",
        wagePeriod: occurredOn.toISOString().slice(0, 7),
        ...overrides,
      },
    });
  });
};

export const createSalesInvoice = async (
  overrides: Partial<Prisma.SalesInvoiceUncheckedCreateInput> & { customerId: string }
) => {
  return asDemoTenant(async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const total = overrides.grandTotal ?? D(3000);
    return prisma.salesInvoice.create({
      data: {
        companyId: company.id,
        invoiceNo: code("INV-T"),
        invoiceDate: new Date(),
        subTotal: total,
        taxTotal: D(0),
        grandTotal: total,
        status: "UNPAID",
        payments: [],
        ...overrides,
      },
    });
  });
};
