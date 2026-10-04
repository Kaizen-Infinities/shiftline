import { LedgerType, type Prisma } from "@prisma/client";

/**
 * Which ledgers are "bank or cash". One definition for the dashboard tiles, the dashboard alert
 * and the bank-accounts list, so they cannot disagree about which accounts count (R-05).
 *
 * The ledger-group tree decides; the legacy `group` name only catches ledgers never attached to
 * the tree (P1-10d).
 */
export const BANK_CASH_GROUP_NAMES = [
  "Cash & Bank",
  "Bank Accounts",
  "Cash in Hand",
  "BANK ACCOUNTS",
  "CASH IN HAND",
];

export const bankCashLedgerWhere: Prisma.AccountLedgerWhereInput = {
  type: LedgerType.ASSET,
  isActive: true,
  OR: [
    { ledgerGroup: { code: { in: ["CASH_IN_HAND", "BANK_ACCOUNTS"] } } },
    { groupId: null, group: { in: BANK_CASH_GROUP_NAMES, mode: "insensitive" } },
  ],
};

/** Cash (till, petty cash) as opposed to a bank account. */
export const isCashLedger = (l: {
  group: string | null;
  name: string | null;
  ledgerGroup?: { code: string } | null;
}): boolean => {
  if (l.ledgerGroup?.code === "CASH_IN_HAND") return true;
  if (l.ledgerGroup?.code === "BANK_ACCOUNTS") return false;
  const g = (l.group || "").toLowerCase().trim();
  if (g === "cash in hand" || g === "cash") return true;
  // Legacy "Cash & Bank" group: the name decides.
  if (g === "cash & bank") {
    const n = (l.name || "").toLowerCase();
    return n.includes("cash") && !n.includes("bank");
  }
  return false;
};

/** Debit-normal balance of an asset ledger: positive is money held, negative is overdrawn. */
export const assetBalance = (debit: number, credit: number): number => debit - credit;
