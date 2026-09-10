import { Prisma } from "@prisma/client";

/** Lazily import the app's Prisma singleton (env must already be set by test/setup.ts). */
export const getPrisma = async () => (await import("../../src/config/prisma")).prisma;

/** Tables that hold seed masters and must survive a reset between tests. */
const KEEP_MODELS = new Set([
  "Company",
  "BusinessPlace",
  "Admin",
  "Permission",
  "Role",
  "RolePermission",
  "User",
  "Department",
  "Shift",
  "UnitOfMeasure",
  "Category",
  "Store",
  "RawMaterial",
  "Product",
  "BillOfMaterial",
  "Machine",
  "CustomerType",
  "CustomerGrade",
  "Customer",
  "Supplier",
  "InvoiceSetting",
  "AccountingPeriod",
  "AccountLedger",
  "SystemSetting",
  "EmailConfig",
  "WhatsappConfig",
  "PayrollConfig",
]);

/** Truncates every transactional table, leaving seeded masters in place. */
export const resetTransactionalTables = async () => {
  const prisma = await getPrisma();
  const tables = Prisma.dmmf.datamodel.models
    .filter((m) => !KEEP_MODELS.has(m.name))
    .map((m) => `"${m.dbName ?? m.name}"`);
  if (tables.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(", ")} RESTART IDENTITY CASCADE`);
};
