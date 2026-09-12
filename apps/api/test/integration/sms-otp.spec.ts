import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";

/**
 * Sending an SMS, and the one-time password (P1-22).
 *
 * The gateway is the fixture, but the refusals are the real ones: an unregistered template, a
 * number that is not a number, a code that has expired or been guessed at too often. What is
 * proved above all is that the code is never returned and never stored in the clear.
 */
const MOBILE = "9876543210";
let OWNER: { auth: Record<string, string> };

const outbox = async () => {
  const { fixtureSmsProvider } = await import("../../src/modules/sms/providers");
  return fixtureSmsProvider;
};

describe("SMS and one-time passwords", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const client = await api();
    // Register the DLT ids on the seeded templates, then turn the account on.
    const templates = await client.get("/api/sms/templates").set(OWNER.auth);
    expect(templates.status).toBe(200);
    for (const t of templates.body.data as { code: string; name: string; body: string }[]) {
      const saved = await client
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
      expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    }
    const settings = await client.put("/api/sms/settings").set(OWNER.auth).send({
      provider: "FIXTURE",
      enabled: true,
      senderId: "SHFTLN",
      principalEntityId: "1101000000000001",
      authKey: "fixture-auth-key",
      dailyCap: 2000,
    });
    expect(settings.status, JSON.stringify(settings.body).slice(0, 300)).toBe(200);
  });

  it("seeds the templates a tenant needs and never returns the auth key", async () => {
    const res = await (await api()).get("/api/sms/settings").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.hasAuthKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("fixture-auth-key");
    expect(res.body.data.senderId).toBe("SHFTLN");

    const prisma = await getPrisma();
    const row = await asDemoTenant(() => prisma.smsConfig.findFirstOrThrow());
    expect(row.authKey?.startsWith("enc:v1:")).toBe(true);
  });

  it("refuses a transactional template with no DLT id", async () => {
    const res = await (await api()).put("/api/sms/templates").set(OWNER.auth).send({
      code: "NO_DLT",
      name: "Unregistered",
      category: "TRANSACTIONAL",
      body: "Hello {{name}}",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_DLT_TEMPLATE");
  });

  it("says what a message will cost before it is sent", async () => {
    const res = await (
      await api()
    )
      .post("/api/sms/preview")
      .set(OWNER.auth)
      .send({
        body: "Dear {{name}}, Rs {{amount}} is due.",
        values: { name: "Anand", amount: 1500 },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe("Dear Anand, Rs 1500 is due.");
    expect(res.body.data.encoding).toBe("GSM7");
    expect(res.body.data.segments).toBe(1);
  });

  it("sends against a template and logs what went out", async () => {
    const box = await outbox();
    const before = box.sent.length;
    const res = await (
      await api()
    )
      .post("/api/sms/send")
      .set(OWNER.auth)
      .send({
        to: "+91 98765 43210",
        templateCode: "PAYMENT_RECEIVED",
        values: { name: "Anand", amount: 1500, invoiceNo: "INV/1" },
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.status).toBe("SENT");
    // The number was normalised before anything was sent to it.
    expect(res.body.data.toMobile).toBe(MOBILE);
    expect(box.sent.length).toBe(before + 1);
    expect(box.sent[box.sent.length - 1].body).toContain("Anand");

    const log = await (await api()).get("/api/sms/messages").query({ to: MOBILE }).set(OWNER.auth);
    expect(log.body.data[0].templateCode).toBe("PAYMENT_RECEIVED");
  });

  it("refuses a missing variable and a number that is not a number", async () => {
    const client = await api();
    const missing = await client
      .post("/api/sms/send")
      .set(OWNER.auth)
      .send({ to: MOBILE, templateCode: "PAYMENT_RECEIVED", values: { name: "Anand" } });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("MISSING_VARIABLE");

    const bad = await client
      .post("/api/sms/send")
      .set(OWNER.auth)
      .send({ to: "1234567890", templateCode: "PAYMENT_RECEIVED", values: {} });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("BAD_MOBILE");
  });

  it("issues a code without ever returning it, and accepts it once", async () => {
    const client = await api();
    const asked = await client
      .post("/api/sms/otp/request")
      .set(OWNER.auth)
      .send({ mobile: MOBILE, purpose: "MOBILE_VERIFY" });
    expect(asked.status, JSON.stringify(asked.body).slice(0, 300)).toBe(201);
    const challengeId = asked.body.data.challengeId as string;
    const body = JSON.stringify(asked.body);
    expect(body).not.toMatch(/"code"/);

    // The code only exists in what the gateway was handed.
    const box = await outbox();
    const sent = box.sent[box.sent.length - 1];
    const code = sent.body.match(/\b(\d{6})\b/)?.[1];
    expect(code).toBeDefined();

    const prisma = await getPrisma();
    const challenge = await asDemoTenant(() =>
      prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } })
    );
    // Stored as a hash, and the message log carries the code masked.
    expect(challenge.codeHash).not.toContain(code!);
    const message = await asDemoTenant(() =>
      prisma.smsMessage.findUniqueOrThrow({ where: { id: challenge.smsMessageId! } })
    );
    expect(message.body).not.toContain(code!);
    expect(message.body).toContain(code!.slice(-2));

    const ok = await client.post("/api/sms/otp/verify").set(OWNER.auth).send({ challengeId, code });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    expect(ok.body.data.mobile).toBe(MOBILE);

    // A code is good once.
    const twice = await client
      .post("/api/sms/otp/verify")
      .set(OWNER.auth)
      .send({ challengeId, code });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("CONSUMED");
  });

  it("counts wrong attempts and stops at the cap", async () => {
    const client = await api();
    const asked = await client
      .post("/api/sms/otp/request")
      .set(OWNER.auth)
      .send({ mobile: "9812345678", purpose: "MOBILE_VERIFY" });
    const challengeId = asked.body.data.challengeId as string;
    const box = await outbox();
    const code = box.sent[box.sent.length - 1].body.match(/\b(\d{6})\b/)![1];
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      const res = await client
        .post("/api/sms/otp/verify")
        .set(OWNER.auth)
        .send({ challengeId, code: wrong });
      expect(res.status).toBe(401);
    }
    // The sixth is refused whatever the code — including the right one.
    const right = await client
      .post("/api/sms/otp/verify")
      .set(OWNER.auth)
      .send({ challengeId, code });
    expect([409, 429]).toContain(right.status);
  });

  it("refuses a fourth code inside the window", async () => {
    const client = await api();
    const mobile = "9811111111";
    for (let i = 0; i < 3; i++) {
      const res = await client
        .post("/api/sms/otp/request")
        .set(OWNER.auth)
        .send({ mobile, purpose: "FIELD_LOGIN" });
      expect(res.status).toBe(201);
    }
    const fourth = await client
      .post("/api/sms/otp/request")
      .set(OWNER.auth)
      .send({ mobile, purpose: "FIELD_LOGIN" });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe("TOO_MANY_REQUESTS");
  });

  it("refuses an expired code even when it is right", async () => {
    const client = await api();
    const asked = await client
      .post("/api/sms/otp/request")
      .set(OWNER.auth)
      .send({ mobile: "9822222222", purpose: "PAYMENT_CONFIRM" });
    const challengeId = asked.body.data.challengeId as string;
    const box = await outbox();
    const code = box.sent[box.sent.length - 1].body.match(/\b(\d{6})\b/)![1];

    const prisma = await getPrisma();
    await asDemoTenant(() =>
      prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
    );
    const res = await client
      .post("/api/sms/otp/verify")
      .set(OWNER.auth)
      .send({ challengeId, code });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("EXPIRED");
  });

  it("refuses a user without the permission and hides another tenant's messages", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/sms/messages").set(production.auth)).status).toBe(403);
    expect((await client.get("/api/sms/settings").set(production.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyName: "SMS Tenant B",
          companyCode: `SMSB-${Date.now().toString(36).slice(-5)}`,
        },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.smsMessage.count())).toBe(0);
    expect(await runAsTenant(other.id, () => prisma.otpChallenge.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.smsMessage.count())).toBeGreaterThan(0);
  });
});
