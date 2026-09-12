import { PaymentProviderError, type PaymentProvider } from "../payments.types";
import { fixturePaymentProvider } from "./fixture.provider";

export { fixturePaymentProvider };

export const PAYMENT_PROVIDERS = ["FIXTURE", "RAZORPAY"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/**
 * The live adapter is deliberately absent (P1-21). Nobody has supplied a gateway account, so
 * there is nothing to certify an adapter against, and a guess at a gateway's error codes is
 * worse than an empty seam: it would look tested. One file goes here when the keys arrive; the
 * rest of the module does not change.
 */
const notBuilt = (name: string): PaymentProvider =>
  new Proxy({} as PaymentProvider, {
    get: (_t, prop) => {
      if (prop === "name") return name;
      return () => {
        throw new PaymentProviderError(
          "NO_ADAPTER",
          `The ${name} adapter is not built yet; the gateway account has not been supplied`
        );
      };
    },
  });

export const paymentProviderFor = (name: string): PaymentProvider => {
  switch (name) {
    case "RAZORPAY":
      return notBuilt("RAZORPAY");
    case "FIXTURE":
    default:
      return fixturePaymentProvider;
  }
};
