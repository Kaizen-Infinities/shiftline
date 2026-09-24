// Screenshots screens of a running web app for visual review.
//   node scripts/ui-screenshot.mjs <baseUrl> <outDir> <path> [<path> ...]
// Logs in as UI_USER / UI_PASSWORD (default: the seeded demo owner) unless the
// only path is /login. UI_WIDTH / UI_HEIGHT set the viewport (default 1440x900);
// UI_THEME=dark screenshots the dark theme.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const [, , base = "http://localhost:5173", outDir = "ui-shots", ...paths] = process.argv;
const user = process.env.UI_USER ?? "owner@demo.shiftline.local";
const password = process.env.UI_PASSWORD ?? "Demo@12345678";
const width = Number(process.env.UI_WIDTH ?? 1440);
const height = Number(process.env.UI_HEIGHT ?? 900);
const theme = process.env.UI_THEME === "dark" ? "dark" : "light";

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CI
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
    : { executablePath: "/opt/pw-browsers/chromium" }
);
const page = await browser.newPage({ viewport: { width, height } });
await page.addInitScript((t) => {
  try {
    localStorage.setItem("shiftline-theme-v2", t);
  } catch {}
}, theme);

const slug = (p) => (p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-") || "home") + `-${width}`;
const settle = async () => {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
};

if (paths.includes("/login")) {
  await page.goto(base + "/login");
  await settle();
  await page.screenshot({ path: `${outDir}/${slug("/login")}.png` });
}
const rest = paths.filter((p) => p !== "/login");
if (rest.length) {
  await page.goto(base + "/login");
  await page.locator('input[name="email"]').fill(user);
  await page.locator('input[name="password"]').fill(password);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  for (const p of rest) {
    await page.goto(base + p);
    await settle();
    await page.screenshot({ path: `${outDir}/${slug(p)}.png` });
    console.log(`shot ${p}`);
  }
}
await browser.close();
