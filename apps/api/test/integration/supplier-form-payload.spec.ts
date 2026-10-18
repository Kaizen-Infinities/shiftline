import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";

/**
 * Supplier create as the web form sends it (SupplierForm.tsx `handleSubmit`, via supplierGstFields):
 * gstRegType is an API enum value, and stateCode is the numeric GST state code (from the GSTIN, or
 * mapped from the billing state name when there is no GSTIN). C03 / C04.
 */
const sfx = Date.now().toString(36).slice(-5).toUpperCase();
const GSTIN_TN = "33AAAAA0000A1Z9"; // syntactically valid, state code 33

/** Exactly the keys and values the form builds for a new supplier; only the GST fields vary. */
const formPayload = (over: Record<string, unknown>) => ({
  companyId: "",
  supplierCode: `SF-${sfx}-${over.tag}`,
  legalName: `Form Supplier ${sfx} Pvt Ltd`,
  displayName: null,
  contactPerson: null,
  mobile: [{ label: "Primary Mobile Number", number: "+919876543210" }],
  email: null,
  gstin: null,
  pan: null,
  gstRegType: "REGULAR",
  billingAddressLine1: "12 Industrial Estate",
  billingCity: "Coimbatore",
  billingState: "Tamil Nadu",
  billingPincode: "641001",
  billingCountry: "India",
  stateCode: "33",
  status: "Active",
  addresses: [
    {
      address: {
        addressLine1: "Plant 2, Gate 4",
        addressLine2: "",
        city: "Coimbatore",
        state: "Tamil Nadu",
        pincode: "641001",
      },
    },
  ],
  creditDays: null,
  msmeCategory: "NOT_REGISTERED",
  udyamNumber: null,
  hasWrittenContract: false,
  agreedPaymentDays: null,
  defaultTdsSectionCode: null,
  deducteeType: null,
  higherRate206AB: false,
  openingBalance: 0,
  openingBalanceType: "CREDIT",
  ...over,
});

let OWNER: { auth: Record<string, string> };

describe("supplier create from the web form payload", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("creates a GSTIN supplier with the form's REGULAR type and GSTIN-prefix state code (201)", async () => {
    const res = await (
      await api()
    )
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send(
        formPayload({
          tag: "G",
          gstin: GSTIN_TN,
          pan: "AAAAA0000A",
        })
      );
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.gstin).toBe(GSTIN_TN);
    expect(res.body.data.gstRegType).toBe("REGULAR");
    expect(res.body.data.stateCode).toBe("33");
    expect(res.body.data.addresses).toHaveLength(1);
  });

  it("creates a supplier without a GSTIN as UNREGISTERED with the billing state's code (201)", async () => {
    const res = await (await api())
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send(formPayload({ tag: "N", gstRegType: "UNREGISTERED" }));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.gstin).toBeNull();
    expect(res.body.data.gstRegType).toBe("UNREGISTERED");
    expect(res.body.data.stateCode).toBe("33");
  });
});
