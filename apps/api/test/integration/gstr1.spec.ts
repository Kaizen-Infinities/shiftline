import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { createCustomer, createProduct } from "../factories";

/**
 * GSTR-1 from the books (P1-13a): B2B, B2CL, B2CS, CDNR, HSN and the document register for one
 * GSTIN and month, the portal JSON, and the filing gate (register, approve elsewhere, file).
 */
const SELLER = "33AAAAA0000A1Z9";
const BUYER = "27AAPFU0939F1ZV";
const PERIOD = "2026-09";
const sfx = Date.now().toString(36);

const customerWith = (over: Record<string, unknown>) =>
  createCustomer({
    addresses: {
      create: [
        {
          label: "Billing",
          is_default: true,
          state_code: "27",
          address: {
            addressLine1: "1 Road",
            city: "Pune",
            state: "Maharashtra",
            pincode: "411001",
          },
        },
      ],
    },
    ...over,
  });

const invoice = async (customerId: string, qty: number, rate: number) => {
  const owner = await authed("demo.owner");
  const product = await createProduct({ gstRate: 18, rate });
  const res = await (
    await api()
  )
    .post("/api/sales-invoices")
    .set(owner.auth)
    .send({
      invoiceDate: "2026-09-12",
      customerId,
      items: [{ productId: product.id.toString(), qty, rate, taxPercent: 18, hsnCode: "3923" }],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    inv: res.body.data as { id: string; invoiceNo: string; items: { id: string }[] },
    product,
  };
};

describe("GSTR-1", () => {
  it("places invoices and credit notes in the portal tables and builds the offline JSON", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const b2bCustomer = await customerWith({
      gstin: BUYER,
      gstRegType: "REGULAR",
      stateCode: "27",
    });
    const walkInMaharashtra = await customerWith({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "27",
    });
    const walkInLocal = await createCustomer({
      gstin: null,
      gstRegType: "UNREGISTERED",
      stateCode: "33",
    });
    const { inv: b2b, product } = await invoice(b2bCustomer.id, 10, 1000); // 10,000 + IGST
    const { inv: b2cl } = await invoice(walkInMaharashtra.id, 30, 10000); // 3,00,000 inter-state, above 2.5 lakh
    const { inv: b2cs } = await invoice(walkInLocal.id, 2, 500); // small, intra-state
    const cn = await client
      .post("/api/returns/sales")
      .set(owner.auth)
      .send({
        customerId: b2bCustomer.id,
        salesInvoiceId: b2b.id,
        // Pinned inside PERIOD: left to default, the note takes today's date and falls out of
        // the September return once the calendar moves on.
        returnDate: "2026-09-20",
        reason: "Short supply",
        items: [
          {
            productId: Number(product.id),
            salesInvoiceItemId: b2b.items[0].id,
            quantity: 2,
            unitPrice: 1000,
          },
        ],
      });
    expect(cn.status, JSON.stringify(cn.body)).toBe(201);
    const noteNo = cn.body.data.creditNoteNo as string;

    expect(
      (await client.get("/api/gst-returns/gstr1").query({ period: PERIOD }).set(supervisor.auth))
        .status
    ).toBe(403);
    expect(
      (await client.get("/api/gst-returns/gstr1").query({ period: "2026-9" }).set(owner.auth))
        .status
    ).toBe(400);
    const gstins = await client.get("/api/gst-returns/gstins").set(owner.auth);
    expect(gstins.body.data[0]).toMatchObject({
      gstin: SELLER,
      stateCode: "33",
      businessPlaceId: null,
    });

    const res = await client
      .get("/api/gst-returns/gstr1")
      .query({ period: PERIOD, gstin: SELLER })
      .set(owner.auth);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const ret = res.body.data;
    expect(ret).toMatchObject({ gstin: SELLER, periodKey: PERIOD, fp: "092026" });
    const json = ret.json;
    expect(json.version).toBe("GST3.1.8");

    const party = json.b2b.find((p: { ctin: string }) => p.ctin === BUYER);
    const b2bInv = party.inv.find((i: { inum: string }) => i.inum === b2b.invoiceNo);
    expect(b2bInv).toMatchObject({
      idt: "12-09-2026",
      val: 11800,
      pos: "27",
      rchrg: "N",
      inv_typ: "R",
    });
    expect(b2bInv.itms[0].itm_det).toMatchObject({ rt: 18, txval: 10000, iamt: 1800, csamt: 0 });
    expect(b2bInv.itms[0].itm_det.camt).toBeUndefined();

    const pos27 = json.b2cl.find((p: { pos: string }) => p.pos === "27");
    const big = pos27.inv.find((i: { inum: string }) => i.inum === b2cl.invoiceNo);
    expect(big).toMatchObject({ val: 354000 });
    expect(big.itms[0].itm_det).toMatchObject({ rt: 18, txval: 300000, iamt: 54000 });

    const small = json.b2cs.find(
      (r: { sply_ty: string; pos: string; rt: number }) =>
        r.sply_ty === "INTRA" && r.pos === "33" && r.rt === 18
    );
    expect(small).toBeTruthy();
    expect(small.txval).toBeGreaterThanOrEqual(1000);
    expect(small.camt).toBeGreaterThanOrEqual(90);
    expect(json.b2cs.some((r: { inum?: string }) => r.inum === b2cs.invoiceNo)).toBe(false); // aggregated, no invoice numbers

    const cdnr = json.cdnr.find((p: { ctin: string }) => p.ctin === BUYER);
    const note = cdnr.nt.find((x: { nt_num: string }) => x.nt_num === noteNo);
    expect(note).toMatchObject({ ntty: "C", val: 2360, pos: "27" });
    expect(note.itms[0].itm_det).toMatchObject({ rt: 18, txval: 2000, iamt: 360 });

    const hsnRow = json.hsn.data.find(
      (h: { hsn_sc: string; rt: number }) => h.hsn_sc === "3923" && h.rt === 18
    );
    expect(hsnRow).toBeTruthy();
    expect(hsnRow.uqc).toBe("OTH");
    const docs = json.doc_issue.doc_det.find((d: { doc_num: number }) => d.doc_num === 1);
    expect(docs.docs[0].net_issue).toBeGreaterThanOrEqual(3);
    expect(docs.docs[0].totnum).toBe(docs.docs[0].net_issue + docs.docs[0].cancel);
    const notes = json.doc_issue.doc_det.find((d: { doc_num: number }) => d.doc_num === 5);
    expect(notes.docs[0].net_issue).toBeGreaterThanOrEqual(1);

    expect(ret.totals.byTable.b2b.count).toBeGreaterThanOrEqual(1);
    expect(ret.totals.byTable.b2cl.count).toBeGreaterThanOrEqual(1);
    expect(ret.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    const download = await client
      .get("/api/gst-returns/gstr1/json")
      .query({ period: PERIOD })
      .set(owner.auth);
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain(`GSTR1_${SELLER}_092026.json`);
    expect(download.body.gstin).toBe(SELLER);
  });

  it("registers the month on the filing gate, refuses filing until approved, then marks it filed", async () => {
    const owner = await authed("demo.owner");
    const accountant = await authed("demo.accounts");
    const client = await api();
    const period = "2026-08"; // an empty month keeps this test independent of the other suites
    const reg = await client
      .post("/api/gst-returns/gstr1/register")
      .set(accountant.auth)
      .send({ period });
    expect(reg.status, JSON.stringify(reg.body).slice(0, 300)).toBe(200);
    expect(reg.body.data.filing).toMatchObject({
      status: "DRAFT",
      filingType: "GSTR1",
      periodKey: period,
      businessPlaceId: null,
    });
    const hash = reg.body.data.payloadHash as string;
    expect(reg.body.data.filing.payloadHash).toBe(hash);

    const early = await client
      .post("/api/gst-returns/gstr1/filed")
      .set(accountant.auth)
      .send({ period, submissionRef: "ARN1" });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe("FILING_NOT_APPROVED");

    const id = reg.body.data.filing.id as string;
    expect(
      (await client.post(`/api/filings/approvals/${id}/send`).set(accountant.auth)).status
    ).toBe(200);
    expect((await client.post(`/api/filings/approvals/${id}/approve`).set(owner.auth)).status).toBe(
      200
    );
    // A registered month can be re-registered with the same figures without voiding the approval.
    const again = await client
      .post("/api/gst-returns/gstr1/register")
      .set(accountant.auth)
      .send({ period });
    expect(again.body.data.filing.status).toBe("APPROVED");

    const filed = await client
      .post("/api/gst-returns/gstr1/filed")
      .set(accountant.auth)
      .send({ period, submissionRef: `AA330826${sfx}` });
    expect(filed.status, JSON.stringify(filed.body).slice(0, 300)).toBe(200);
    expect(filed.body.data.filing).toMatchObject({ status: "SUBMITTED" });
    expect(
      (await client.post("/api/gst-returns/gstr1/filed").set(accountant.auth).send({ period })).body
        .code
    ).toBe("FILING_SUBMITTED");
  });
});
