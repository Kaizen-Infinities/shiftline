import { describe, expect, it } from "vitest";
import {
  PERMISSION_REGISTRY,
  ALL_PERMISSION_KEYS,
  generatePermissions,
  isKnownPermission,
} from "../src/permissions";

describe("permission registry", () => {
  it("has unique module names and keys", () => {
    const modules = PERMISSION_REGISTRY.map((m) => m.module);
    expect(new Set(modules).size).toBe(modules.length);
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });
  it("generates <module>.<action> rows", () => {
    const rows = generatePermissions();
    expect(rows.length).toBe(ALL_PERMISSION_KEYS.length);
    expect(rows.every((r) => r.key === `${r.module}.${r.action}`)).toBe(true);
  });
  it("knows its keys", () => {
    expect(isKnownPermission("users.view")).toBe(true);
    expect(isKnownPermission("nope.view")).toBe(false);
  });
});
