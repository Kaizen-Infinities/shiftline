import type { Router } from "express";
import { API_MOUNTS } from "../../src/routes/index.routes";

export type RouteEntry = { method: string; path: string };

const walk = (router: Router, prefix: string, out: RouteEntry[]) => {
  for (const layer of ((router as any).stack ?? []) as any[]) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods ?? {}).filter((m) => layer.route.methods[m]);
      for (const m of methods)
        out.push({ method: m.toUpperCase(), path: `${prefix}${layer.route.path}` });
    } else if (layer.name === "router" && layer.handle?.stack) {
      // Nested router inside a module: Express 5 hides the mount path, so we record it as-is.
      walk(layer.handle, `${prefix}/*`, out);
    }
  }
};

/** Every mounted API route (method + full path), from the explicit mount table. */
export const listRoutes = (): RouteEntry[] => {
  const out: RouteEntry[] = [{ method: "GET", path: "/api/" }];
  for (const { path, router } of API_MOUNTS) walk(router, `/api${path}`, out);
  return out
    .map((r) => ({ ...r, path: r.path.replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1") }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
};
