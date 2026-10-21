import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import ExpensesCreate from "./Expensescreate";

/**
 * H11 (R2P-B02): the expense form had no GST fields, so every expense was saved at gross and
 * the input credit was lost. The form now offers a GST block (vendor GSTIN, rate, reverse
 * charge, input credit claim) and sends those fields with the expense.
 */
const render = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ExpensesCreate onSaveComplete={() => {}} onCancel={() => {}} />
    </MemoryRouter>
  );

describe("ExpensesCreate GST block", () => {
  it("offers vendor GSTIN, GST rate, reverse charge and input credit controls", () => {
    const html = render();
    expect(html).toContain("Vendor GSTIN");
    expect(html).toContain("GST Rate");
    expect(html).toContain("Reverse charge (vendor bills without GST)");
    expect(html).toContain("Claim input tax credit");
  });
});
