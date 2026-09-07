import type { EInvoiceProvider } from "../e-invoice.types";
import { fixtureProvider } from "./fixture.provider";
import { gspProvider } from "./gsp.provider";

export const PROVIDERS = ["FIXTURE", "GSP"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const providerFor = (name: string): EInvoiceProvider => {
  switch (name) {
    case "GSP":
      return gspProvider;
    case "FIXTURE":
    default:
      return fixtureProvider;
  }
};
