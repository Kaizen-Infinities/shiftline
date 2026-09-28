import { ApiError } from "../../../utils/ApiError";
import type { AsnExportProvider } from "./types";

/**
 * Documented TODO adapters. Each OEM portal and EDI standard below has its own upload layout
 * that the supplier receives in the OEM's onboarding kit (or buys from the standards body); we
 * do not guess at those layouts. Until a customer shares the real template, the adapter is
 * listed as unavailable and `render` refuses with 501 so nobody uploads a made-up file.
 *
 * To build one: add a `<key>.provider.ts` next to `generic-csv.provider.ts` that maps
 * `AsnExportDoc` onto the template's columns, add a fixture test against a sample file from
 * the OEM, and swap the entry here for it in `providers/index.ts`.
 */
const todo = (key: string, label: string, note: string): AsnExportProvider => ({
  key,
  label,
  available: false,
  note,
  render: () => {
    throw new ApiError(
      501,
      `${label} export is not available yet; use Generic CSV and map the columns in the portal`,
      "ASN_FORMAT_NOT_AVAILABLE"
    );
  },
});

const KIT = "needs the portal's ASN upload template from the supplier onboarding kit";

export const TODO_PROVIDERS: AsnExportProvider[] = [
  todo("EDIFACT_DESADV", "EDIFACT DESADV (EDI)", "needs the OEM's DESADV message guideline"),
  todo("ANSI_X12_856", "ANSI X12 856 (EDI)", "needs the OEM's 856 implementation guide"),
  todo("HYUNDAI_PORTAL", "Hyundai supplier portal", KIT),
  todo("ASHOK_LEYLAND_PORTAL", "Ashok Leyland supplier portal", KIT),
  todo("TVS_MOTOR_PORTAL", "TVS Motor supplier portal", KIT),
  todo("ROYAL_ENFIELD_PORTAL", "Royal Enfield supplier portal", KIT),
  todo("RENAULT_NISSAN_PORTAL", "Renault Nissan supplier portal", KIT),
  todo("DAIMLER_INDIA_PORTAL", "Daimler India CV supplier portal", KIT),
];
