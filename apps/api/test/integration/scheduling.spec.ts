import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";

/**
 * The scheduling gap the Phase 1 completion note left behind (P2-T): subscription invoices,
 * leave accrual and SMS sends were all manual or synchronous. Each is now a pg-boss job; what is
 * proved here is that every one of them is idempotent, since pg-boss retries and a fan-out can
 * enqueue the same tenant's work twice.
 */

describe("subscription billing-cycle job", () => {
  let COMPANY_ID: string;

  beforeAll(async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const company = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyCode: `SC${randomUUID().slice(0, 6).toUpperCase()}`,
          companyName: "Scheduling Billing Co",
          isActive: true,
        },
      })
    );
    COMPANY_ID = company.id;
    const plan = await prisma.plan.findFirstOrThrow({ where: { isActive: true } });
    await runAsTenant(COMPANY_ID, () =>
      prisma.subscription.create({
        data: {
          planId: plan.id,
          status: "ACTIVE",
          // Well in the past on both sides, so the anchor has definitely elapsed.
          currentPeriodStart: new Date("2029-01-01T00:00:00Z"),
          currentPeriodEnd: new Date("2029-02-01T00:00:00Z"),
        },
      })
    );
  });

  it("raises exactly one invoice once the period has ended, however many times it is asked", async () => {
    const { billingService } = await import("../../src/modules/payments/billing.service");
    const first = await billingService.raiseNextIfDue(COMPANY_ID, new Date("2029-03-01T00:00:00Z"));
    expect(first).not.toBeNull();
    expect(first!.status).toBe("DUE");
    expect(first!.periodStart.toISOString()).toBe("2029-02-01T00:00:00.000Z");

    const second = await billingService.raiseNextIfDue(
      COMPANY_ID,
      new Date("2029-03-01T00:00:00Z")
    );
    expect(second).toBeNull();

    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const count = await runAsTenant(COMPANY_ID, () => prisma.subscriptionInvoice.count());
    expect(count).toBe(1);
  });

  it("does nothing for a subscription still inside its trial or its current period", async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const company = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyCode: `ST${randomUUID().slice(0, 6).toUpperCase()}`,
          companyName: "Scheduling Trial Co",
          isActive: true,
        },
      })
    );
    const plan = await prisma.plan.findFirstOrThrow({ where: { isActive: true } });
    await runAsTenant(company.id, () =>
      prisma.subscription.create({
        data: {
          planId: plan.id,
          status: "TRIALING",
          trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          currentPeriodStart: new Date(),
        },
      })
    );
    const { billingService } = await import("../../src/modules/payments/billing.service");
    expect(await billingService.raiseNextIfDue(company.id)).toBeNull();
  });

  it("the per-tenant job handler is what the fan-out drives", async () => {
    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    // A fresh period that has already ended relative to the real clock (the handler defaults
    // `asOf` to `new Date()`), so this test does not depend on the previous one's outcome.
    await runAsTenant(COMPANY_ID, () =>
      prisma.subscription.update({
        where: { companyId: COMPANY_ID },
        data: { currentPeriodEnd: new Date("2020-01-01T00:00:00Z") },
      })
    );
    await runAsTenant(COMPANY_ID, () => prisma.subscriptionInvoice.deleteMany());

    const { billingCycleHandler } = await import("../../src/jobs/billing-cycle.job");
    const { QUEUES } = await import("../../src/lib/jobs");
    const out = await billingCycleHandler({
      id: randomUUID(),
      name: QUEUES.BILLING_CYCLE,
      data: { companyId: COMPANY_ID },
    } as never);
    expect(out.raised).toBe(true);

    const again = await billingCycleHandler({
      id: randomUUID(),
      name: QUEUES.BILLING_CYCLE,
      data: { companyId: COMPANY_ID },
    } as never);
    expect(again.raised).toBe(false);
  });
});

describe("leave accrual job", () => {
  const FY_MONTH_END = "2030-04-30";
  let COMPANY_ID: string;
  let EMPLOYEE_ID: string;

  beforeAll(async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const company = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyCode: `SL${randomUUID().slice(0, 6).toUpperCase()}`,
          companyName: "Scheduling Leave Co",
          isActive: true,
        },
      })
    );
    COMPANY_ID = company.id;
    const employee = await runAsTenant(COMPANY_ID, () =>
      prisma.employee.create({
        data: {
          companyId: COMPANY_ID,
          empCode: "SL-001",
          fullName: "Leave Accrual Test",
          dateOfJoining: new Date("2029-04-01T00:00:00Z"),
          basicSalary: 20000,
          grossSalary: 20000,
          status: "active",
        },
      })
    );
    EMPLOYEE_ID = String(employee.id);

    // Twenty-five present days in April: one earned-leave day accrues (one per twenty worked).
    const dates = Array.from({ length: 25 }, (_, i) => `2030-04-${String(i + 1).padStart(2, "0")}`);
    await runAsTenant(COMPANY_ID, () =>
      prisma.attendanceRecord.createMany({
        data: dates.map((date) => ({
          companyId: COMPANY_ID,
          employeeId: employee.id,
          date,
          period: "2030-04",
          status: "PRESENT",
        })),
      })
    );
  });

  it("recomputes earned leave from days worked and grants the annual leave up front", async () => {
    const { leaveAccrualHandler } = await import("../../src/jobs/leave-accrual.job");
    const { QUEUES } = await import("../../src/lib/jobs");
    const out = await leaveAccrualHandler({
      id: randomUUID(),
      name: QUEUES.LEAVE_ACCRUAL,
      data: { companyId: COMPANY_ID, monthEnd: FY_MONTH_END },
    } as never);
    expect(out.employees).toBe(1);

    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const balances = await runAsTenant(COMPANY_ID, () =>
      prisma.leaveBalance.findMany({
        where: { employeeId: BigInt(EMPLOYEE_ID), fyCode: "2030-31" },
        include: { leaveType: { select: { code: true } } },
      })
    );
    const byCode = Object.fromEntries(balances.map((b) => [b.leaveType.code, Number(b.accrued)]));
    expect(byCode.EL).toBe(1); // floor(25 / 20)
    expect(byCode.CL).toBe(7); // annual basis: the whole year's entitlement, not time-scaled
    expect(byCode.SL).toBe(7);
  });

  it("recomputes rather than double-accruing on a second run", async () => {
    const { leaveAccrualHandler } = await import("../../src/jobs/leave-accrual.job");
    const { QUEUES } = await import("../../src/lib/jobs");
    await leaveAccrualHandler({
      id: randomUUID(),
      name: QUEUES.LEAVE_ACCRUAL,
      data: { companyId: COMPANY_ID, monthEnd: FY_MONTH_END },
    } as never);

    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    const el = await runAsTenant(COMPANY_ID, () =>
      prisma.leaveBalance.findFirstOrThrow({
        where: {
          employeeId: BigInt(EMPLOYEE_ID),
          fyCode: "2030-31",
          leaveType: { code: "EL" },
        },
        include: { leaveType: { select: { code: true } } },
      })
    );
    expect(Number(el.accrued)).toBeLessThan(2); // still ~1 day, not 2
  });
});

describe("SMS send queue", () => {
  let OWNER: { auth: Record<string, string> };

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const client = await api();
    const templates = await client.get("/api/sms/templates").set(OWNER.auth);
    for (const t of templates.body.data as { code: string; name: string; body: string }[]) {
      await client
        .put("/api/sms/templates")
        .set(OWNER.auth)
        .send({
          code: t.code,
          name: t.name,
          category: "TRANSACTIONAL",
          dltTemplateId: `110170000000${t.code.slice(0, 4)}`,
          body: t.body,
          isActive: true,
        });
    }
    await client.put("/api/sms/settings").set(OWNER.auth).send({
      provider: "FIXTURE",
      enabled: true,
      senderId: "SHFTLN",
      principalEntityId: "1101000000000001",
      authKey: "fixture-auth-key-2",
      dailyCap: 2000,
    });
  });

  it("a templated send is queued and delivered by the worker, not the request", async () => {
    const { startJobs, stopJobs, getBoss, QUEUES } = await import("../../src/lib/jobs");
    await startJobs({ schedule: false });
    try {
      const { registerWorkers } = await import("../../src/jobs");
      await registerWorkers({ pollingIntervalSeconds: 0.5 });

      const { smsService } = await import("../../src/modules/sms/sms.service");
      const row = await asDemoTenant(() =>
        smsService.sendTemplate({
          to: "9123456780",
          templateCode: "PAYMENT_RECEIVED",
          values: { name: "Test Co", amount: "500", invoiceNo: "INV-1" },
        })
      );
      // Queued by the request; not yet sent.
      expect(row.status).toBe("QUEUED");

      const boss = getBoss();
      const deadline = Date.now() + 10_000;
      let sent: { status: string } | null = null;
      while (Date.now() < deadline) {
        const current = await asDemoTenant(() =>
          (async () => {
            const prisma = await getPrisma();
            return prisma.smsMessage.findUnique({ where: { id: row.id } });
          })()
        );
        if (current && current.status !== "QUEUED") {
          sent = current;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(sent?.status).toBe("SENT");
      void boss;
      const { fixtureSmsProvider } = await import("../../src/modules/sms/providers");
      expect(fixtureSmsProvider.sent.some((m) => m.to === "9123456780")).toBe(true);
      expect(QUEUES.SMS_SEND).toBeTruthy();
    } finally {
      await stopJobs();
    }
  });

  it("an OTP still sends inline even with the queue running and no worker to drain it", async () => {
    const { startJobs, stopJobs } = await import("../../src/lib/jobs");
    await startJobs({ schedule: false }); // no worker registered: a queued send would hang forever
    try {
      const { otpService } = await import("../../src/modules/sms/otp.service");
      // If this ever went through the queue, it would still be pending when the test ends and
      // this call would never resolve — resolving at all is the proof it stayed inline.
      const challenge = await asDemoTenant(() =>
        otpService.request({ purpose: "MOBILE_VERIFY", mobile: "9123456781" })
      );
      expect(challenge.challengeId).toBeTruthy();
      const { fixtureSmsProvider } = await import("../../src/modules/sms/providers");
      expect(fixtureSmsProvider.sent.some((m) => m.to === "9123456781")).toBe(true);
    } finally {
      await stopJobs();
    }
  });
});
