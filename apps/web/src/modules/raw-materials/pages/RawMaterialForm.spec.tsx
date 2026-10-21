import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import RawMaterialForm from "./RawMaterialForm";

/**
 * H08 (INV-B10, R2P-B10): the raw material form had no HSN or GST field, so hsnCodeId and
 * gstRate were always null and purchase lines defaulted to 0% tax. The form now offers both,
 * and warns while neither is set.
 */
const store = configureStore({
  reducer: {
    stores: (state = { data: [] }) => state,
    auth: (state = { permissions: [], user: null, entitlements: null }) => state,
  },
});

const render = () =>
  renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter>
        <RawMaterialForm />
      </MemoryRouter>
    </Provider>
  );

describe("RawMaterialForm tax defaults", () => {
  it("offers an HSN code picker and a GST rate override", () => {
    const html = render();
    expect(html).toContain("HSN Code");
    expect(html).toContain("GST Rate (overrides HSN)");
  });

  it("warns that purchase lines will default to 0% tax while no HSN or rate is chosen", () => {
    const html = render();
    expect(html).toContain("default to 0% tax");
  });
});
