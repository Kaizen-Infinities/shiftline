import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import WastageStockCreate from "./WastageStockCreate";
import WastageStockEdit from "./WastageStockEdit";

/**
 * C14: these screens used to show a form whose submit only toasted "created successfully"
 * and navigated away; nothing reached the API. Stock changes go through other flows, so the
 * screens must not offer a save at all and must say where stock is recorded instead.
 */
const render = (node: React.ReactElement) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe.each([
  ["create", WastageStockCreate],
  ["edit", WastageStockEdit],
])("wastage stock %s screen", (_name, Page) => {
  it("offers no form or submit control, so it cannot report a save that did not happen", () => {
    const html = render(<Page />);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain("created successfully");
    expect(html).not.toContain("updated successfully");
  });

  it("says where stock changes are recorded and links to those screens", () => {
    const html = render(<Page />);
    expect(html).toContain("Stock changes are recorded through GRN / production / adjustments");
    expect(html).toContain('href="/production-wastages"');
    expect(html).toContain('href="/inventory/stock-adjustments"');
  });
});
