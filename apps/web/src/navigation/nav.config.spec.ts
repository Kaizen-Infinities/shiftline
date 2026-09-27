import { describe, expect, it } from "vitest";

import appRoutesSource from "../routes/AppRoutes.tsx?raw";

import { sidebarItems } from "../components/common/sidebar/sidebar.data";
import type { SidebarItem, SidebarSubItem } from "../components/common/sidebar/sidebar.types";
import { NAV_AREAS, NAV_SECTIONS } from "./nav.config";
import type { NavViewer } from "./nav.types";
import {
  allHubLinks,
  allNavPaths,
  allScreens,
  breadcrumbsFor,
  cleanPath,
  filterAreas,
  findAreaByPath,
  matchPath,
} from "./nav.utils";
import { buildPaletteItems, searchPalette } from "./search";

/** Every path the legacy menu linked to, including its "first permitted page" shortcuts. */
const legacyPaths = (): string[] => {
  const out: string[] = [];
  const walk = (node: SidebarItem | SidebarSubItem) => {
    if (node.path) out.push(node.path);
    if ("pathsByPermission" in node) node.pathsByPermission?.forEach((p) => out.push(p.path));
    node.children?.forEach(walk);
  };
  sidebarItems.forEach(walk);
  return [...new Set(out)];
};

/** Route patterns declared in AppRoutes.tsx, as regular expressions. */
const routePatterns = (): RegExp[] => {
  return [...appRoutesSource.matchAll(/path="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((p) => p !== "*")
    .map((p) => new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`));
};

const viewer = (permissions: string[], isSuperAdmin = false): NavViewer => ({
  can: (p) => isSuperAdmin || permissions.includes(p),
  isSuperAdmin,
});

describe("navigation config", () => {
  it("keeps every screen the legacy sidebar linked to", () => {
    const paths = new Set(allNavPaths());
    const missing = legacyPaths().filter((p) => !paths.has(p));
    expect(missing).toEqual([]);
  });

  it("covers the newest screens", () => {
    const paths = new Set(allNavPaths());
    for (const p of [
      "/exports/incentives",
      "/sales/delivery-schedules",
      "/production/order-tna",
      "/sales/asn",
      "/sales/customer-part-numbers",
    ]) {
      expect(paths.has(p)).toBe(true);
    }
  });

  it("lists no path twice", () => {
    const seen = new Map<string, number>();
    for (const p of allNavPaths()) seen.set(p, (seen.get(p) ?? 0) + 1);
    const duplicates = [...seen].filter(([, n]) => n > 1).map(([p]) => p);
    expect(duplicates).toEqual([]);
  });

  it("uses unique ids and known sections", () => {
    const screenIds = allScreens().map((s) => s.id);
    expect(new Set(screenIds).size).toBe(screenIds.length);
    const areaIds = NAV_AREAS.map((a) => a.id);
    expect(new Set(areaIds).size).toBe(areaIds.length);
    const sections = new Set(NAV_SECTIONS.map((s) => s.id));
    for (const area of NAV_AREAS) expect(sections.has(area.section)).toBe(true);
  });

  it("links only to routes that exist", () => {
    const patterns = routePatterns();
    const dead = allNavPaths()
      .map(cleanPath)
      .filter((p) => !patterns.some((re) => re.test(p)));
    expect(dead).toEqual([]);
  });

  it("points hub actions and chips at screens in the config", () => {
    const paths = new Set(allNavPaths().map(cleanPath));
    const stray = allHubLinks().filter((l) => !paths.has(cleanPath(l.path)));
    expect(stray).toEqual([]);
  });

  it("gives every area a description and every screen a one-line description", () => {
    for (const area of NAV_AREAS) expect(area.description.length).toBeGreaterThan(10);
    for (const screen of allScreens()) {
      expect(screen.description.length, screen.id).toBeGreaterThan(10);
      expect(screen.description.length, screen.id).toBeLessThan(90);
    }
  });
});

describe("permission filtering", () => {
  it("shows a user without permissions only their dashboard and account", () => {
    const areas = filterAreas(viewer([]));
    expect(areas.map((a) => a.id)).toEqual(["dashboard", "you"]);
    expect(areas[1].groups[0].screens.map((s) => s.path)).toEqual(["/notifications"]);
  });

  it("shows the platform console to super admins only", () => {
    expect(filterAreas(viewer([])).some((a) => a.id === "platform")).toBe(false);
    expect(filterAreas(viewer([], true)).some((a) => a.id === "platform")).toBe(true);
  });

  it("filters screens, create flows and hub actions by permission", () => {
    const areas = filterAreas(viewer(["payroll-run.view", "sales-invoices.view"]));
    const payroll = areas.find((a) => a.id === "payroll")!;
    expect(payroll.groups.flatMap((g) => g.screens).map((s) => s.path)).toEqual(["/payroll/run"]);
    expect(payroll.hub?.ctas?.map((c) => c.label)).toEqual(["Run Payroll"]);
    expect(payroll.hub?.chips).toEqual([]);

    const sales = areas.find((a) => a.id === "sales")!;
    const invoices = sales.groups[0].screens.find((s) => s.path === "/sales-invoices")!;
    expect(invoices.actions).toEqual([]);
    expect(areas.some((a) => a.id === "purchases")).toBe(false);
  });

  it("accepts permissionAny like the legacy sidebar", () => {
    const areas = filterAreas(viewer(["x"]), [
      {
        id: "t",
        title: "T",
        section: "home",
        icon: NAV_AREAS[0].icon,
        description: "test area",
        groups: [
          {
            id: "g",
            title: "G",
            screens: [
              {
                id: "t.a",
                title: "A",
                path: "/a",
                permissionAny: ["y", "x"],
                icon: NAV_AREAS[0].icon,
                description: "test screen",
              },
              {
                id: "t.b",
                title: "B",
                path: "/b",
                permissionAny: ["y", "z"],
                icon: NAV_AREAS[0].icon,
                description: "test screen",
              },
            ],
          },
        ],
      },
    ]);
    expect(areas[0].groups[0].screens.map((s) => s.id)).toEqual(["t.a"]);
  });
});

describe("path lookup and breadcrumbs", () => {
  it("finds the area for hubs, screens and detail pages", () => {
    expect(findAreaByPath("/hub/sales")?.id).toBe("sales");
    expect(findAreaByPath("/")?.id).toBe("dashboard");
    expect(findAreaByPath("/accounts/payable/abc")?.id).toBe("accounts");
    expect(findAreaByPath("/draft-order/edit/1")?.id).toBe("sales");
    expect(findAreaByPath("/nowhere")).toBeUndefined();
  });

  it("prefers the longest matching screen", () => {
    expect(matchPath("/machines/assignments/edit/7")?.screen.id).toBe("production.assignments");
    expect(matchPath("/machines/edit/7")?.screen.id).toBe("production.machines");
    expect(matchPath("/accounts/ledger-statement/merged")?.screen.id).toBe(
      "accounts.merged-ledger"
    );
    expect(matchPath("/salesx")).toBeNull();
  });

  it("builds breadcrumbs", () => {
    const labels = (p: string) => breadcrumbsFor(p).map((c) => c.label);
    expect(labels("/dashboard")).toEqual(["Dashboard"]);
    expect(labels("/hub/payroll")).toEqual(["Payroll"]);
    expect(labels("/sales-invoices")).toEqual(["Sales", "Sales invoices"]);
    expect(labels("/sales-invoices/create")).toEqual([
      "Sales",
      "Sales invoices",
      "New sales invoice",
    ]);
    expect(labels("/machines/assignments/edit/1")).toEqual([
      "Production",
      "Machine assignments",
      "Edit",
    ]);
    expect(breadcrumbsFor("/sales-invoices")[0].path).toBe("/hub/sales");
  });
});

describe("command palette search", () => {
  const items = buildPaletteItems(filterAreas(viewer([], true)));
  const top = (q: string, n = 3) =>
    searchPalette(items, q)
      .slice(0, n)
      .map((i) => i.title);
  const topLower = (q: string, n = 3) => top(q, n).map((t) => t.toLowerCase());

  it("finds screens by title, keyword and fuzzy initials", () => {
    expect(top("grn")).toContain("Goods received (GRN)");
    expect(top("sales inv")).toContain("Sales invoices");
    expect(top("gdisp")).toContain("Goods dispatch");
    expect(top("pf")).toContain("Statutory payroll");
    expect(top("p&l")).toContain("Profit & loss");
  });

  it("offers quick actions", () => {
    expect(top("new sales invoice", 1)).toEqual(["New sales invoice"]);
    expect(topLower("run payroll", 2)).toContain("run payroll");
    expect(topLower("pay taxes", 2)).toContain("pay taxes");
    expect(top("plan production", 2)).toContain("Plan production");
  });

  it("returns nothing for nonsense", () => {
    expect(searchPalette(items, "zzqqxx")).toEqual([]);
  });
});
