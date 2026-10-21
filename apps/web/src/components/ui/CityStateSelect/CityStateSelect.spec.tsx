import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import CityStateSelect from "./CityStateSelect";

/**
 * H39: states and cities were fetched at runtime from a third-party host, so when that host was
 * blocked the State list was empty and customer, supplier and company forms could not be saved.
 * States now come from the bundled GST state list and the city is free text.
 */
const render = (props: Partial<React.ComponentProps<typeof CityStateSelect>> = {}) =>
  renderToStaticMarkup(
    <CityStateSelect
      stateValue=""
      cityValue=""
      onStateChange={() => {}}
      onCityChange={() => {}}
      {...props}
    />
  );

describe("CityStateSelect", () => {
  it("lists every GST state and union territory without any network call", () => {
    const html = render();
    expect(html).toContain("Tamil Nadu");
    expect(html).toContain("Andaman and Nicobar Islands");
    expect(html).toContain("Ladakh");
  });

  it("takes the city as free text so it can be entered when no city list exists", () => {
    const html = render({ stateValue: "Tamil Nadu", cityValue: "Coimbatore" });
    expect(html).toContain('name="city"');
    expect(html).toContain('value="Coimbatore"');
    expect(html).not.toContain('<select name="city"');
  });

  it("keeps the disabled read-only view for the same fields", () => {
    const html = render({ disabled: true, stateValue: "Kerala", cityValue: "Kochi" });
    expect(html).toContain('value="Kerala"');
    expect(html).toContain('value="Kochi"');
  });
});
