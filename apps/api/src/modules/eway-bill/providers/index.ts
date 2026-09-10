import type { EwayBillProvider } from "../eway-bill.types";
import { ewbFixtureProvider } from "./fixture.provider";
import { ewbGspProvider } from "./gsp.provider";

export const ewbProviderFor = (name: string): EwayBillProvider =>
  name === "GSP" ? ewbGspProvider : ewbFixtureProvider;
