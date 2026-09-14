import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, demoCompany } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Scheduled work (P2-01): four pg-boss jobs, each proved the way the existing job specs prove
 * theirs — the handler called directly, not through a live pg-boss round trip, because what is
 * being proved is the service's own idempotency and tenancy rather than the queue library.
 */
const sfx = Date.now().toString(36).slice(-6);

/** A second tenant, created the light way `tally.spec.ts` and `tenant-codes.spec.ts` use: a bare
 * company row, no onboarding wizard, so a job's tenant loop and RLS can be proved without a full
 * signup flow. */
let otherTenantSeq = 0;
const otherTenant = async (name: string) => {
  const prisma = await getPrisma();
  return withoutTenant(() =>
    prisma.company.create({
      data: { companyName: name, companyCode: `SW${sfx}${++otherTenantSeq}` },
    })
  );
};

describe("subscription invoices (billing.job)", () => {
  let OTHER_ID: string;

  beforeAll(async () => {
    const prisma = await getPrisma();
    const other = await otherTenant("Scheduled Work Billing Co");
    OTHER_ID = other.id;
    const starter = await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    // The demo tenant is on ENTERPRISE, which has no list price — exactly the tenant this sweep
    // should skip rather than fail. The second tenant is priced, so it is the one that gets billed.
    await runAsTenant(OTHER_ID, () => prisma.subscription.create({ data: { planId: starter.id } }));
  });

  it("raises one invoice per tenant per period, skips the priceless tenant, and is idempotent", async () => {
    const { billingSweepHandler } = await import("../../src/jobs/billing.job");
    const prisma = await getPrisma();

    const first = await billingSweepHandler();
    expect(first.raised).toBeGreaterThanOrEqual(1);

    const periodStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
    );
    const invoice = await runAsTenant(OTHER_ID, () =>
      prisma.subscriptionInvoice.findFirst({ where: { periodStart } })
    );
    expect(invoice).not.toBeNull();
    expect(Number(invoice!.amount)).toBe(2999);
    expect(invoice!.status).toBe("DUE");

    // The demo tenant (ENTERPRISE, no list price) has nothing raised for it.
    const demoInvoice = await asDemoTenant(() =>
      prisma.subscriptionInvoice.findFirst({ where: { periodStart } })
    );
    expect(demoInvoice).toBeNull();

    // Running it again this month changes nothing.
    const second = await billingSweepHandler();
    const countAfter = await runAsTenant(OTHER_ID, () =>
      prisma.subscriptionInvoice.count({ where: { periodStart } })
    );
    expect(countAfter).toBe(1);
    expect(second.raised + second.skipped).toBe(second.companies);

    // Cross-tenant: the invoice is invisible under any other company's own context.
    const demoId = (await demoCompany()).id;
    const seenFromDemo = await runAsTenant(demoId, () =>
      prisma.subscriptionInvoice.findUnique({ where: { id: invoice!.id } })
    );
    expect(seenFromDemo).toBeNull();
  });
});

describe("cheque-due warnings (banking.job)", () => {
  let OWNER: { auth: Record<string, string> };
  let OTHER_ID: string;

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const other = await otherTenant("Scheduled Work Banking Co");
    OTHER_ID = other.id;
  });

  it("warns once per cheque per day for cheques due within two days, and leaves the rest alone", async () => {
    const client = await api();
    const dueDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // tomorrow
    const farDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10); // in a month

    const due = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({
        kind: "ISSUED",
        chequeNo: `SW${sfx}A`,
        chequeDate: dueDate,
        amount: 12345,
        partyName: "Scheduled Work Supplier",
      });
    expect(due.status).toBe(201);

    const notDue = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({
        kind: "RECEIVED",
        chequeNo: `SW${sfx}B`,
        chequeDate: farDate,
        amount: 500,
        partyName: "Scheduled Work Customer",
      });
    expect(notDue.status).toBe(201);

    const { chequeDueHandler } = await import("../../src/jobs/banking.job");
    const first = await chequeDueHandler();
    expect(first.sent).toBeGreaterThanOrEqual(1);

    const prisma = await getPrisma();
    const link = `/accounts/bank-reconciliation?cheque=${due.body.data.id}`;
    const notifications = await asDemoTenant(() =>
      prisma.notification.findMany({ where: { category: "banking-cheque" } })
    );
    // One notification row per recipient holding banking.view — at least one, and the same
    // count is what "idempotent" is measured against below.
    const forThisChequeBefore = notifications.filter((n) => n.link?.startsWith(link)).length;
    expect(forThisChequeBefore).toBeGreaterThanOrEqual(1);
    // The cheque a month out never triggered a notification.
    expect(notifications.some((n) => n.link?.includes(notDue.body.data.id))).toBe(false);

    // Running the sweep again the same day sends nothing new for the same cheque.
    await chequeDueHandler();
    const again = await asDemoTenant(() =>
      prisma.notification.count({
        where: { category: "banking-cheque", link: { startsWith: link } },
      })
    );
    expect(again).toBe(forThisChequeBefore);

    // Cross-tenant: the second company has no cheques, so its own sweep (run by the same handler,
    // already covered above) sent it nothing, and it cannot see the demo tenant's notification.
    const fromOther = await runAsTenant(OTHER_ID, () =>
      prisma.notification.count({
        where: { category: "banking-cheque", link: { startsWith: link } },
      })
    );
    expect(fromOther).toBe(0);
  });
});

describe("monthly Tally export (tally.job)", () => {
  let OWNER: { auth: Record<string, string> };
  let OTHER_ID: string;

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const other = await otherTenant("Scheduled Work Tally Co");
    OTHER_ID = other.id;
  });

  it("is off by default, skips a tenant that has not opted in, and prepares (never confirms) for one that has", async () => {
    const client = await api();
    const prisma = await getPrisma();

    // Default: off.
    const settings = await client.get("/api/tally/settings").set(OWNER.auth);
    expect(settings.status).toBe(200);
    expect(settings.body.data.autoExportEnabled).toBe(false);

    const { tallyExportSweepHandler } = await import("../../src/jobs/tally.job");
    const beforeOptIn = await tallyExportSweepHandler();
    expect(beforeOptIn.prepared).toBe(0);

    const optIn = await client
      .put("/api/tally/settings")
      .set(OWNER.auth)
      .send({ autoExportEnabled: true });
    expect(optIn.status).toBe(200);
    expect(optIn.body.data.autoExportEnabled).toBe(true);

    const first = await tallyExportSweepHandler();
    expect(first.prepared).toBeGreaterThanOrEqual(1);

    const from = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1));
    const run = await asDemoTenant(() =>
      prisma.tallyExportRun.findFirst({ where: { fromDate: from, incremental: true } })
    );
    expect(run).not.toBeNull();
    expect(run!.status).toBe("DRAFT"); // never auto-confirmed

    // Idempotent: running it again the same month does not create a second run.
    await tallyExportSweepHandler();
    const runCount = await asDemoTenant(() =>
      prisma.tallyExportRun.count({ where: { fromDate: from, incremental: true } })
    );
    expect(runCount).toBe(1);

    // Cross-tenant: the other company never opted in, so it has no run, and cannot see ours.
    const otherRuns = await runAsTenant(OTHER_ID, () => prisma.tallyExportRun.count());
    expect(otherRuns).toBe(0);
    const seenFromOther = await runAsTenant(OTHER_ID, () =>
      prisma.tallyExportRun.findUnique({ where: { id: run!.id } })
    );
    expect(seenFromOther).toBeNull();
  });
});

describe("SMS send queue (sms.job)", () => {
  let OWNER: { auth: Record<string, string> };
  let OTHER_ID: string;
  const MOBILE = "9123456780";

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const other = await otherTenant("Scheduled Work SMS Co");
    OTHER_ID = other.id;

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
          dltTemplateId: `11017000${sfx}${t.code.slice(0, 2)}`.slice(0, 30),
          body: t.body,
          isActive: true,
        });
    }
    await client.put("/api/sms/settings").set(OWNER.auth).send({
      provider: "FIXTURE",
      enabled: true,
      senderId: "SHFTLN",
      principalEntityId: "1101000000000002",
      authKey: "fixture-auth-key-scheduled-work",
      dailyCap: 2000,
    });
  });

  it("delivers a queued message through the same provider interface, exactly once", async () => {
    const { smsService } = await import("../../src/modules/sms/sms.service");
    const { fixtureSmsProvider } = await import("../../src/modules/sms/providers");
    const prisma = await getPrisma();

    const before = fixtureSmsProvider.sent.length;
    const { row } = await asDemoTenant(() =>
      smsService.sendTemplateQueued({
        to: MOBILE,
        templateCode: "PAYMENT_RECEIVED",
        values: { name: "Test Co", amount: 1000, invoiceNo: `SW-${sfx}` },
      })
    );
    // Whichever path delivered it (inline fallback or a real job), it must end up sent.
    const delivered = await asDemoTenant(() => smsService.deliverQueued(row.id));
    expect(delivered.status).toBe("SENT");
    expect(fixtureSmsProvider.sent.length).toBe(before + 1);

    // A second delivery of the same message id — a redelivered job, or this test calling it
    // again — must not send it a second time.
    const again = await asDemoTenant(() => smsService.deliverQueued(row.id));
    expect(again.status).toBe("SENT");
    expect(fixtureSmsProvider.sent.length).toBe(before + 1);

    // The job handler is the same code path; calling it directly with the same id is the same
    // guarantee pg-boss redelivery relies on.
    const { smsSendHandler } = await import("../../src/jobs/sms.job");
    const demoId = (await demoCompany()).id;
    const viaHandler = await smsSendHandler({
      id: randomUUID(),
      name: "comms.sms.send",
      data: { companyId: demoId, messageId: row.id },
    } as never);
    expect(viaHandler.status).toBe("SENT");
    expect(fixtureSmsProvider.sent.length).toBe(before + 1);

    // Cross-tenant: the message row is invisible under another company's own context.
    const seenFromOther = await runAsTenant(OTHER_ID, () =>
      prisma.smsMessage.findUnique({ where: { id: row.id } })
    );
    expect(seenFromOther).toBeNull();
  });

  it("reaches the queue through POST /api/sms/send with queue: true", async () => {
    const client = await api();
    const res = await client
      .post("/api/sms/send")
      .set(OWNER.auth)
      .send({
        to: "9123456781",
        templateCode: "PAYMENT_RECEIVED",
        values: { name: "Queued Co", amount: 500, invoiceNo: `SW-${sfx}-2` },
        queue: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(["QUEUED", "SENT"]).toContain(res.body.data.status);

    // Whatever state the route left it in, the job side can always finish the delivery.
    const { smsService } = await import("../../src/modules/sms/sms.service");
    const finished = await asDemoTenant(() => smsService.deliverQueued(res.body.data.id));
    expect(finished.status).toBe("SENT");
  });

  it("refuses a caller without sms.send", async () => {
    const production = await authed("demo.production");
    const res = await (
      await api()
    )
      .post("/api/sms/send")
      .set(production.auth)
      .send({ to: MOBILE, templateCode: "PAYMENT_RECEIVED", queue: true });
    expect(res.status).toBe(403);
  });
});
