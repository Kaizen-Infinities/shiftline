import { bankingService } from "../modules/banking/banking.service";

/**
 * Daily: nudge holders of `banking.view` before a post-dated cheque — received or issued —
 * comes due, the same shape as the MSME day-30/day-43 alert. The register lists cheques due;
 * nothing warned about them until this (P1-20's own gap, closed by P2-01).
 */
export const chequeDueHandler = async () => bankingService.sweepDueCheques();
