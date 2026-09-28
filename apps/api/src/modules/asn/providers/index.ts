import { ApiError } from "../../../utils/ApiError";
import { genericCsvProvider } from "./generic-csv.provider";
import { TODO_PROVIDERS } from "./todo.providers";
import type { AsnExportProvider } from "./types";

/**
 * ASN export adapters (TN-07), provider-style like `e-invoice/providers`. Only GENERIC_CSV is
 * built: the repo has no spreadsheet library, so there is no GENERIC_XLSX (a CSV opens in Excel
 * as-is). OEM-specific layouts are listed as documented TODO adapters.
 */
export const EXPORT_PROVIDERS: AsnExportProvider[] = [genericCsvProvider, ...TODO_PROVIDERS];

export const exportProviderFor = (key: string): AsnExportProvider => {
  const provider = EXPORT_PROVIDERS.find((p) => p.key === key);
  if (!provider) throw new ApiError(400, "Unknown export format", "ASN_FORMAT_UNKNOWN");
  return provider;
};

export type { AsnExportDoc, AsnExportFile, AsnExportProvider } from "./types";
