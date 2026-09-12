import type { Gstr2bProvider } from "../gstr2b.types";
import { gstr2bFixtureProvider } from "./fixture.provider";
import { gstr2bGspProvider } from "./gsp.provider";

/**
 * The returns and IMS portal, behind an interface (P1-13c). The provider is the one already
 * chosen for e-invoicing: a GSP login serves every portal API, so a tenant configures its
 * credentials once.
 */
export const providerFor = (name: string): Gstr2bProvider =>
  name === "GSP" ? gstr2bGspProvider : gstr2bFixtureProvider;
