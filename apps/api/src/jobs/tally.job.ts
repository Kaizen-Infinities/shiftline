import { tallyService } from "../modules/tally/tally.service";

/**
 * Monthly, on the 1st: prepare last month's export for every tenant that opted in
 * (`TallyConfig.autoExportEnabled`, off by default) and tell holders of `tally.view` it is
 * ready. Preparing is safe — it only writes a run row and generates nothing that is stored —
 * and confirming that the accountant received it stays a person's act (P1-06's own gap, closed
 * by P2-01).
 */
export const tallyExportSweepHandler = async () => tallyService.sweepAllTenants();
