#!/usr/bin/env node
/**
 * Dependency audit gate for CI (P0-13). Runs `npm audit --omit=dev --json`
 * and fails on any high or critical advisory that is not listed, with a reason
 * and an expiry date, in scripts/audit-allowlist.json. Expired entries count as
 * failures, so an accepted risk has to be re-argued, not forgotten.
 *
 *   node scripts/audit-gate.mjs            # gate (exit 1 on findings)
 *   node scripts/audit-gate.mjs --report   # print everything, never fail
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const GATE_LEVELS = new Set(["high", "critical"]);
const reportOnly = process.argv.includes("--report");

const allowlist = JSON.parse(readFileSync(path.join(here, "audit-allowlist.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const allowed = new Map(allowlist.advisories.map((a) => [a.id, a]));

let raw;
try {
  raw = execFileSync("npm", ["audit", "--omit=dev", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  // npm exits non-zero when vulnerabilities exist; the JSON is still on stdout.
  raw = err.stdout?.toString() ?? "";
}
if (!raw.trim()) {
  console.error("audit-gate: npm audit produced no output");
  process.exit(reportOnly ? 0 : 1);
}
const audit = JSON.parse(raw);

const findings = [];
for (const [pkg, v] of Object.entries(audit.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via !== "object") continue; // transitive pointer, reported under its own package
    const id = (via.url ?? "").split("/").pop() || String(via.source);
    findings.push({
      pkg,
      severity: via.severity ?? v.severity,
      id,
      title: via.title,
      range: via.range,
      fix:
        v.fixAvailable && typeof v.fixAvailable === "object"
          ? `${v.fixAvailable.name}@${v.fixAvailable.version}`
          : v.fixAvailable
            ? "available"
            : "none",
    });
  }
}

let failed = false;
for (const f of findings) {
  const entry = allowed.get(f.id);
  const gated = GATE_LEVELS.has(f.severity);
  let status;
  if (!gated) status = "below gate";
  else if (entry && entry.expires >= today)
    status = `allowed until ${entry.expires}: ${entry.reason}`;
  else if (entry) status = `ALLOWLIST EXPIRED ${entry.expires}: ${entry.reason}`;
  else status = "NOT ALLOWED";
  if (gated && (!entry || entry.expires < today)) failed = true;
  console.log(
    `${f.severity.padEnd(8)} ${f.id.padEnd(22)} ${f.pkg.padEnd(24)} fix=${f.fix.padEnd(22)} ${status}`
  );
}
if (findings.length === 0) console.log("audit-gate: no production vulnerabilities reported");

for (const a of allowlist.advisories) {
  if (!findings.some((f) => f.id === a.id))
    console.log(`note     ${a.id.padEnd(22)} allowlisted but no longer reported; remove it`);
}

if (failed && !reportOnly) {
  console.error(
    "\naudit-gate: high/critical advisories without a valid allowlist entry. Fix, or add an entry with a reason and expiry to scripts/audit-allowlist.json."
  );
  process.exit(1);
}
