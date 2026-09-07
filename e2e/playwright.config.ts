import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke suite (P0-12). Runs against the API and web app started from
 * this repo: locally `make e2e` (needs `make db` and a seeded database), in CI
 * against the postgres service after `prisma migrate deploy` and the seed.
 *
 * Env:
 *   E2E_WEB_URL / E2E_API_URL   where the app runs (defaults: 5173 / 5000)
 *   E2E_USER / E2E_PASSWORD     seeded login (defaults: owner@demo.shiftline.local / Demo@12345678)
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   platform admin for the onboarding flow (defaults to the CI values)
 *   E2E_NO_SERVER=1             do not start servers (they are already running)
 *   E2E_WEB_COMMAND             override the web server command (CI uses vite preview)
 *   PLAYWRIGHT_CHROMIUM_PATH    use a pre-installed Chromium instead of the downloaded one
 */
const CI = Boolean(process.env.CI);
const WEB = process.env.E2E_WEB_URL ?? "http://localhost:5173";
const API = process.env.E2E_API_URL ?? "http://localhost:5000";
const webCommand =
  process.env.E2E_WEB_COMMAND ??
  (CI
    ? "npx vite preview --port 5173 --strictPort"
    : // --force: a stale pre-bundle of @shiftline/shared otherwise hides new exports locally.
      "npx vite --port 5173 --strictPort --force");

export default defineConfig({
  testDir: ".",
  outputDir: "../test-results/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: CI ? 1 : 0,
  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : [["list"]],
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    { name: "chromium", testMatch: /.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: "npx tsx src/server.ts",
          cwd: "../apps/api",
          url: `${API}/api`,
          reuseExistingServer: !CI,
          timeout: 120_000,
          env: { ...process.env, PORT: new URL(API).port || "5000" },
        },
        {
          command: webCommand,
          cwd: "../apps/web",
          url: WEB,
          reuseExistingServer: !CI,
          timeout: 180_000,
        },
      ],
});
