import { assetService } from "../modules/assets/asset.service";

/**
 * Monthly, on the 1st: prepare last month's depreciation for every tenant. Preparing is safe —
 * it writes the charge rows and nothing else — and posting stays a person's act, because that
 * is when the books move (P1-18).
 */
export const depreciationRunHandler = async () => assetService.sweepAllTenants();
