/**
 * Tenant provisioning (P1-00). Turns a company record into a working tenant:
 * chart of accounts, head-office business place, default roles from the
 * permission registry, units, the current financial year with its accounting
 * period and invoice settings, document sequences and the settings other
 * modules expect. Idempotent, so the development seed and the platform API
 * share it and re-running never duplicates rows.
 */
import { DEFAULT_PLAN_CODE, PERMISSION_REGISTRY, PLAN_TIERS, TRIAL_DAYS } from "@shiftline/shared";
import type { Company } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { runAsTenant, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { accountsService } from "../accounts/accounts.service";
import { entitlementService } from "../entitlements/entitlement.service";
import { gstService } from "../gst/gst.service";

const keysFor = (modules: string[], actions?: string[]) =>
  PERMISSION_REGISTRY.filter((m) => modules.includes(m.module)).flatMap((m) =>
    m.actions.filter((a) => !actions || actions.includes(a)).map((a) => `${m.module}.${a}`)
  );

export interface RoleDef {
  code: string;
  name: string;
  description: string;
  keys: string[];
}

/** Default roles every tenant starts with; the owner may edit or add to them. */
export const ROLE_DEFS = (): RoleDef[] => [
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
    keys: [
      ...keysFor([
        "accounts",
        "payable",
        "receivable",
        "vouchers",
        "petty-cash",
        "chart-of-accounts",
        "sales-invoices",
        "advances",
        "currencies",
        "job-work",
        "purchase-orders",
        "invoice",
        "sales-returns",
        "purchase-returns",
        "customers",
        "suppliers",
        "reports",
        "dash-overview",
        "invoice-settings",
        "gst_tax",
        "expenses",
        "retention",
      ]),
      // The accountant prepares the year-end closing; the owner approves it (P1-09e).
      ...keysFor(["year-end"], ["view", "prepare"]),
      // Filings (P1-04): the accountant prepares and files; the owner approves.
      ...keysFor(["filings"], ["view", "prepare", "submit"]),
      ...keysFor(["insights"]),
      // E-invoicing (P1-11): the accountant raises and cancels IRNs and keeps the GSP setup.
      ...keysFor(["e-invoice"]),
      ...keysFor(["eway-bill", "transporters"]),
      // GST returns (P1-13): prepared and filed by the accountant, approved on the filing gate.
      ...keysFor(["gst-returns"]),
      // TDS (P1-15): the accountant deducts, pays the challan and prepares the return; the
      // owner approves it on the filing gate like every other return.
      ...keysFor(["tds"], ["view", "create", "manage", "pay", "prepare", "file"]),
      // Tally export (P1-06): handing the books to the auditor is the accountant's job.
      ...keysFor(["tally"]),
      // Fixed assets (P1-18): the accountant keeps the register and runs the monthly charge.
      ...keysFor(["assets"]),
      // Imports (P1-17): the bill of entry and its credit are the accountant’s to record.
      ...keysFor(["imports"]),
      // Costing (P1-19): valuation, cost centres and budgets are the accountant’s ground.
      ...keysFor(["costing"]),
      // Banking (P1-20): the reconciliation and the cheque register are the accountant’s.
      ...keysFor(["banking"]),
      // Leave (P2-09): the accountant is the office's HR contact in a company this size and
      // approves requests; every employee-mapped role below gets view/request for themselves.
      ...keysFor(["leave"]),
      // Fines and deductions (P2-13): the accountant is the payroll operator here too — raises,
      // records the show-cause and approves, the same as the rest of payroll it already runs.
      ...keysFor(["fines"]),
      // Export incentives (TN-01): the accountant chases drawback, RoDTEP scrips and EPCG
      // obligations the same way it chases every other receivable.
      ...keysFor(["export-incentives"]),
      // Employee search (P2-15): a light picker for the leave and fines screens this role runs.
      ...keysFor(["employees"], ["search"]),
    ],
  },
  {
    code: "STORES",
    name: "Stores",
    description: "Inventory and dispatch",
    keys: [
      ...keysFor([
        "raw_materials",
        "raw_material_categories",
        "wastage-store",
        "stores",
        "stock-adjustments",
        "goods-dispatch",
        // Customer delivery schedules (TN-02): the dispatch planner works from them.
        "delivery-schedules",
        "eod-stock",
        "inventory",
        "dash-inventory",
        "products",
        "categories",
        "uoms",
        "eway-bill",
        "transporters",
        "job-work",
      ]),
      // Leave (P2-09): self-service for whoever here has an employee record.
      ...keysFor(["leave"], ["view", "request"]),
      // Employee search (P2-15): the picker on the leave screen this role holds view/request on.
      ...keysFor(["employees"], ["search"]),
    ],
  },
  {
    code: "PRODUCTION",
    name: "Production",
    description: "Planning and shop floor",
    keys: [
      ...keysFor([
        "production_orders",
        "weekly_programs",
        "daily-machine-planning",
        "hourly_productions",
        "production-wastages",
        "machines",
        "machine-assignments",
        "shifts",
        "dash-machines",
        "oee-dashboard",
        "products",
        "raw_materials",
        "insights",
        "machine-telemetry",
        "order-tna",
      ]),
      // Leave (P2-09): self-service for whoever here has an employee record.
      ...keysFor(["leave"], ["view", "request"]),
      // Employee search (P2-15): the picker on the leave screen this role holds view/request on.
      ...keysFor(["employees"], ["search"]),
    ],
  },
  {
    code: "SALES_EXEC",
    name: "Sales Executive",
    description: "Field sales via the mobile app",
    keys: [
      ...keysFor(["customers", "sales-orders", "quotations", "dash-overview"], ["view", "create"]),
      ...keysFor(["mobile-app"], ["view", "create"]),
      ...keysFor(["insights"]),
      // Leave (P2-09): self-service for whoever here has an employee record.
      ...keysFor(["leave"], ["view", "request"]),
      // Employee search (P2-15): the picker on the leave screen this role holds view/request on.
      ...keysFor(["employees"], ["search"]),
    ],
  },
  {
    // P1-09d: the statutory auditor reads everything about the books and changes nothing.
    code: "AUDITOR",
    name: "Auditor",
    description: "Read-only access to books, documents, reports and the audit trail",
    keys: [
      ...keysFor(
        [
          "accounts",
          "payable",
          "receivable",
          "vouchers",
          "petty-cash",
          "chart-of-accounts",
          "sales-invoices",
          "sales-returns",
          "purchaseOrders",
          "invoice",
          "purchase-returns",
          "expenses",
          "customers",
          "suppliers",
          "products",
          "raw_materials",
          "raw_material_stocks",
          "finished_goods_stocks",
          "stock-adjustments",
          "sales-reports",
          "purchase-reports",
          "inventory-reports",
          "production-reports",
          "dash-overview",
          "invoice-settings",
          "gst_tax",
          "company-settings",
          "payroll",
          "payroll-run",
          "leave",
          "profile",
          "year-end",
        ],
        ["view"]
      ),
      ...keysFor(["audit-reports"], ["view", "export"]),
      // The inspector's registers (P2-03): the auditor already reads payroll, and these are
      // exactly the reports a labour inspector asks for. Export stays with the owner, like every
      // other export outside audit-reports — the auditor role is read-only by design (see the
      // audit-trail suite's "no non-view keys beyond audit-reports.export" check).
      ...keysFor(["registers"], ["view"]),
      // Fines and deductions (P2-13): read-only, same shape as the registers above.
      ...keysFor(["fines"], ["view"]),
      // Employee search (P2-15): the picker used wherever this role reads leave/fines/payroll.
      ...keysFor(["employees"], ["search"]),
    ],
  },
];

/** Document types that get a numbering series per financial year from day one. */
export const SEQUENCED_DOC_TYPES: { docType: string; prefix: string }[] = [
  { docType: "SALES_ORDER", prefix: "SO" },
  { docType: "SALES_INVOICE", prefix: "INV" },
  { docType: "PURCHASE_ORDER", prefix: "PO" },
  { docType: "GRN", prefix: "GRN" },
  { docType: "RECEIPT", prefix: "RCT" },
  { docType: "PAYMENT", prefix: "PMT" },
  { docType: "JOURNAL", prefix: "JV" },
  { docType: "CONTRA", prefix: "CTR" },
  { docType: "CREDIT_NOTE", prefix: "CN" },
  { docType: "DEBIT_NOTE", prefix: "DN" },
  { docType: "DELIVERY_CHALLAN", prefix: "DC" },
  { docType: "SALES_RETURN", prefix: "SR" },
  { docType: "PURCHASE_RETURN", prefix: "PR" },
];

export const DEFAULT_UOMS = [
  { uomCode: "NOS", uomName: "Numbers" },
  { uomCode: "KG", uomName: "Kilogram" },
  { uomCode: "G", uomName: "Gram" },
  { uomCode: "MTR", uomName: "Metre" },
  { uomCode: "LTR", uomName: "Litre" },
  { uomCode: "BOX", uomName: "Box" },
  { uomCode: "SET", uomName: "Set" },
];

export interface ProvisionInput {
  companyCode: string;
  companyName: string;
  legalName?: string;
  /** URL-safe handle, unique across tenants (login branding, invitations). */
  slug: string;
  email?: string;
  phone?: string;
  gstin?: string;
  /** Two-digit GST state code; derived from the GSTIN when absent. */
  stateCode?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  /** First day of the financial year to open; defaults to the current Indian FY (1 April). */
  fyStart?: Date;
  isOnboarded?: boolean;
  /** Plan code from the catalogue; defaults to the Starter trial. */
  planCode?: string;
  /** Subscription status to start in; defaults to TRIALING for the default plan, ACTIVE otherwise when set. */
  subscriptionStatus?: "TRIALING" | "ACTIVE";
  createdBy?: string;
}

export interface ProvisionResult {
  company: Company;
  roles: Record<string, number>;
  fyCode: string;
  created: boolean;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

/** Indian financial year containing `d` (1 April – 31 March). */
export const financialYearFor = (d: Date = new Date()) => {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  const start = new Date(Date.UTC(y, 3, 1));
  const end = new Date(Date.UTC(y + 1, 2, 31));
  const code = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return { start, end, code, periodName: `FY ${code}` };
};

class ProvisioningService {
  async provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
    if (!SLUG_RE.test(input.slug)) {
      throw new ApiError(400, "slug must be 2–40 lowercase letters, digits or hyphens");
    }
    const stateCode = input.stateCode ?? (input.gstin ? input.gstin.slice(0, 2) : undefined);
    const fy = financialYearFor(input.fyStart);

    const existing = await withoutTenant(() =>
      prisma.company.findFirst({
        where: { OR: [{ companyCode: input.companyCode }, { slug: input.slug }] },
      })
    );
    if (existing && existing.companyCode !== input.companyCode) {
      throw new ApiError(409, `slug "${input.slug}" is already taken`);
    }
    const company =
      existing ??
      (await withoutTenant(() =>
        prisma.company.create({
          data: {
            companyCode: input.companyCode,
            companyName: input.companyName,
            legalName: input.legalName ?? input.companyName,
            shortName: input.companyCode,
            slug: input.slug,
            email: input.email,
            phone: input.phone,
            gstin: input.gstin,
            addressLine1: input.addressLine1,
            city: input.city,
            state: input.state,
            zipcode: input.zipcode,
            country: input.country ?? "India",
            stateCode: stateCode ?? null,
            gstRegistrationType: input.gstin ? "REGULAR" : "UNREGISTERED",
            isOnboarded: input.isOnboarded ?? false,
            onboardingStep: input.isOnboarded ? null : "company",
            createdBy: input.createdBy,
          },
        })
      ));

    await this.ensurePlans();
    const planCode = input.planCode ?? DEFAULT_PLAN_CODE;
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) throw new ApiError(400, `Unknown plan ${planCode}`);
    const status =
      input.subscriptionStatus ??
      (input.planCode && input.planCode !== DEFAULT_PLAN_CODE ? "ACTIVE" : "TRIALING");

    const roles = await runAsTenant(company.id, async () => {
      if (!(await prisma.subscription.findUnique({ where: { companyId: company.id } }))) {
        await prisma.subscription.create({
          data: {
            planId: plan.id,
            status,
            trialEndsAt:
              status === "TRIALING"
                ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
                : null,
            currentPeriodStart: new Date(),
            createdBy: input.createdBy,
          },
        });
        entitlementService.invalidate(company.id);
      }
      await accountsService.ensureSystemLedgersExist();
      await gstService.ensureGstMasters();

      if ((await prisma.businessPlace.count()) === 0) {
        await prisma.businessPlace.create({
          data: {
            code: "HO",
            name: "Head Office",
            type: "HEAD_OFFICE",
            gstPlaceCode: stateCode ?? "",
            isHeadOffice: true,
          },
        });
      }

      const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
      const permByKey = new Map(permissions.map((p) => [p.key, p.id]));
      const roleIds: Record<string, number> = {};
      for (const def of ROLE_DEFS()) {
        const role = await prisma.role.upsert({
          where: { companyId_code: { companyId: company.id, code: def.code } },
          update: { name: def.name, description: def.description },
          create: {
            code: def.code,
            name: def.name,
            description: def.description,
            isSystem: false,
          },
        });
        roleIds[def.code] = role.id;
        const ids = def.keys
          .map((k) => permByKey.get(k))
          .filter((x): x is number => typeof x === "number");
        if (ids.length) {
          await prisma.rolePermission.createMany({
            data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
            skipDuplicates: true,
          });
        }
      }

      for (const u of DEFAULT_UOMS) {
        await prisma.unitOfMeasure.upsert({
          where: { companyId_uomCode: { companyId: company.id, uomCode: u.uomCode } },
          update: {},
          create: u,
        });
      }

      await prisma.invoiceSetting.upsert({
        where: { companyId: company.id },
        update: {},
        create: { invoicePrefix: "INV", financialYearStart: fy.start, financialYearEnd: fy.end },
      });
      if (!(await prisma.accountingPeriod.findFirst({ where: { periodName: fy.periodName } }))) {
        await prisma.accountingPeriod.create({
          data: { periodName: fy.periodName, startDate: fy.start, endDate: fy.end },
        });
      }
      for (const seq of SEQUENCED_DOC_TYPES) {
        await prisma.documentSequence
          .upsert({
            where: {
              companyId_docType_businessPlaceId_fyCode: {
                companyId: company.id,
                docType: seq.docType,
                businessPlaceId: null as unknown as bigint,
                fyCode: fy.code,
              },
            },
            update: {},
            create: { docType: seq.docType, prefix: seq.prefix, fyCode: fy.code },
          })
          .catch(async () => {
            // Postgres treats NULLs as distinct in unique indexes; fall back to find-or-create.
            const found = await prisma.documentSequence.findFirst({
              where: { docType: seq.docType, businessPlaceId: null, fyCode: fy.code },
            });
            if (!found) {
              await prisma.documentSequence.create({
                data: { docType: seq.docType, prefix: seq.prefix, fyCode: fy.code },
              });
            }
          });
      }

      for (const [key, value] of [
        ["EOD_CUTOFF_TIME", "23:59"],
        ["MOBILE_ORDER_STATUS", "DRAFT"],
      ] as const) {
        await prisma.systemSetting.upsert({
          where: { companyId_key: { companyId: company.id, key } },
          update: {},
          create: { key, value },
        });
      }
      return roleIds;
    });

    return { company, roles, fyCode: fy.code, created: !existing };
  }

  /**
   * The plan catalogue from the shared registry. Existing rows keep their edited limits and
   * prices, but a feature added to a tier in the registry (a new package shipping) reaches
   * every database on the next start, otherwise tenants on that tier would be refused it.
   */
  async ensurePlans() {
    for (const tier of PLAN_TIERS) {
      const existing = await prisma.plan.findUnique({
        where: { code: tier.code },
        select: { features: true },
      });
      const merged = existing
        ? [...new Set([...existing.features, ...tier.features])]
        : [...tier.features];
      await prisma.plan.upsert({
        where: { code: tier.code },
        update: existing && merged.length !== existing.features.length ? { features: merged } : {},
        create: {
          code: tier.code,
          name: tier.name,
          description: tier.description,
          features: [...tier.features],
          seatLimit: tier.seatLimit,
          apiLimit: tier.apiLimit,
          priceInrMonthly: tier.priceInrMonthly,
          sortOrder: tier.sortOrder,
        },
      });
    }
  }

  /** Platform view: every tenant with a few counters. */
  async listTenants() {
    return withoutTenant(async () => {
      const companies = await prisma.company.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          companyCode: true,
          companyName: true,
          slug: true,
          gstin: true,
          isActive: true,
          isOnboarded: true,
          onboardingStep: true,
          tosAcceptedAt: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              seats: true,
              trialEndsAt: true,
              currentPeriodEnd: true,
              plan: { select: { code: true, name: true } },
            },
          },
          _count: { select: { users: true, invitations: true } },
        },
      });
      return companies.map(({ _count, subscription, ...c }) => ({
        ...c,
        plan: subscription?.plan ?? null,
        subscriptionStatus: subscription?.status ?? null,
        seats: subscription?.seats ?? null,
        trialEndsAt: subscription?.trialEndsAt ?? null,
        users: _count.users,
        pendingInvitations: _count.invitations,
      }));
    });
  }
}

export const provisioningService = new ProvisioningService();
