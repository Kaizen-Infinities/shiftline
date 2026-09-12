import { describe, expect, it } from "vitest";

import { FixturePaymentProvider } from "../../src/modules/payments/providers/fixture.provider";
import { signBody, signatureMatches } from "../../src/modules/payments/providers/signature";
import { paymentProviderFor } from "../../src/modules/payments/providers";
import { PaymentProviderError } from "../../src/modules/payments/payments.types";

const creds = { keyId: "k", keySecret: "s", webhookSecret: "whsec" };

describe("callback signatures", () => {
  it("accepts what it signed and nothing else", () => {
    const body = JSON.stringify({ event: "payment_link.paid" });
    expect(signatureMatches(body, signBody(body, "whsec"), "whsec")).toBe(true);
    expect(signatureMatches(body, signBody(body, "other"), "whsec")).toBe(false);
    // A body changed by one character is a different body.
    expect(signatureMatches(`${body} `, signBody(body, "whsec"), "whsec")).toBe(false);
  });

  it("refuses a missing signature or a missing secret rather than passing them", () => {
    const body = "{}";
    expect(signatureMatches(body, null, "whsec")).toBe(false);
    expect(signatureMatches(body, signBody(body, "whsec"), null)).toBe(false);
    // A signature of the wrong length must not throw; it is simply wrong.
    expect(signatureMatches(body, "abc", "whsec")).toBe(false);
  });
});

describe("the fixture gateway", () => {
  it("keeps its own idea of what has been paid and signs what it sends", async () => {
    const gateway = new FixturePaymentProvider();
    const link = await gateway.createLink(
      {
        reference: "T-1",
        amount: 1000,
        currency: "INR",
        description: "Test",
        expiresAt: null,
        customer: { name: null, email: null, phone: null },
      },
      creds
    );
    const first = gateway.simulatePayment(link.providerLinkId, 400, creds);
    expect(gateway.verifySignature(first.body, first.signature, creds)).toBe(true);
    // Two per cent, and eighteen per cent GST on the two per cent.
    expect(first.payment.fee).toBe(8);
    expect(first.payment.feeTax).toBe(1.44);

    const state = await gateway.fetchLink(link.providerLinkId, creds);
    expect(state.status).toBe("PARTIALLY_PAID");
    expect(state.amountPaid).toBe(400);

    gateway.simulatePayment(link.providerLinkId, 600, creds);
    expect((await gateway.fetchLink(link.providerLinkId, creds)).status).toBe("PAID");
    // A third payment has nothing left to pay.
    expect(() => gateway.simulatePayment(link.providerLinkId, 100, creds)).toThrow(
      PaymentProviderError
    );
  });

  it("never pays more than the link is for", async () => {
    const gateway = new FixturePaymentProvider();
    const link = await gateway.createLink(
      {
        reference: "T-2",
        amount: 500,
        currency: "INR",
        description: "Test",
        expiresAt: null,
        customer: { name: null, email: null, phone: null },
      },
      creds
    );
    const paid = gateway.simulatePayment(link.providerLinkId, 5000, creds);
    expect(paid.payment.amount).toBe(500);
  });

  it("will not cancel a link that has been paid", async () => {
    const gateway = new FixturePaymentProvider();
    const link = await gateway.createLink(
      {
        reference: "T-3",
        amount: 100,
        currency: "INR",
        description: "Test",
        expiresAt: null,
        customer: { name: null, email: null, phone: null },
      },
      creds
    );
    gateway.simulatePayment(link.providerLinkId, 100, creds);
    await expect(gateway.cancelLink(link.providerLinkId, creds)).rejects.toThrow(
      PaymentProviderError
    );
  });

  it("reads a callback body into the shape the service acts on", () => {
    const gateway = new FixturePaymentProvider();
    const envelope = gateway.parseWebhook({
      event_id: "evt_1",
      event: "payment_link.paid",
      payment_link_id: "plink_1",
      payment: { id: "pay_1", amount: 250, fee: 5, fee_tax: 0.9, method: "upi" },
    });
    expect(envelope?.payment?.providerPaymentId).toBe("pay_1");
    expect(envelope?.payment?.status).toBe("CAPTURED");
    // Anything it does not recognise is left alone rather than guessed at.
    expect(gateway.parseWebhook({ event: "payment_link.paid" })).toBeNull();
    expect(gateway.parseWebhook({ event_id: "e", event: "refund.created" })).toBeNull();
  });
});

describe("the provider registry", () => {
  it("refuses the live adapter rather than pretending to have one", () => {
    const razorpay = paymentProviderFor("RAZORPAY");
    expect(razorpay.name).toBe("RAZORPAY");
    // It refuses loudly at the call, so nothing downstream mistakes silence for success.
    expect(() =>
      razorpay.createLink(
        {
          reference: "x",
          amount: 1,
          currency: "INR",
          description: "",
          expiresAt: null,
          customer: { name: null, email: null, phone: null },
        },
        creds
      )
    ).toThrow(/not built yet/);
    expect(() => razorpay.parseWebhook({})).toThrow(PaymentProviderError);
  });

  it("falls back to the fixture for anything it does not know", () => {
    expect(paymentProviderFor("SOMETHING-ELSE").name).toBe("FIXTURE");
  });
});
