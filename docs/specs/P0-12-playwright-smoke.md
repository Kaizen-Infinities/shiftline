# P0-12 — Playwright smoke suite and CI e2e job (F1 part 2)

**Goal.** Prove on every push that a seeded owner can log in and that the twelve core screens
render against the real API without a server error, in the browser, from the same repo state
that ships.

**Layout.** `e2e/` at the repo root: `playwright.config.ts` (starts the API with `tsx` and the
web app with `vite` locally or `vite preview` in CI, one worker, traces and screenshots on
failure), `auth.setup.ts` (logs in once through the real form as `owner@demo.shiftline.local` /
`SEED_PASSWORD` and stores the session in `e2e/.auth/owner.json`), `smoke.spec.ts` (the screens
below plus a wrong-password check), `tsconfig.json` (typechecked by `npm run e2e:typecheck`;
linted with the API rules).

| Screen         | Marker text              | Screen             | Marker text            |
| -------------- | ------------------------ | ------------------ | ---------------------- |
| /dashboard     | Field Team Map           | /machines          | Machine                |
| /users         | User Management          | /production-orders | Production Order       |
| /roles         | Role Management          | /sales-order       | Sales Order Management |
| /employees     | Employee Management      | /sales-invoices    | Sales Invoice List     |
| /products      | Production Product       | /settings/company  | General Info           |
| /raw-materials | Raw Materials Management | /company/view      | Employee Code          |

Each test opens the route from the stored session, asserts it was not bounced to `/login`, waits
for the marker, lets network settle for up to five seconds, and fails on any `/api/` response
≥ 500 or any uncaught page error the screen produced. External calls the screens make (the
Indian states list on company settings) may fail offline; they log a console error and do not
fail the smoke.

**CI.** Job `e2e` (needs `test-api`, `test-web`): postgres service, role `shiftline_migrator` and
database `shiftline_e2e`, `prisma migrate deploy` + seed, `vite build` with
`VITE_API_URL=http://localhost:5000/api`, `playwright install --with-deps chromium`,
`npm run e2e:typecheck`, `npm run e2e`; the HTML report and traces are uploaded on failure.
Locally `make e2e` runs the same suite against `DATABASE_URL` (a seeded database) and reuses
already-running servers. In this sandbox `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`
points at the pre-installed browser.

**Bugs the suite exposed and fixed.** `/employees/me` answered 404 for office users without an
HR record (owners, accountants), so the profile screen never rendered and the app logged an
unhandled rejection; it now returns a minimal profile from the account (`employeeLinked: false`)
and has an integration test. The login form validates the email field, so the seed's usernames
cannot be used to sign in through the UI; the suite uses the seeded email.

**Done when.** 14 browser tests green locally and in CI; report artifact on failure; `make e2e`
documented.
