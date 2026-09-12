import { SmsProviderError, type SmsProvider } from "../sms.types";
import { fixtureSmsProvider } from "./fixture.provider";

export { fixtureSmsProvider };

export const SMS_PROVIDERS = ["FIXTURE", "MSG91"] as const;
export type SmsProviderKey = (typeof SMS_PROVIDERS)[number];

/**
 * The live adapter is deliberately absent (P1-22), for the same reason as the payment gateway's:
 * no account was supplied, so there is nothing to certify an adapter against, and a guess at a
 * provider's error codes would look tested without being tested.
 */
const notBuilt = (name: string): SmsProvider =>
  new Proxy({} as SmsProvider, {
    get: (_t, prop) => {
      if (prop === "name") return name;
      return () => {
        throw new SmsProviderError(
          "NO_ADAPTER",
          `The ${name} adapter is not built yet; the SMS account has not been supplied`
        );
      };
    },
  });

export const smsProviderFor = (name: string): SmsProvider => {
  switch (name) {
    case "MSG91":
      return notBuilt("MSG91");
    case "FIXTURE":
    default:
      return fixtureSmsProvider;
  }
};
