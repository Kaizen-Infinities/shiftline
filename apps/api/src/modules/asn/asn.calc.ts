/**
 * Pure helpers for OEM ASNs (TN-07): splitting a line into standard packs, the label list with
 * one QR payload per pack, and allocating an invoiced quantity to open schedule lines. Quantities
 * carry 3 decimals (Decimal(14,3)), so the arithmetic runs on integer thousandths to avoid
 * floating-point drift (0.1 + 0.2).
 */
const SCALE = 1000;
const toMilli = (v: number) => Math.round(v * SCALE);
const fromMilli = (v: number) => v / SCALE;

/** Largest number of labels one ASN may print; a sheet beyond this is a data-entry error. */
export const MAX_LABELS = 2000;

/** Number of packs a quantity fills: full packs plus one for any remainder. */
export const packsFor = (qty: number, packQty: number): number => {
  const q = toMilli(qty);
  const p = toMilli(packQty);
  if (q <= 0 || p <= 0) return 0;
  return Math.ceil(q / p);
};

/** The quantity in each pack: full standard packs, then the part pack (if any) last. */
export const splitPacks = (qty: number, packQty: number): number[] => {
  const q = toMilli(qty);
  const p = toMilli(packQty);
  if (q <= 0 || p <= 0) return [];
  const full = Math.floor(q / p);
  const rest = q - full * p;
  const out: number[] = Array.from({ length: full }, () => fromMilli(p));
  if (rest > 0) out.push(fromMilli(rest));
  return out;
};

/** What each pack's QR code encodes: `asnNo|partNo|qty|packSeq`, pipes stripped from values. */
export const qrPayload = (asnNo: string, partNo: string, qty: number, packSeq: number): string =>
  [asnNo, partNo, String(qty), String(packSeq)].map((v) => v.replace(/\|/g, "/")).join("|");

export interface LabelLineInput {
  seq: number;
  customerPartNo: string;
  description: string | null;
  qty: number;
  packQty: number;
}

export interface PackLabel {
  /** 1-based and running across the whole ASN, so (asnNo, packSeq) names one pack. */
  packSeq: number;
  totalPacks: number;
  lineSeq: number;
  /** 1-based pack number within its line and the line's pack count ("pack 2 of 3"). */
  linePack: number;
  linePacks: number;
  customerPartNo: string;
  description: string | null;
  qty: number;
  qr: string;
}

/** One label per pack, in line order. */
export const buildLabels = (asnNo: string, lines: LabelLineInput[]): PackLabel[] => {
  const perLine = [...lines]
    .sort((a, b) => a.seq - b.seq)
    .map((l) => ({ l, packs: splitPacks(l.qty, l.packQty) }));
  const totalPacks = perLine.reduce((s, x) => s + x.packs.length, 0);
  const out: PackLabel[] = [];
  for (const { l, packs } of perLine) {
    packs.forEach((qty, i) => {
      const packSeq = out.length + 1;
      out.push({
        packSeq,
        totalPacks,
        lineSeq: l.seq,
        linePack: i + 1,
        linePacks: packs.length,
        customerPartNo: l.customerPartNo,
        description: l.description,
        qty,
        qr: qrPayload(asnNo, l.customerPartNo, qty, packSeq),
      });
    });
  }
  return out;
};

export interface OpenScheduleLine {
  id: string;
  remaining: number;
}

export interface Allocation {
  scheduleLineId: string | null;
  qty: number;
}

/**
 * Splits an invoiced quantity across open schedule lines, earliest first (the caller orders
 * them), each up to its remaining quantity. Whatever is left over is returned unlinked, so an
 * over-shipment is visible rather than silently booked against a line.
 */
export const allocateToSchedule = (qty: number, open: OpenScheduleLine[]): Allocation[] => {
  let left = toMilli(qty);
  const out: Allocation[] = [];
  for (const line of open) {
    if (left <= 0) break;
    const room = toMilli(line.remaining);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    out.push({ scheduleLineId: line.id, qty: fromMilli(take) });
    left -= take;
  }
  if (left > 0) out.push({ scheduleLineId: null, qty: fromMilli(left) });
  return out;
};

/** "tn 09 ab-1234" → "TN09AB1234"; the regex in validation checks the result. */
export const normaliseVehicleNo = (v: string): string => v.replace(/[\s-]/g, "").toUpperCase();

/** Allowed status moves; CANCELLED and ACKNOWLEDGED are final. */
export const ASN_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: [],
  CANCELLED: [],
};

export const canTransition = (from: string, to: string): boolean =>
  (ASN_TRANSITIONS[from] ?? []).includes(to);
