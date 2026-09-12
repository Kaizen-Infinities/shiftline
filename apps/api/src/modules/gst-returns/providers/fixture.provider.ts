import { createHash } from "node:crypto";

import { prisma } from "../../../config/prisma";
import { monthRange } from "../gst-period";
import {
  Gstr2bProviderError,
  type Gstr2bCredentials,
  type Gstr2bJson,
  type Gstr2bProvider,
  type ImsPushItem,
  type ImsPushResult,
} from "../gstr2b.types";

/**
 * A 2B without the portal: the tenant's own purchase register of the month, filed back as if
 * the suppliers had filed it, with the kinds of difference a real 2B has.
 *
 * A fixture that agreed with the books perfectly would exercise nothing — the whole package
 * exists for the disagreements — so it is deliberately imperfect, and deterministically so:
 * the hash of a bill's own number decides what happens to it, which means the same books
 * always produce the same 2B and a test can assert exact figures.
 *
 * - roughly one bill in five is filed with the taxable value short by ₹100 (a mismatch),
 * - roughly one in seven is not filed at all (missing in 2B),
 * - one invented record per period was filed against the company and never recorded
 *   (missing in books),
 * - everything else agrees.
 */
const dmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

/** A stable 0–99 for a document number, so the same bill always meets the same fate. */
const dial = (seed: string) =>
  parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 4), 16) % 100;

export class Gstr2bFixtureProvider implements Gstr2bProvider {
  readonly name = "FIXTURE";
  private readonly pushes = new Map<string, ImsPushResult>();

  async fetch2b(periodKey: string, creds: Gstr2bCredentials): Promise<Gstr2bJson> {
    if (!creds.gstin) throw new Gstr2bProviderError("NO_GSTIN", "No GSTIN to draw a 2B for");
    const period = monthRange(periodKey);
    const grns = await prisma.grnInvoice.findMany({
      where: {
        grnDate: { gte: period.from, lt: period.to },
        cancelledAt: null,
        supplierGstin: { not: null },
      },
      include: { items: true, supplier: { select: { legalName: true } } },
      orderBy: { grnNumber: "asc" },
    });

    const bySupplier = new Map<string, { trdnm: string; inv: Record<string, unknown>[] }>();
    for (const g of grns) {
      const docNo = g.invoiceNo || g.grnNumber;
      const fate = dial(`${periodKey}:${docNo}`);
      if (fate % 7 === 0) continue; // the supplier never filed it
      const short = fate % 5 === 0 ? 100 : 0; // filed, but for less than the bill says
      const gstin = g.supplierGstin as string;
      const block =
        bySupplier.get(gstin) ??
        bySupplier.set(gstin, { trdnm: g.supplier?.legalName ?? "Supplier", inv: [] }).get(gstin)!;
      const taxable = n2(g.items.reduce((s, i) => s + Number(i.taxableAmount), 0) - short);
      const rate = Number(g.items[0]?.tax ?? 18);
      block.inv.push({
        inum: docNo,
        typ: "R",
        dt: dmy(g.supplierInvoiceDate ?? g.grnDate),
        val: n2(Number(g.netAmount) - short),
        pos: g.placeOfSupply ?? creds.gstin.slice(0, 2),
        rev: g.reverseCharge ? "Y" : "N",
        itcavl: "Y",
        items: [
          {
            num: 1,
            rt: rate,
            txval: taxable,
            igst: n2(g.totalIgst),
            cgst: n2(g.totalCgst),
            sgst: n2(g.totalSgst),
            cess: n2(g.totalCess),
          },
        ],
      });
    }

    // One record the company never wrote down, so the reconciliation always has a
    // MISSING_IN_BOOKS case to show: the supplier filed against this GSTIN and nobody noticed.
    const ghostGstin = `${creds.gstin.slice(0, 2)}AAGCF7327D1ZL`;
    bySupplier.set(ghostGstin, {
      trdnm: "Unrecorded Supplies Pvt Ltd",
      inv: [
        {
          inum: `GHOST/${period.fp}`,
          typ: "R",
          dt: dmy(new Date(period.from.getTime() + 10 * 86400000)),
          val: 5900,
          pos: creds.gstin.slice(0, 2),
          rev: "N",
          itcavl: "Y",
          items: [{ num: 1, rt: 18, txval: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 }],
        },
      ],
    });

    return {
      data: {
        gstin: creds.gstin,
        rtnprd: period.fp,
        docdata: {
          b2b: [...bySupplier.entries()].map(([ctin, b]) => ({
            ctin,
            trdnm: b.trdnm,
            supprd: period.fp,
            supfildt: dmy(new Date(period.to.getTime() + 10 * 86400000)),
            inv: b.inv as never,
          })),
        },
      },
    };
  }

  async pushImsActions(items: ImsPushItem[], creds: Gstr2bCredentials): Promise<ImsPushResult> {
    if (items.length === 0) throw new Gstr2bProviderError("NO_ACTIONS", "There is nothing to push");
    const rejectedWithoutReason = items.find((i) => i.action === "R" && !i.docNo);
    if (rejectedWithoutReason)
      throw new Gstr2bProviderError("IMS_BAD_RECORD", "A rejected record must name a document");
    const reference = `IMS${createHash("sha256")
      .update(
        `${creds.gstin}:${items.map((i) => `${i.supplierGstin}${i.docNo}${i.action}`).join("|")}`
      )
      .digest("hex")
      .slice(0, 12)
      .toUpperCase()}`;
    const result: ImsPushResult = {
      reference,
      accepted: items.filter((i) => i.action === "A").length,
      rejected: items.filter((i) => i.action === "R").length,
      pending: items.filter((i) => i.action === "P").length,
      raw: { reference, count: items.length, fixture: true },
    };
    this.pushes.set(reference, result);
    return result;
  }

  async verify(creds: Gstr2bCredentials) {
    return { ok: Boolean(creds.gstin), detail: "Fixture provider: nothing is sent anywhere" };
  }
}

export const gstr2bFixtureProvider = new Gstr2bFixtureProvider();
