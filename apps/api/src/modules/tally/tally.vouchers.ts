import { prisma } from "../../config/prisma";
import {
  CASH_BANK_GROUPS,
  TALLY_VOUCHER_TYPES,
  tallyAmount,
  tallyDate,
  tallyName,
  type TallyNameLookup,
} from "./tally.names";
import { esc, list, tag, yn } from "./tally.xml";

/**
 * Vouchers as Tally wants them (P1-06).
 *
 * Two of Tally's rules shape everything here. Its sign convention is that a **debit is
 * negative** and a credit positive, with `ISDEEMEDPOSITIVE` saying which side the entry is on;
 * get it backwards and the import succeeds with every entry reversed. And its **Journal voucher
 * refuses cash and bank ledgers** unless the company has turned that on, so an expense paid in
 * cash cannot go across as a Journal — it has to be the Payment it actually is.
 */
export interface VoucherCounts {
  vouchers: number;
  cancelled: number;
  entries: number;
}

export interface VoucherWindow {
  from: Date;
  to: Date;
  /** Incremental runs only carry what has been touched since the last confirmed one. */
  sinceAt?: Date | null;
}

interface LedgerRef {
  code: string;
  name: string;
  groupCode: string | null;
}

const entry = (name: string, signed: number): string =>
  list("ALLLEDGERENTRIES", [
    tag("LEDGERNAME", name),
    // Negative is a debit in Tally; ISDEEMEDPOSITIVE repeats it because the parser reads both.
    tag("ISDEEMEDPOSITIVE", yn(signed < 0)),
    tag("AMOUNT", tallyAmount(signed)),
  ]);

/**
 * The voucher type Tally will accept.
 *
 * A journal or expense that moves cash or bank money becomes a Payment or a Receipt — whichever
 * way the money went — because Tally will not take it as a Journal. Everything else maps
 * straight across, with our returns becoming Tally's notes.
 */
export const tallyVoucherType = (
  type: string,
  lines: { ledger: LedgerRef; signed: number }[]
): string => {
  const base = TALLY_VOUCHER_TYPES[type] ?? "Journal";
  if (base !== "Journal") return base;
  const money = lines.filter((l) => l.ledger.groupCode && CASH_BANK_GROUPS.has(l.ledger.groupCode));
  if (money.length === 0) return "Journal";
  // Money out of the bank is a credit there, which is positive in Tally's signs.
  const net = money.reduce((s, l) => s + l.signed, 0);
  return net > 0 ? "Payment" : "Receipt";
};

/** The party a sales or purchase voucher is against; Tally shows it at the head of the voucher. */
const partyOf = (type: string, lines: { ledger: LedgerRef; signed: number }[]): string | null => {
  const want =
    type === "SALES" || type === "SALES_RETURN"
      ? "SUNDRY_DEBTORS"
      : type === "PURCHASE" || type === "PURCHASE_RETURN"
        ? "SUNDRY_CREDITORS"
        : null;
  if (!want) return null;
  return lines.find((l) => l.ledger.groupCode === want)?.ledger.name ?? null;
};

export const buildVouchers = async (
  window: VoucherWindow,
  lookup: TallyNameLookup,
  companyId: string
): Promise<{ messages: string[]; counts: VoucherCounts; throughAt: Date | null }> => {
  const rows = await prisma.voucher.findMany({
    where: {
      date: { gte: window.from, lte: window.to },
      ...(window.sinceAt ? { updatedAt: { gt: window.sinceAt } } : {}),
    },
    include: {
      items: {
        include: {
          debitLedger: {
            select: { code: true, name: true, ledgerGroup: { select: { code: true } } },
          },
          creditLedger: {
            select: { code: true, name: true, ledgerGroup: { select: { code: true } } },
          },
        },
      },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  /**
   * A cancellation in our books is the original left on file plus a REVERSAL voucher that nets
   * it. Tally does it the other way round: the voucher is marked cancelled and keeps only its
   * number. So the reversal is dropped and the original is sent as cancelled — and when the
   * reversal falls in this window but the original does not, the original is fetched anyway, so
   * that the cancellation actually reaches Tally instead of being lost at the window edge.
   */
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reversals = rows.filter((r) => r.reversalOfId !== null);
  const missingOriginals = reversals
    .map((r) => r.reversalOfId as number)
    .filter((id) => !byId.has(id));
  const extras = missingOriginals.length
    ? await prisma.voucher.findMany({
        where: { id: { in: missingOriginals } },
        include: {
          items: {
            include: {
              debitLedger: {
                select: { code: true, name: true, ledgerGroup: { select: { code: true } } },
              },
              creditLedger: {
                select: { code: true, name: true, ledgerGroup: { select: { code: true } } },
              },
            },
          },
        },
      })
    : [];

  const emit = [...rows.filter((r) => r.reversalOfId === null), ...extras].sort((a, b) =>
    a.date.getTime() === b.date.getTime() ? a.id - b.id : a.date.getTime() - b.date.getTime()
  );

  const messages: string[] = [];
  const counts: VoucherCounts = { vouchers: 0, cancelled: 0, entries: 0 };
  let throughAt: Date | null = null;
  for (const r of rows) {
    if (!throughAt || r.updatedAt > throughAt) throughAt = r.updatedAt;
  }

  for (const v of emit) {
    // One line per ledger, netted, which is how Tally stores it anyway.
    const net = new Map<string, { ledger: LedgerRef; signed: number }>();
    const add = (
      ref: { code: string; name: string; ledgerGroup: { code: string } | null } | null,
      signed: number
    ) => {
      if (!ref || signed === 0) return;
      const over = lookup.override("LEDGER", ref.code);
      if (!over.isExported) return;
      const ledger: LedgerRef = {
        code: ref.code,
        name: tallyName(over.tallyName ?? ref.name),
        groupCode: ref.ledgerGroup?.code ?? null,
      };
      const cur = net.get(ledger.name) ?? { ledger, signed: 0 };
      cur.signed += signed;
      net.set(ledger.name, cur);
    };
    for (const item of v.items) {
      add(item.debitLedger, -Number(item.debitAmount));
      add(item.creditLedger, Number(item.creditAmount));
    }
    const lines = [...net.values()].filter((l) => Math.abs(l.signed) >= 0.005);

    const cancelled = v.status === "CANCELLED";
    const typeOverride = lookup.override("VOUCHER_TYPE", v.type);
    const vchType = tallyName(typeOverride.tallyName ?? tallyVoucherType(v.type, lines));
    const party = partyOf(v.type, lines);

    messages.push(
      `<VOUCHER REMOTEID="${esc(`${companyId}-${v.id}`)}" VCHTYPE="${esc(vchType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
        tag("DATE", tallyDate(v.date)) +
        tag("EFFECTIVEDATE", tallyDate(v.date)) +
        tag("VOUCHERTYPENAME", vchType) +
        tag("VOUCHERNUMBER", v.voucherNo) +
        (party ? tag("PARTYLEDGERNAME", party) : "") +
        tag("NARRATION", v.narration ?? "") +
        tag("PERSISTEDVIEW", "Accounting Voucher View") +
        tag("ISCANCELLED", yn(cancelled)) +
        // A cancelled voucher in Tally keeps its number and nothing else; sending the entries
        // as well would leave the books short by the amount the reversal already took out.
        (cancelled ? "" : lines.map((l) => entry(l.ledger.name, l.signed)).join("")) +
        `</VOUCHER>`
    );
    counts.vouchers++;
    if (cancelled) counts.cancelled++;
    else counts.entries += lines.length;
  }

  return { messages, counts, throughAt };
};
