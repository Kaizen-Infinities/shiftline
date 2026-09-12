import { GST_STATE_BY_CODE } from "@shiftline/shared";

import { prisma } from "../../config/prisma";
import {
  BILLWISE_GROUPS,
  FALLBACK_GROUP_BY_NATURE,
  TALLY_CUSTOM_GROUP_PARENTS,
  TALLY_RESERVED_GROUPS,
  tallyAmount,
  tallyName,
  type TallyNameLookup,
} from "./tally.names";
import { esc, list, tag, yn } from "./tally.xml";

/**
 * The master records Tally needs before a voucher will import (P1-06).
 *
 * A voucher naming a ledger Tally does not have is rejected, so masters go first and the two
 * files are generated from the same run. Order inside the file matters too: a group must exist
 * before a ledger claims it as a parent, and a unit before a stock item uses it.
 */
export interface MasterCounts {
  groups: number;
  ledgers: number;
  units: number;
  stockItems: number;
}

const groupMessage = (name: string, parent: string): string =>
  `<GROUP NAME="${esc(name)}" ACTION="Create">` +
  list("NAME", [tag("NAME", name)]) +
  tag("PARENT", parent) +
  tag("ISSUBLEDGER", "No") +
  tag("ISADDABLE", "No") +
  `</GROUP>`;

const ledgerMessage = (l: {
  name: string;
  parent: string;
  billwise: boolean;
  openingBalance: number;
  gstin?: string | null;
  gstRegType?: string | null;
  stateName?: string | null;
  address?: string | null;
}): string =>
  `<LEDGER NAME="${esc(l.name)}" ACTION="Create">` +
  list("NAME", [tag("NAME", l.name)]) +
  tag("PARENT", l.parent) +
  tag("ISBILLWISEON", yn(l.billwise)) +
  tag("ISCOSTCENTRESON", "No") +
  (l.gstin ? tag("PARTYGSTIN", l.gstin) : "") +
  (l.gstRegType ? tag("GSTREGISTRATIONTYPE", l.gstRegType) : "") +
  (l.stateName ? tag("LEDSTATENAME", l.stateName) : "") +
  (l.address ? list("ADDRESS", [tag("ADDRESS", l.address)]) : "") +
  // Tally's sign convention: a debit balance is negative, everywhere, masters included.
  (l.openingBalance === 0 ? "" : tag("OPENINGBALANCE", tallyAmount(l.openingBalance))) +
  `</LEDGER>`;

const unitMessage = (name: string): string =>
  `<UNIT NAME="${esc(name)}" ACTION="Create">` +
  list("NAME", [tag("NAME", name)]) +
  tag("ISSIMPLEUNIT", "Yes") +
  tag("DECIMALPLACES", "2") +
  `</UNIT>`;

const stockItemMessage = (i: {
  name: string;
  parent: string;
  baseUnit: string;
  hsn?: string | null;
  gstRate?: number | null;
}): string =>
  `<STOCKITEM NAME="${esc(i.name)}" ACTION="Create">` +
  list("NAME", [tag("NAME", i.name)]) +
  tag("PARENT", i.parent) +
  tag("BASEUNITS", i.baseUnit) +
  (i.hsn ? tag("HSNCODE", i.hsn) : "") +
  (i.gstRate === null || i.gstRate === undefined ? "" : tag("GSTRATE", String(i.gstRate))) +
  `</STOCKITEM>`;

/**
 * Every master, in import order.
 *
 * Reserved groups are deliberately absent: Tally has them already, and creating one under our
 * spelling makes a duplicate that silently splits the balance sheet in two.
 */
export const buildMasters = async (
  lookup: TallyNameLookup
): Promise<{ messages: string[]; counts: MasterCounts }> => {
  const messages: string[] = [];
  const counts: MasterCounts = { groups: 0, ledgers: 0, units: 0, stockItems: 0 };

  const groups = await prisma.ledgerGroup.findMany({
    where: { isActive: true },
    orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
  });
  const groupById = new Map(groups.map((g) => [g.id, g]));

  /** What a group of ours is called in Tally, and what it sits under. */
  const resolveGroup = (code: string): { name: string; parent: string; reserved: boolean } => {
    const over = lookup.override("GROUP", code);
    const reserved = TALLY_RESERVED_GROUPS[code];
    const group = groups.find((g) => g.code === code);
    const parentCode = group?.parentId ? groupById.get(group.parentId)?.code : undefined;
    const defaultParent =
      TALLY_CUSTOM_GROUP_PARENTS[code] ??
      (parentCode ? resolveGroupName(parentCode) : undefined) ??
      (group ? FALLBACK_GROUP_BY_NATURE[group.nature] : "Suspense A/c");
    return {
      name: tallyName(over.tallyName ?? reserved ?? group?.name ?? code),
      parent: tallyName(over.tallyParent ?? defaultParent),
      // An override that renames a reserved group still points at something Tally has.
      reserved: Boolean(reserved) && !over.tallyName,
    };
  };
  function resolveGroupName(code: string): string {
    const over = lookup.override("GROUP", code);
    return tallyName(
      over.tallyName ??
        TALLY_RESERVED_GROUPS[code] ??
        groups.find((g) => g.code === code)?.name ??
        code
    );
  }

  for (const g of groups) {
    const resolved = resolveGroup(g.code);
    if (resolved.reserved || !lookup.override("GROUP", g.code).isExported) continue;
    messages.push(groupMessage(resolved.name, resolved.parent));
    counts.groups++;
  }

  const ledgers = await prisma.accountLedger.findMany({
    where: { isActive: true },
    include: {
      ledgerGroup: true,
      customer: {
        select: {
          gstin: true,
          gstRegType: true,
          stateCode: true,
          openingBalance: true,
          openingBalanceType: true,
        },
      },
      supplier: {
        select: {
          gstin: true,
          gstRegType: true,
          stateCode: true,
          openingBalance: true,
          openingBalanceType: true,
        },
      },
    },
    orderBy: { code: "asc" },
  });

  for (const l of ledgers) {
    const over = lookup.override("LEDGER", l.code);
    if (!over.isExported) continue;
    const groupCode = l.ledgerGroup?.code;
    const parent =
      over.tallyParent ??
      (groupCode ? resolveGroup(groupCode).name : FALLBACK_GROUP_BY_NATURE[l.type]);
    const party = l.customer ?? l.supplier;
    // Debit is negative in Tally, so a customer's opening debit and a supplier's opening
    // credit end up on opposite sides of zero without anyone deciding it here.
    const opening = party
      ? Number(party.openingBalance) * (party.openingBalanceType === "DEBIT" ? -1 : 1)
      : 0;
    messages.push(
      ledgerMessage({
        name: tallyName(over.tallyName ?? l.name),
        parent: tallyName(parent),
        billwise: groupCode ? BILLWISE_GROUPS.has(groupCode) : false,
        openingBalance: opening,
        gstin: party?.gstin ?? null,
        gstRegType: party ? gstRegLabel(party.gstRegType) : null,
        stateName: party?.stateCode ? (GST_STATE_BY_CODE.get(party.stateCode)?.name ?? null) : null,
      })
    );
    counts.ledgers++;
  }

  const units = await prisma.unitOfMeasure.findMany({
    where: { isActive: true },
    orderBy: { uomCode: "asc" },
  });
  const unitNames = new Map<string, string>();
  for (const u of units) {
    const over = lookup.override("UNIT", u.uomCode);
    if (!over.isExported) continue;
    const name = tallyName(over.tallyName ?? u.uomCode);
    unitNames.set(u.uomCode, name);
    messages.push(unitMessage(name));
    counts.units++;
  }
  /** A stock item's unit has to exist; one that was never a UOM row is created on the way past. */
  const ensureUnit = (raw: string | null | undefined): string => {
    const code = (raw ?? "Nos").trim() || "Nos";
    const known = unitNames.get(code);
    if (known) return known;
    const name = tallyName(code);
    unitNames.set(code, name);
    messages.push(unitMessage(name));
    counts.units++;
    return name;
  };

  const materials = await prisma.rawMaterial.findMany({
    where: { isActive: true },
    include: { hsnCode: { select: { code: true } }, category: { select: { name: true } } },
    orderBy: { rawMaterialId: "asc" },
  });
  for (const m of materials) {
    const over = lookup.override("STOCK_ITEM", m.rawMaterialId);
    if (!over.isExported) continue;
    messages.push(
      stockItemMessage({
        name: tallyName(over.tallyName ?? m.materialName),
        parent: tallyName(over.tallyParent ?? m.category?.name ?? "Primary"),
        baseUnit: ensureUnit(m.baseUom),
        hsn: m.hsnCode?.code ?? null,
        gstRate: m.gstRate === null ? null : Number(m.gstRate),
      })
    );
    counts.stockItems++;
  }

  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: {
      hsnCode: { select: { code: true } },
      category: { select: { name: true } },
      uom: { select: { uomCode: true } },
    },
    orderBy: { productCode: "asc" },
  });
  for (const p of products) {
    const over = lookup.override("STOCK_ITEM", p.productCode);
    if (!over.isExported) continue;
    messages.push(
      stockItemMessage({
        name: tallyName(over.tallyName ?? p.productName),
        parent: tallyName(over.tallyParent ?? p.category?.name ?? "Primary"),
        baseUnit: ensureUnit(p.uom?.uomCode),
        hsn: p.hsnCode?.code ?? null,
        gstRate: p.gstRate === null ? null : Number(p.gstRate),
      })
    );
    counts.stockItems++;
  }

  return { messages, counts };
};

/** Tally spells the registration types out; ours are enum names. */
const gstRegLabel = (t: string | null | undefined): string | null => {
  const map: Record<string, string> = {
    REGULAR: "Regular",
    COMPOSITION: "Composition",
    UNREGISTERED: "Unregistered",
    SEZ: "Regular",
    OVERSEAS: "Unknown",
    UIN: "Regular",
  };
  return t ? (map[t] ?? "Unknown") : null;
};
