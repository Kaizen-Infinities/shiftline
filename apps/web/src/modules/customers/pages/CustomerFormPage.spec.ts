import { describe, expect, it } from "vitest";
import { initialFormData, mapCustomerToFormData } from "./CustomerFormPage";

describe("customer form defaults (H14)", () => {
  it("does not pre-fill a state, so an inter-state customer cannot get the Tamil Nadu tax split by accident", () => {
    expect(initialFormData.addresses[0].address.state).toBe("");
  });
});

describe("customer edit mapping (CMP-B01)", () => {
  it("opens a seeded customer whose mobile is a plain string array", () => {
    const values = mapCustomerToFormData({
      customerCode: "CUS-001",
      firmName: "Dune Plastics (DEMO)",
      displayName: "Dune Plastics",
      mobile: ["9000000001"],
      addresses: [],
    });
    expect(values.phones).toEqual([{ label: "Primary Mobile Number", number: "9000000001" }]);
  });

  it("keeps object-shaped mobile entries as they are", () => {
    const values = mapCustomerToFormData({
      mobile: [{ label: "Primary Mobile Number", number: "9000000002" }],
    });
    expect(values.phones).toEqual([{ label: "Primary Mobile Number", number: "9000000002" }]);
  });
});
