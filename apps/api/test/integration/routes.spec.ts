import { describe, expect, it } from "vitest";
import { listRoutes } from "../helpers/routes";

describe("route inventory", () => {
  it("lists every mounted route (snapshot doubles as documentation)", async () => {
    const routes = listRoutes();
    expect(routes.length).toBeGreaterThan(200);
    expect(routes).toContainEqual({ method: "POST", path: "/api/auth/login" });
    expect(routes).toContainEqual({ method: "GET", path: "/api/companies/public" });
    expect(routes.map((r) => `${r.method} ${r.path}`)).toMatchSnapshot();
  });
});
