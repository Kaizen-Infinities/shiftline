import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/reduxHooks", () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ auth: { isLoading: false } }),
}));

import LoginPage from "./LoginPage";

/** H48: the reset page existed at /reset but nothing on the login screen linked to it. */
describe("LoginPage", () => {
  it("links 'Forgot password?' to the reset page from the password field", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );
    expect(html).toContain('href="/reset"');
    expect(html).toContain("Forgot password?");
  });
});
