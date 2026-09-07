import { describe, expect, it, beforeAll } from "vitest";
import { Prisma } from "@prisma/client";
import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { listRoutes, type RouteEntry } from "../helpers/routes";
import { demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { TENANT_MODELS } from "../../src/lib/prisma";
import { seedTenant } from "../../prisma/seed-lib";

/**
 * Cross-tenant leak suite (F3 exit criterion). Tenant A (the demo tenant) attacks
 * tenant B (seeded here with the same shape):
 *  1. every tenant model, read as A and as B, returns only that tenant's rows;
 *  2. every resolvable route, called as A with B's identifiers, never returns B's
 *     data and never changes B's tables (content hash before/after).
 */
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

type TableSnapshot = Record<string, { count: number; hash: string }>;

const tenantTables = () =>
  Prisma.dmmf.datamodel.models
    .filter((m) => TENANT_MODELS.has(m.name))
    .map((m) => m.dbName ?? m.name);

const snapshotTenant = async (companyId: string): Promise<TableSnapshot> => {
  const prisma = await getPrisma();
  return withoutTenant(() =>
    prisma.$transaction(async (tx) => {
      const out: TableSnapshot = {};
      for (const table of tenantTables()) {
        const rows = await tx.$queryRawUnsafe<{ count: bigint; hash: string }[]>(
          `SELECT count(*)::bigint AS count, md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS hash FROM "${table}" t WHERE company_id = $1::uuid`,
          companyId
        );
        out[table] = { count: Number(rows[0].count), hash: rows[0].hash };
      }
      return out;
    })
  );
};

/** Tenant models the seed leaves empty (policy-covered by rls.spec, not swept here). */
const MODELS_WITHOUT_SEED_ROWS: ReadonlySet<string> = new Set([
  "AgentPosition",
  "AttendanceRecord",
  "CustomerAddress",
  "DailyProductionPlan",
  "EmailConfig",
  "EInvoice",
  "EInvoiceConfig",
  "EmployeePayrollConfig",
  "FilingApproval",
  "EmployeePermanentDeduction",
  "EodStockSnapshot",
  "Expense",
  "FinishedGoodsStock",
  "FinishedGoodsTransaction",
  "FeatureFlagOverride",
  "GoodsDispatch",
  "GoodsDispatchItem",
  "GrnInvoice",
  "GrnInvoiceItem",
  "GrnInvoicePayment",
  "HourlyProduction",
  "Invitation",
  "JournalItem",
  "Location",
  "MachineAssignmentOperator",
  "MachineOeeSnapshot",
  "MachineOperationAssignment",
  "MobileCollection",
  "MobileDevice",
  "MobileSyncRecord",
  "MobileVisit",
  "PayrollConfig",
  "PayrollResult",
  "PayrollRun",
  "PettyCashEntry",
  "ProductCapacityHistory",
  "ProductImage",
  "ProductShiftRecord",
  "ProductionOrder",
  "ProductionOrderHistory",
  "ProductionStep",
  "ProductionWastage",
  "PurchaseOrder",
  "PurchaseOrderItem",
  "PurchaseReturn",
  "PurchaseReturnItem",
  "RawMaterialTransaction",
  "RetentionPolicy",
  "RetentionSweep",
  "SalaryAdvance",
  "SalesInvoice",
  "SalesInvoiceItem",
  "SalesInvoicePayment",
  "SalesOrder",
  "SalesOrderItem",
  "SalesProduct",
  "SalesProductComponent",
  "SalesProductStock",
  "SalesReturn",
  "SalesReturnItem",
  "StockAdjustment",
  "StockAdjustmentItem",
  "StoreLocation",
  "SupplierAddress",
  "SupplierMaterialPrice",
  "Voucher",
  "WeeklyMachineProgram",
  "WhatsappConfig",
  "YearEndClosing",
  "AccountExport",
]);

describe("cross-tenant leak suite", () => {
  let tenantA: string;
  let tenantB: string;
  let idsB: Record<string, string>;
  let before: TableSnapshot;

  beforeAll(async () => {
    const prisma = await getPrisma();
    tenantA = (await demoCompany()).id;
    const b = await seedTenant({
      companyCode: "TEN-B",
      companyName: "Tenant B Industries",
      slug: "tenb",
      globalPrefix: "TB",
      password: "Test@12345678",
    });
    tenantB = b.id;

    idsB = await runAsTenant(tenantB, async () => {
      const first = async (p: Promise<unknown>, key = "id"): Promise<string | undefined> => {
        const r = (await p) as Record<string, unknown> | null;
        return r ? String(r[key]) : undefined;
      };
      const entries: [string, string | undefined][] = [
        ["products", await first(prisma.product.findFirst())],
        ["sales-products", await first(prisma.salesProduct.findFirst())],
        ["customers", await first(prisma.customer.findFirst())],
        ["suppliers", await first(prisma.supplier.findFirst())],
        ["employees", await first(prisma.employee.findFirst())],
        ["users", await first(prisma.user.findFirst(), "userId")],
        ["roles", await first(prisma.role.findFirst())],
        ["departments", await first(prisma.department.findFirst())],
        ["categories", await first(prisma.category.findFirst())],
        ["customer-types", await first(prisma.customerType.findFirst())],
        ["customer-grades", await first(prisma.customerGrade.findFirst())],
        ["shifts", await first(prisma.shift.findFirst())],
        ["accounts/ledgers", await first(prisma.accountLedger.findFirst())],
        ["bill-of-materials", await first(prisma.billOfMaterial.findFirst())],
        ["uoms", await first(prisma.unitOfMeasure.findFirst())],
        ["uom", await first(prisma.unitOfMeasure.findFirst())],
        ["product/uoms", await first(prisma.unitOfMeasure.findFirst())],
        ["machines", await first(prisma.machine.findFirst(), "machineId")],
        ["stores", await first(prisma.store.findFirst(), "storeId")],
        ["raw-materials", await first(prisma.rawMaterial.findFirst(), "rawMaterialId")],
        ["raw-material-stocks", await first(prisma.rawMaterial.findFirst(), "rawMaterialId")],
        ["routes", await first(prisma.route.findFirst())],
        ["mobile/admin", await first(prisma.route.findFirst())],
        ["mobile/customers", await first(prisma.customer.findFirst())],
      ];
      return Object.fromEntries(entries.filter(([, v]) => v !== undefined) as [string, string][]);
    });

    before = await snapshotTenant(tenantB);
  });

  it("every tenant model returns only the caller's rows", async () => {
    const prisma = (await getPrisma()) as any;
    const unexercised: string[] = [];
    for (const model of TENANT_MODELS) {
      const delegate = prisma[lowerFirst(model)];
      const a: { companyId: string }[] = await runAsTenant(tenantA, () =>
        delegate.findMany({ select: { companyId: true } })
      );
      const b: { companyId: string }[] = await runAsTenant(tenantB, () =>
        delegate.findMany({ select: { companyId: true } })
      );
      expect(
        a.filter((r: { companyId: string }) => r.companyId !== tenantA),
        `${model} leaked into tenant A`
      ).toEqual([]);
      expect(
        b.filter((r: { companyId: string }) => r.companyId !== tenantB),
        `${model} leaked into tenant B`
      ).toEqual([]);
      if (a.length === 0 && b.length === 0) unexercised.push(model);
    }
    // Models with no seeded rows in either tenant are still policy-covered (rls.spec) but not
    // exercised here. A new model must either get seed rows or be added to the list below
    // deliberately; other suites sharing this worker database may exercise some of these.
    const unexpected = unexercised.filter((m) => !MODELS_WITHOUT_SEED_ROWS.has(m));
    expect(unexpected, "new tenant models without seed coverage").toEqual([]);
  });

  const paramValue = (route: RouteEntry, param: string): string | undefined => {
    const named: Record<string, string | undefined> = {
      machineId: idsB.machines,
      storeId: idsB.stores,
      rawMaterialId: idsB["raw-materials"],
      productId: idsB.products,
      employeeId: idsB.employees,
      supplierId: idsB.suppliers,
      customerId: idsB.customers,
      ledgerId: idsB["accounts/ledgers"],
      roleId: idsB.roles,
      dataClass: "SESSIONS",
      type: "customers",
    };
    if (param !== "id") return named[param];
    if (route.path.includes("/statements/customer/")) return idsB.customers;
    if (route.path.includes("/statements/supplier/")) return idsB.suppliers;
    const afterApi = route.path.replace(/^\/api\//, "");
    const twoSeg = afterApi.split("/").slice(0, 2).join("/");
    const oneSeg = afterApi.split("/")[0];
    return idsB[twoSeg] ?? idsB[oneSeg];
  };

  const resolve = (route: RouteEntry): { path: string; ids: string[] } | undefined => {
    const params = [...route.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
    if (params.length === 0) return { path: route.path, ids: [] };
    const ids: string[] = [];
    let path = route.path;
    for (const p of params) {
      const v = paramValue(route, p);
      if (v === undefined) return undefined;
      ids.push(v);
      path = path.replace(`:${p}`, encodeURIComponent(v));
    }
    return { path, ids };
  };

  it("a tenant cannot edit another tenant's company record", async () => {
    const prisma = await getPrisma();
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .put(`/api/companies/${tenantB}`)
      .set(auth)
      .send({ companyName: "Hijacked Co" });
    expect([403, 404]).toContain(res.status);
    const b = await prisma.company.findUniqueOrThrow({ where: { id: tenantB } });
    expect(b.companyName).toBe("Tenant B Industries");
  });

  const SKIP = [
    /^\/api\/auth\//,
    /^\/api\/$/,
    /check-username/,
    /\/download-/,
    /\/pdf/,
    /whatsapp\/webhook/,
    /companies\/public/,
    /invitations\/token/,
  ];

  it("no route serves tenant B's data to tenant A, and none changes it", async () => {
    const { auth } = await authed("demo.owner");
    const routes = listRoutes().filter((r) => !SKIP.some((re) => re.test(r.path)));
    const unswept: string[] = [];
    const leaks: string[] = [];
    const serverErrors: string[] = [];

    for (const route of routes) {
      if (route.method === "POST") continue; // creation as A is legitimate
      const resolved = resolve(route);
      if (!resolved) {
        unswept.push(`${route.method} ${route.path}`);
        continue;
      }
      const client = await api();
      let res;
      if (route.method === "GET") res = await client.get(resolved.path).set(auth);
      else if (route.method === "PUT") res = await client.put(resolved.path).set(auth).send({});
      else if (route.method === "PATCH") res = await client.patch(resolved.path).set(auth).send({});
      else res = await client.delete(resolved.path).set(auth);

      const label = `${route.method} ${resolved.path} -> ${res.status}`;
      if (res.status >= 500) serverErrors.push(label);
      const body = JSON.stringify(res.body ?? {});
      if (body.includes(tenantB)) leaks.push(`${label} (companyId in body)`);
      if (
        res.status === 200 &&
        resolved.ids.some((id) => id.length >= 8 && body.includes(`"${id}"`))
      )
        leaks.push(`${label} (B row returned)`);
    }

    expect(leaks).toEqual([]);
    expect(serverErrors).toEqual([]);
    expect(unswept.sort()).toMatchSnapshot();

    const after = await snapshotTenant(tenantB);
    const changed = Object.keys(before).filter(
      (t) => before[t].count !== after[t].count || before[t].hash !== after[t].hash
    );
    expect(changed, "tenant B tables modified by tenant A's requests").toEqual([]);
  });
});
