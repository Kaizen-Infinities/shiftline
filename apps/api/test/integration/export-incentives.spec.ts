import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { createCustomer, createSalesInvoice } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Export incentives and authorisations (TN-01): claims per shipping bill from declaration to
 * credit, EPCG / AA obligations, the summary, validation, tenancy and permissions.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const SB = (n: string) => `SB${sfx}${n}`;
const n = (v: unknown) => Number(v);

let OWNER: { auth: Record<string, string> };
let ACCOUNTS: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };

describe("export incentives (TN-01)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    ACCOUNTS = await authed("demo.accounts");
    PRODUCTION = await authed("demo.production");
  });

  let claimId: string;

  it("records a RoDTEP claim and computes the expected amount from the rate", async () => {
    const res = await (
      await api()
    )
      .post("/api/export-incentives/claims")
      .set(ACCOUNTS.auth)
      .send({
        scheme: "RODTEP",
        shippingBillNo: SB("1"),
        shippingBillDate: "2026-06-10",
        portCode: "INMAA1",
        fobValueInr: 1000000,
        ratePercent: 0.9,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.status).toBe("DECLARED");
    expect(n(res.body.data.expectedAmount)).toBe(9000);
    claimId = res.body.data.id;
  });

  it("moves the claim forward and fills the scrip expiry", async () => {
    const client = await api();
    const scrolled = await client
      .patch(`/api/export-incentives/claims/${claimId}`)
      .set(ACCOUNTS.auth)
      .send({ status: "SCROLLED", scrolledAmount: 8800, scrolledOn: "2026-07-01" });
    expect(scrolled.status).toBe(200);

    const scrip = await client
      .patch(`/api/export-incentives/claims/${claimId}`)
      .set(ACCOUNTS.auth)
      .send({ status: "SCRIP_GENERATED", scripNo: "RS123456", scripDate: "2026-07-20" });
    expect(scrip.status).toBe(200);
    expect(scrip.body.data.scripExpiresOn.slice(0, 10)).toBe("2027-07-20");

    const back = await client
      .patch(`/api/export-incentives/claims/${claimId}`)
      .set(ACCOUNTS.auth)
      .send({ status: "DECLARED" });
    expect(back.status).toBe(409);
  });

  it("refuses to delete a claim that has left DECLARED", async () => {
    const res = await (
      await api()
    )
      .delete(`/api/export-incentives/claims/${claimId}`)
      .set(OWNER.auth);
    expect(res.status).toBe(409);
  });

  it("deletes a claim still in DECLARED", async () => {
    const client = await api();
    const created = await client
      .post("/api/export-incentives/claims")
      .set(OWNER.auth)
      .send({
        scheme: "DRAWBACK",
        shippingBillNo: SB("9"),
        shippingBillDate: "2026-06-11",
        fobValueInr: 50000,
        expectedAmount: 1000,
      });
    expect(created.status).toBe(201);
    const del = await client
      .delete(`/api/export-incentives/claims/${created.body.data.id}`)
      .set(OWNER.auth);
    expect(del.status).toBe(200);
  });

  it("refuses a duplicate claim for the same scheme and shipping bill", async () => {
    const res = await (
      await api()
    )
      .post("/api/export-incentives/claims")
      .set(OWNER.auth)
      .send({
        scheme: "RODTEP",
        shippingBillNo: SB("1"),
        shippingBillDate: "2026-06-10",
        fobValueInr: 1000,
        ratePercent: 1,
      });
    expect(res.status).toBe(409);
  });

  it.each([
    ["a bad shipping bill number", { shippingBillNo: "sb-1" }],
    ["a zero FOB value", { fobValueInr: 0 }],
    ["a rate above 25 percent", { ratePercent: 26 }],
    ["a negative rate", { ratePercent: -1 }],
    ["neither rate nor amount", { ratePercent: undefined }],
    ["a bad date", { shippingBillDate: "10/06/2026" }],
    ["an unknown scheme", { scheme: "MEIS" }],
  ])("rejects a claim with %s", async (_label, patch) => {
    const res = await (
      await api()
    )
      .post("/api/export-incentives/claims")
      .set(OWNER.auth)
      .send({
        scheme: "ROSCTL",
        shippingBillNo: SB("5"),
        shippingBillDate: "2026-06-10",
        fobValueInr: 1000,
        ratePercent: 1,
        ...patch,
      });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|stack|at \//i);
  });

  it("rejects a scrip dated before the shipping bill", async () => {
    const res = await (
      await api()
    )
      .patch(`/api/export-incentives/claims/${claimId}`)
      .set(OWNER.auth)
      .send({ scripDate: "2026-06-01" });
    expect(res.status).toBe(400);
  });

  it("rejects a utilised amount above the scrolled amount", async () => {
    const res = await (
      await api()
    )
      .patch(`/api/export-incentives/claims/${claimId}`)
      .set(OWNER.auth)
      .send({ utilisedAmount: 9000 });
    expect(res.status).toBe(400);
  });

  it("pre-fills a claim from an export invoice", async () => {
    const customer = await createCustomer();
    const invoice = await createSalesInvoice({
      customerId: customer.id,
      exportType: "UNDER_LUT",
      shippingBillNo: SB("7"),
      shippingBillDate: new Date("2026-06-15T00:00:00Z"),
      portCode: "INTUT1",
    } as never);
    const res = await (
      await api()
    )
      .post(`/api/export-incentives/claims/from-invoice/${invoice.id}`)
      .set(OWNER.auth)
      .send({ scheme: "ROSCTL", ratePercent: 2 });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.shippingBillNo).toBe(SB("7"));
    expect(res.body.data.salesInvoiceId).toBe(invoice.id);
    expect(n(res.body.data.expectedAmount)).toBe(60);
  });

  it("summarises by scheme and status", async () => {
    const res = await (await api()).get("/api/export-incentives/claims/summary").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.byScheme.RODTEP.SCRIP_GENERATED.count).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.data.pendingReceivable).toBe("number");
    expect(Array.isArray(res.body.data.expiringScrips)).toBe(true);
  });

  let authId: string;

  it("records an EPCG authorisation with the 6x obligation and block-1 date", async () => {
    const res = await (
      await api()
    )
      .post("/api/export-incentives/authorisations")
      .set(ACCOUNTS.auth)
      .send({
        authType: "EPCG",
        authNo: `EP${sfx}01`,
        issueDate: "2026-01-15",
        rlaOffice: "Coimbatore",
        dutySaved: 500000,
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(n(res.body.data.exportObligationAmount)).toBe(3000000);
    expect(res.body.data.eoPeriodMonths).toBe(72);
    expect(res.body.data.eoDueDate.slice(0, 10)).toBe("2032-01-15");
    expect(res.body.data.block1DueDate.slice(0, 10)).toBe("2030-01-15");
    authId = res.body.data.id;
  });

  it("counts realised shipping bills towards the obligation", async () => {
    const client = await api();
    const add = await client
      .post(`/api/export-incentives/authorisations/${authId}/entries`)
      .set(ACCOUNTS.auth)
      .send({
        shippingBillNo: SB("E1"),
        shippingBillDate: "2026-03-01",
        fobValueInr: 300000,
        realisedOn: "2026-05-01",
        brcNo: "BRC1",
      });
    expect(add.status).toBe(201);
    expect(add.body.data.progress.realisedFob).toBe(300000);
    expect(add.body.data.progress.eoPercent).toBe(10);
    expect(add.body.data.progress.block1Percent).toBe(20);

    const dup = await client
      .post(`/api/export-incentives/authorisations/${authId}/entries`)
      .set(ACCOUNTS.auth)
      .send({ shippingBillNo: SB("E1"), shippingBillDate: "2026-03-01", fobValueInr: 1 });
    expect(dup.status).toBe(409);

    const entryId = add.body.data.entries[0].id;
    const del = await client
      .delete(`/api/export-incentives/authorisations/${authId}/entries/${entryId}`)
      .set(ACCOUNTS.auth);
    expect(del.status).toBe(200);
    expect(del.body.data.entries).toHaveLength(0);
  });

  it("cancels an authorisation instead of deleting it", async () => {
    const client = await api();
    const res = await client
      .patch(`/api/export-incentives/authorisations/${authId}`)
      .set(OWNER.auth)
      .send({ status: "CANCELLED" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    const list = await client.get("/api/export-incentives/authorisations").set(OWNER.auth);
    expect(list.body.data.some((a: { id: string }) => a.id === authId)).toBe(true);
  });

  it.each([
    ["a bad authorisation number", { authNo: "ab" }],
    ["an obligation period above 120 months", { eoPeriodMonths: 121 }],
    ["an obligation period of zero", { eoPeriodMonths: 0 }],
    ["an unknown type", { authType: "DFIA" }],
  ])("rejects an authorisation with %s", async (_label, patch) => {
    const res = await (
      await api()
    )
      .post("/api/export-incentives/authorisations")
      .set(OWNER.auth)
      .send({
        authType: "EPCG",
        authNo: `EP${sfx}02`,
        issueDate: "2026-01-15",
        dutySaved: 1000,
        ...patch,
      });
    expect(res.status).toBe(400);
  });

  it("requires the obligation amount on an Advance Authorisation", async () => {
    const res = await (
      await api()
    )
      .post("/api/export-incentives/authorisations")
      .set(OWNER.auth)
      .send({
        authType: "ADVANCE_AUTHORISATION",
        authNo: `AA${sfx}01`,
        issueDate: "2026-01-15",
        dutySaved: 1000,
      });
    expect(res.status).toBe(400);
  });

  it("refuses a role without the export-incentives permission", async () => {
    const client = await api();
    const list = await client.get("/api/export-incentives/claims").set(PRODUCTION.auth);
    expect(list.status).toBe(403);
    const create = await client
      .post("/api/export-incentives/claims")
      .set(PRODUCTION.auth)
      .send({
        scheme: "RODTEP",
        shippingBillNo: SB("P"),
        shippingBillDate: "2026-06-10",
        fobValueInr: 1000,
        ratePercent: 1,
      });
    expect(create.status).toBe(403);
  });

  it("never shows or touches another tenant's claims and authorisations", async () => {
    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Exports Tenant B", companyCode: `EXPB-${sfx}` },
      })
    );
    const foreignClaim = await runAsTenant(other.id, () =>
      prisma.exportIncentiveClaim.create({
        data: {
          scheme: "RODTEP",
          shippingBillNo: `FX${sfx}`,
          shippingBillDate: new Date("2026-06-10T00:00:00Z"),
          fobValueInr: 100,
          expectedAmount: 1,
        } as never,
      })
    );
    const foreignAuth = await runAsTenant(other.id, () =>
      prisma.exportAuthorisation.create({
        data: {
          authType: "EPCG",
          authNo: `FXA${sfx}`,
          issueDate: new Date("2026-01-01T00:00:00Z"),
          dutySaved: 1,
          exportObligationAmount: 6,
          eoPeriodMonths: 72,
          eoDueDate: new Date("2032-01-01T00:00:00Z"),
        } as never,
      })
    );
    const foreignCustomer = await runAsTenant(other.id, () =>
      prisma.customer.create({
        data: {
          createdBy: "test",
          customerCode: `FXC-${sfx}`,
          firmName: `Foreign ${sfx}`,
          displayName: `Foreign ${sfx}`,
          mobile: ["9000000000"],
        } as never,
      })
    );
    const foreignInvoice = await runAsTenant(other.id, () =>
      prisma.salesInvoice.create({
        data: {
          customerId: foreignCustomer.id,
          invoiceNo: `FXI-${sfx}`,
          invoiceDate: new Date(),
          subTotal: 100,
          taxTotal: 0,
          grandTotal: 100,
          status: "UNPAID",
          payments: [],
          exportType: "UNDER_LUT",
          shippingBillNo: `FXS${sfx}`,
        } as never,
      })
    );

    const client = await api();
    const list = await client.get("/api/export-incentives/claims").set(OWNER.auth);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(foreignClaim.id);
    const auths = await client.get("/api/export-incentives/authorisations").set(OWNER.auth);
    expect(JSON.stringify(auths.body)).not.toContain(foreignAuth.id);

    const getAuth = await client
      .get(`/api/export-incentives/authorisations/${foreignAuth.id}`)
      .set(OWNER.auth);
    expect(getAuth.status).toBe(404);
    const patch = await client
      .patch(`/api/export-incentives/claims/${foreignClaim.id}`)
      .set(OWNER.auth)
      .send({ notes: "hijack" });
    expect(patch.status).toBe(404);
    const del = await client
      .delete(`/api/export-incentives/claims/${foreignClaim.id}`)
      .set(OWNER.auth);
    expect(del.status).toBe(404);
    const fromInvoice = await client
      .post(`/api/export-incentives/claims/from-invoice/${foreignInvoice.id}`)
      .set(OWNER.auth)
      .send({ scheme: "RODTEP", ratePercent: 1 });
    expect(fromInvoice.status).toBe(404);

    const still = await runAsTenant(other.id, () =>
      prisma.exportIncentiveClaim.findFirst({ where: { id: foreignClaim.id } })
    );
    expect(still?.notes ?? null).toBeNull();
  });
});
