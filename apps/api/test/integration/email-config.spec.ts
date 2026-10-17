import { beforeEach, describe, expect, it, vi } from "vitest";

// SMTP is replaced so no server is needed; buildSmtpTransportOptions stays real.
vi.mock("../../src/utils/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/mailer")>()),
  sendEmail: vi.fn(),
}));

import { sendEmail } from "../../src/utils/mailer";
import { api, authed } from "../helpers/app";

const sendMock = vi.mocked(sendEmail);
const SMTP_PASSWORD = "Sup3r-Secret-SMTP-pw";
const GENERIC = "Could not send the email. Check the email settings and try again.";
const config = {
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpUsername: "mailer@example.test",
  smtpPassword: SMTP_PASSWORD,
  fromEmail: "noreply@example.test",
  fromName: "Demo Co",
  encryption: "TLS",
};
const mail = { recipientEmail: "to@example.test", subject: "Hello", message: "Body" };

describe("email config", () => {
  beforeEach(() => sendMock.mockReset());

  it("save returns the masked config and never the password or its ciphertext", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (await api()).post("/api/email-config").set(auth).send(config);

    expect(res.status).toBe(200);
    expect(res.body.data.smtpPassword).toBe("********");
    expect(res.body.data.smtpHost).toBe(config.smtpHost);
    expect(res.text).not.toContain(SMTP_PASSWORD);
    expect(res.text).not.toMatch(/aes-256-gcm|enc:/i);

    const got = await (await api()).get("/api/email-config").set(auth);
    expect(got.body.data.smtpPassword).toBe("********");
    expect(got.text).not.toContain(SMTP_PASSWORD);
  });

  it("save rejects a missing SMTP field with a 400", async () => {
    const { auth } = await authed("demo.owner");
    const res = await (
      await api()
    )
      .post("/api/email-config")
      .set(auth)
      .send({ ...config, smtpHost: "" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("All SMTP fields are required");
  });

  it("send returns 200 and rejects a missing field with a 400", async () => {
    const { auth } = await authed("demo.owner");
    sendMock.mockResolvedValueOnce({ messageId: "m-1" } as never);

    const ok = await (await api()).post("/api/email-config/send").set(auth).send(mail);
    expect(ok.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const bad = await (
      await api()
    )
      .post("/api/email-config/send")
      .set(auth)
      .send({ ...mail, subject: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe("Recipient email, subject, and message are required.");
  });

  it("a failed send answers 502 with a generic message and no transport detail", async () => {
    const { auth } = await authed("demo.owner");
    sendMock.mockRejectedValueOnce(
      new Error(`535 5.7.8 Authentication failed for ${config.smtpUsername}`)
    );

    const res = await (await api()).post("/api/email-config/send").set(auth).send(mail);

    expect(res.status).toBe(502);
    expect(res.body.message).toBe(GENERIC);
    expect(res.text).not.toContain("535");
    expect(res.text).not.toContain(config.smtpUsername);
  });

  it("attachment send validates the file and maps multer limits to 4xx", async () => {
    const { auth } = await authed("demo.owner");
    const pdf = Buffer.from("%PDF-1.4 test");

    const none = await (
      await api()
    )
      .post("/api/email-config/send-with-attachment")
      .set(auth)
      .field("recipientEmail", mail.recipientEmail)
      .field("subject", mail.subject)
      .field("message", mail.message);
    expect(none.status).toBe(400);
    expect(none.body.message).toBe("Attachment file is required.");

    const twoFiles = await (
      await api()
    )
      .post("/api/email-config/send-with-attachment")
      .set(auth)
      .field("recipientEmail", mail.recipientEmail)
      .field("subject", mail.subject)
      .field("message", mail.message)
      .attach("file", pdf, "a.pdf")
      .attach("file", pdf, "b.pdf");
    expect(twoFiles.status).toBe(400);

    const tooBig = await (
      await api()
    )
      .post("/api/email-config/send-with-attachment")
      .set(auth)
      .field("recipientEmail", mail.recipientEmail)
      .field("subject", mail.subject)
      .field("message", mail.message)
      .attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), "big.pdf");
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.message).toBe("Attachment is larger than 10 MB.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("attachment send succeeds, and a failure is generic", async () => {
    const { auth } = await authed("demo.owner");
    const pdf = Buffer.from("%PDF-1.4 test");
    const send = async () =>
      (await api())
        .post("/api/email-config/send-with-attachment")
        .set(auth)
        .field("recipientEmail", mail.recipientEmail)
        .field("subject", mail.subject)
        .field("message", mail.message)
        .attach("file", pdf, "a.pdf");

    sendMock.mockResolvedValueOnce({ messageId: "m-2" } as never);
    expect((await send()).status).toBe(200);

    sendMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.5:587"));
    const failed = await send();
    expect(failed.status).toBe(502);
    expect(failed.body.message).toBe(GENERIC);
    expect(failed.text).not.toContain("10.0.0.5");
  });
});
