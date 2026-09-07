import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";

/**
 * CSV imports (P1-00 part 3): templates, dry-run validation with row-level
 * messages, all-or-nothing commit, references resolved against the tenant,
 * opening balances and stock posted on the books-begin date.
 */
const csv = (lines: string[]) => Buffer.from(lines.join("\r\n") + "\r\n", "utf8");

const post = async (
  auth: Record<string, string>,
  type: string,
  file: Buffer,
  dryRun = true,
  field = "file"
) =>
  (await api())
    .post(`/api/imports/${type}?dryRun=${dryRun}`)
    .set(auth)
    .attach(field, file, "upload.csv");

describe("csv imports", () => {
  const sfx = randomUUID().slice(0, 5).toUpperCase();

  it("lists the import types the caller may run and serves templates", async () => {
    const owner = await authed("demo.owner");
    const all = await (await api()).get("/api/imports/types").set(owner.auth);
    expect(all.status).toBe(200);
    expect(all.body.data.map((t: { key: string }) => t.key)).toEqual([
      "customers",
      "suppliers",
      "products",
      "raw-materials",
      "opening-balances",
      "opening-stock",
    ]);

    const stores = await authed("demo.stores");
    const some = await (await api()).get("/api/imports/types").set(stores.auth);
    const keys = some.body.data.map((t: { key: string }) => t.key);
    expect(keys).toContain("raw-materials");
    expect(keys).toContain("opening-stock");
    expect(keys).not.toContain("customers");

    const tpl = await (await api()).get("/api/imports/templates/customers").set(owner.auth);
    expect(tpl.status).toBe(200);
    expect(tpl.headers["content-type"]).toMatch(/text\/csv/);
    expect(tpl.text.split("\r\n")[0]).toMatch(/^customerCode,firmName,/);
    expect(tpl.text.split("\r\n")[1]).toMatch(/^C001,Acme Traders/);

    expect((await (await api()).get("/api/imports/templates/nope").set(owner.auth)).status).toBe(
      400
    );
    expect(
      (await (await api()).get("/api/imports/templates/customers").set(stores.auth)).status
    ).toBe(403);
  });

  it("customers: dry run reports errors, duplicates and existing codes without writing", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const before = await asDemoTenant(() => prisma.customer.count());

    const file = csv([
      "Customer Code,Firm Name,customer_type,mobile,gstin,opening balance,openingBalanceType,state,pincode",
      `IC${sfx}-1,Import Traders One,Distributor,9876543210; 9123456789,33AAAAA0000A1Z9,"12,500",DR,Tamil Nadu,641001`,
      `IC${sfx}-2,Import Traders Two,,,33AAAAA0000A1Z5,,,,`,
      `IC${sfx}-3,Dup A,,,,,,,`,
      `IC${sfx}-3,Dup B,,,,,,,`,
      `C001,Existing Customer,,,,,,,`,
      `,No Code,,,,,,,`,
    ]);
    const res = await post(auth, "customers", file);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const report = res.body.data;
    expect(report).toMatchObject({
      type: "customers",
      dryRun: true,
      total: 6,
      ok: 1,
      exists: 1,
      errors: 4,
    });
    const byRow = Object.fromEntries(report.rows.map((r: { row: number }) => [r.row, r]));
    expect(byRow[1].status).toBe("ok");
    expect(byRow[2].messages[0]).toMatch(/gstin: GSTIN is not valid/);
    expect(byRow[3].messages[0]).toMatch(/repeated in the file/);
    expect(byRow[4].messages[0]).toMatch(/repeated in the file/);
    expect(byRow[5]).toMatchObject({ status: "exists" });
    expect(byRow[6].messages[0]).toMatch(/customerCode: Customer code is required/);
    expect(report.ignoredColumns).toEqual([]);

    expect(await asDemoTenant(() => prisma.customer.count())).toBe(before);

    // Committing with errors is refused and still writes nothing.
    const refused = await post(auth, "customers", file, false);
    expect(refused.status).toBe(400);
    expect(refused.body.data.errors).toBe(4);
    expect(await asDemoTenant(() => prisma.customer.count())).toBe(before);

    // Missing required column and a wrong field name are 400s.
    const noCode = await post(auth, "customers", csv(["firmName", "X"]));
    expect(noCode.status).toBe(400);
    expect(noCode.body.message).toMatch(/Missing required column/);
    expect((await post(auth, "customers", file, true, "upload")).status).toBe(400);
  });

  it("customers: commit creates the parties, their ledgers, types and opening entries", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const file = csv([
      "customerCode,firmName,customerType,customerGrade,mobile,email,gstin,creditLimit,creditDays,addressLine1,city,state,pincode,openingBalance,openingBalanceType",
      `IC${sfx}-1,Import Traders One,Distributor ${sfx},Grade ${sfx},9876543210,one@import.example,33AAAAA0000A1Z9,250000,30,12 Market Road,Coimbatore,Tamil Nadu,641001,12500,DEBIT`,
      `IC${sfx}-2,Import Traders Two,Distributor ${sfx},,,,,,,,,,,,`,
    ]);
    const res = await post(auth, "customers", file, false);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ dryRun: false, imported: 2, failed: null });

    await asDemoTenant(async () => {
      const one = await prisma.customer.findFirstOrThrow({
        where: { customerCode: `IC${sfx}-1` },
        include: { accountLedger: true, addresses: true, customerType: true, customerGrade: true },
      });
      expect(one.firmName).toBe("Import Traders One");
      expect(one.gstin).toBe("33AAAAA0000A1Z9");
      expect(Number(one.openingBalance)).toBe(12500);
      expect(one.customerType?.name).toBe(`Distributor ${sfx}`);
      expect(one.customerGrade?.name).toBe(`Grade ${sfx}`);
      expect(one.addresses).toHaveLength(1);
      expect(one.accountLedger?.code).toBe(`CUST-IC${sfx}-1`);
      const voucher = await prisma.voucher.findFirst({
        where: { refDocType: "CUSTOMER_OPENING_BALANCE", refDocId: one.id },
      });
      expect(voucher, "opening receivable posted").toBeTruthy();
      // The type is reused, not duplicated, across the two rows.
      expect(await prisma.customerType.count({ where: { name: `Distributor ${sfx}` } })).toBe(1);
    });

    // A second run sees them as existing and imports nothing new.
    const again = await post(auth, "customers", file);
    expect(again.body.data).toMatchObject({ ok: 0, exists: 2, errors: 0 });
  });

  it("suppliers: state code comes from the GSTIN or the state name", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const file = csv([
      "supplierCode,legalName,gstin,pan,billingAddressLine1,billingCity,billingState,billingPincode,stateCode,openingBalance",
      `IS${sfx}-1,Bharat Steels ${sfx},27AAAAA0000A1Z2,AAAAA0000A,Plot 7 MIDC,Pune,Maharashtra,411001,,48000`,
      `IS${sfx}-2,Local Packaging ${sfx},,,5 Mill Road,Bengaluru,Karnataka,560001,,`,
      `IS${sfx}-3,Mismatch ${sfx},27AAAAA0000A1Z2,,X,Y,Maharashtra,411001,29,`,
      `IS${sfx}-4,Nowhere ${sfx},,,X,Y,Atlantis,411001,,`,
    ]);
    const dry = await post(auth, "suppliers", file);
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ ok: 2, errors: 2 });
    expect(dry.body.data.rows[2].messages[0]).toMatch(/does not match/);
    expect(dry.body.data.rows[3].messages[0]).toMatch(/stateCode/);

    const good = csv([
      "supplierCode,legalName,gstin,pan,billingAddressLine1,billingCity,billingState,billingPincode,openingBalance",
      `IS${sfx}-1,Bharat Steels ${sfx},27AAAAA0000A1Z2,AAAAA0000A,Plot 7 MIDC,Pune,Maharashtra,411001,48000`,
      `IS${sfx}-2,Local Packaging ${sfx},,,5 Mill Road,Bengaluru,Karnataka,560001,`,
    ]);
    const res = await post(auth, "suppliers", good, false);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    await asDemoTenant(async () => {
      const s1 = await prisma.supplier.findFirstOrThrow({
        where: { supplierCode: `IS${sfx}-1` },
        include: { accountLedger: true },
      });
      expect(s1.stateCode).toBe("27");
      expect(s1.gstRegType).toBe("REGULAR");
      expect(s1.accountLedger?.group).toBe("Sundry Creditors");
      expect(
        await prisma.voucher.count({
          where: { refDocType: "SUPPLIER_OPENING_BALANCE", refDocId: String(s1.id) },
        })
      ).toBe(1);
      const s2 = await prisma.supplier.findFirstOrThrow({ where: { supplierCode: `IS${sfx}-2` } });
      expect(s2.stateCode).toBe("29");
    });
  });

  it("products and raw materials: references resolve by code and opening quantities move stock", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const { fgStore, rmStore, productCategory, rmCategory } = await asDemoTenant(async () => ({
      fgStore: (
        await prisma.store.findFirstOrThrow({ where: { storeName: "Finished Goods Store" } })
      ).storeId,
      rmStore: (await prisma.store.findFirstOrThrow({ where: { storeName: "Raw Material Store" } }))
        .storeId,
      productCategory: (await prisma.category.findFirst({ where: { type: "PRODUCT" } }))?.code,
      rmCategory: (await prisma.category.findFirst({ where: { type: "RAW_MATERIAL" } }))?.code,
    }));

    const products = csv([
      "productCode,productName,productType,category,rate,openingStockQty,openingStockStore,isActive",
      `IP${sfx}-1,Imported Bottle ${sfx},PRODUCTION,${productCategory ?? ""},18.5,5000,${fgStore},yes`,
      `IP${sfx}-2,No Store ${sfx},,,,100,,`,
      `IP${sfx}-3,Bad Category ${sfx},,NOPE-${sfx},,,,`,
    ]);
    const dry = await post(auth, "products", products);
    expect(dry.status).toBe(200);
    expect(dry.body.data).toMatchObject({ ok: 1, errors: 2 });
    expect(dry.body.data.rows[1].messages[0]).toMatch(/openingStockStore: required/);
    expect(dry.body.data.rows[2].messages[0]).toMatch(/category: no product category/);

    const okProducts = csv([
      "productCode,productName,category,rate,openingStockQty,openingStockStore",
      `IP${sfx}-1,Imported Bottle ${sfx},${productCategory ?? ""},18.5,5000,${fgStore}`,
    ]);
    const pRes = await post(auth, "products", okProducts, false);
    expect(pRes.status, JSON.stringify(pRes.body)).toBe(201);

    const materials = csv([
      "rawMaterialId,materialName,baseUom,category,store,rate,onHandQty",
      `IR${sfx}-1,Imported HDPE ${sfx},KG,${rmCategory ?? ""},${rmStore},96,1200`,
      `IR${sfx}-2,Lost Material ${sfx},KG,,NOWHERE,,`,
    ]);
    const mDry = await post(auth, "raw-materials", materials);
    expect(mDry.body.data).toMatchObject({ ok: 1, errors: 1 });
    expect(mDry.body.data.rows[1].messages[0]).toMatch(/store: no store NOWHERE/);
    const okMaterials = csv([
      "rawMaterialId,materialName,baseUom,store,rate,onHandQty",
      `IR${sfx}-1,Imported HDPE ${sfx},KG,${rmStore},96,1200`,
    ]);
    const mRes = await post(auth, "raw-materials", okMaterials, false);
    expect(mRes.status, JSON.stringify(mRes.body)).toBe(201);

    await asDemoTenant(async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { productCode: `IP${sfx}-1` },
        include: { finishedGoodsStocks: true },
      });
      expect(Number(product.rate)).toBe(18.5);
      expect(product.finishedGoodsStocks).toHaveLength(1);
      expect(Number(product.finishedGoodsStocks[0].onHandQty)).toBe(5000);
      const rm = await prisma.rawMaterial.findUniqueOrThrow({
        where: { rawMaterialId: `IR${sfx}-1` },
      });
      expect(Number(rm.onHandQty)).toBe(1200);
      expect(rm.storeId).toBe(rmStore);
      expect(
        await prisma.rawMaterialTransaction.count({
          where: { rawMaterialId: `IR${sfx}-1`, txnType: "OPENING_STOCK" },
        })
      ).toBe(1);
    });
  });

  it("opening balances: existing and new ledgers get one opening journal each, dated the books-begin day", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const file = csv([
      "ledgerCode,ledgerName,ledgerType,ledgerGroup,debit,credit",
      `CASH-${sfx},Petty cash ${sfx},ASSET,Cash in Hand,25000,`,
      `LOAN-${sfx},HDFC term loan ${sfx},LIABILITY,Secured Loans,,500000`,
      `UNKNOWN-${sfx},,,,100,`,
      `CASH-${sfx},Petty cash ${sfx},ASSET,,1,`,
      `BOTH-${sfx},Both ${sfx},ASSET,,10,10`,
    ]);
    const dry = await post(auth, "opening-balances", file);
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const rows = dry.body.data.rows;
    expect(rows[2].messages[0]).toMatch(/does not exist; give ledgerName and ledgerType/);
    expect(rows[3].messages[0]).toMatch(/repeated in the file/);
    expect(rows[4].messages[0]).toMatch(/either a debit or a credit/);

    const good = csv([
      "ledgerCode,ledgerName,ledgerType,ledgerGroup,debit,credit",
      `CASH-${sfx},Petty cash ${sfx},ASSET,Cash in Hand,25000,`,
      `LOAN-${sfx},HDFC term loan ${sfx},LIABILITY,Secured Loans,,500000`,
    ]);
    const res = await post(auth, "opening-balances", good, false);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.imported).toBe(2);

    await asDemoTenant(async () => {
      const loan = await prisma.accountLedger.findFirstOrThrow({ where: { code: `LOAN-${sfx}` } });
      expect(loan.type).toBe("LIABILITY");
      expect(loan.group).toBe("Secured Loans");
      const voucher = await prisma.voucher.findFirstOrThrow({
        where: { refDocType: "LEDGER_OPENING_BALANCE", refDocId: String(loan.id) },
        include: { items: true },
      });
      const credit = voucher.items.find((i) => i.creditLedgerId === loan.id);
      expect(Number(credit?.creditAmount)).toBe(500000);
      const inv = await prisma.invoiceSetting.findFirstOrThrow();
      expect(voucher.date.toISOString().slice(0, 10)).toBe(
        inv.financialYearStart.toISOString().slice(0, 10)
      );
    });

    const again = await post(auth, "opening-balances", good);
    expect(again.body.data).toMatchObject({ ok: 0, exists: 2 });

    // Party ledgers are refused: their balances come with the customer/supplier imports.
    const party = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { customerId: { not: null } } })
    );
    const partyRun = await post(
      auth,
      "opening-balances",
      csv(["ledgerCode,debit", `${party.code},100`])
    );
    expect(partyRun.body.data.rows[0].messages[0]).toMatch(/customer and supplier balances/);
  });

  it("opening stock: quantities land in the right store once", async () => {
    const { auth } = await authed("demo.owner");
    const prisma = await getPrisma();
    const { fgStore, rmStore, productCode, rmId } = await asDemoTenant(async () => ({
      fgStore: (
        await prisma.store.findFirstOrThrow({ where: { storeName: "Finished Goods Store" } })
      ).storeId,
      rmStore: (await prisma.store.findFirstOrThrow({ where: { storeName: "Raw Material Store" } }))
        .storeId,
      productCode: (
        await prisma.product.findFirstOrThrow({
          where: { finishedGoodsTransactions: { none: { txnType: "OPENING_STOCK" } } },
          orderBy: { id: "asc" },
        })
      ).productCode,
      rmId: (
        await prisma.rawMaterial.findFirstOrThrow({
          where: { rawMaterialTransactions: { none: { txnType: "OPENING_STOCK" } } },
          orderBy: { rawMaterialId: "asc" },
        })
      ).rawMaterialId,
    }));
    const beforeRm = await asDemoTenant(async () =>
      Number(
        (await prisma.rawMaterial.findUniqueOrThrow({ where: { rawMaterialId: rmId } })).onHandQty
      )
    );

    const file = csv([
      "itemType,itemCode,store,qty,remarks",
      `PRODUCT,${productCode},${fgStore},"2,500",Count 31 Mar`,
      `RAW_MATERIAL,${rmId},${rmStore},750,`,
      `PRODUCT,NOPE-${sfx},${fgStore},1,`,
      `RAW_MATERIAL,${rmId},${rmStore},-5,`,
    ]);
    const dry = await post(auth, "opening-stock", file);
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.data).toMatchObject({ ok: 2, errors: 2 });
    expect(dry.body.data.rows[2].messages[0]).toMatch(/itemCode: no product/);
    expect(dry.body.data.rows[3].messages.join(" ")).toMatch(/positive/);

    const good = csv([
      "itemType,itemCode,store,qty,remarks",
      `PRODUCT,${productCode},${fgStore},2500,Count 31 Mar`,
      `RAW_MATERIAL,${rmId},${rmStore},750,`,
    ]);
    const res = await post(auth, "opening-stock", good, false);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    await asDemoTenant(async () => {
      const product = await prisma.product.findFirstOrThrow({ where: { productCode } });
      const stock = await prisma.finishedGoodsStock.findUniqueOrThrow({
        where: { storeId_productItemId: { storeId: fgStore, productItemId: product.id } },
      });
      expect(Number(stock.onHandQty)).toBeGreaterThanOrEqual(2500);
      expect(
        await prisma.finishedGoodsTransaction.count({
          where: { productItemId: product.id, storeId: fgStore, txnType: "OPENING_STOCK" },
        })
      ).toBe(1);
      const rm = await prisma.rawMaterial.findUniqueOrThrow({ where: { rawMaterialId: rmId } });
      expect(Number(rm.onHandQty)).toBe(beforeRm + 750);
    });

    const again = await post(auth, "opening-stock", good);
    expect(again.body.data).toMatchObject({ ok: 0, exists: 2 });
  });

  it("permissions follow the import type", async () => {
    const stores = await authed("demo.stores");
    const denied = await post(stores.auth, "customers", csv(["customerCode,firmName", "X,Y"]));
    expect(denied.status).toBe(403);
    const allowed = await post(
      stores.auth,
      "raw-materials",
      csv(["rawMaterialId,materialName,baseUom,store", `IR${sfx}-9,Z,KG,NOWHERE`])
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.errors).toBe(1);
  });
});
