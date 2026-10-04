# Session swaps — no calls or cached rows across identities

**Changelog:** Switching between a platform admin and a tenant (acting as an owner, or
stopping) no longer flashes the previous screen or calls it with the wrong account, and one
company's cached lists can no longer show under another's.

> Tenancy and auth change: per CLAUDE.md this PR needs the named human approver.

## Before

- **Stop impersonating** swapped in the admin token, reloaded the user and then navigated to
  `/platform`. Two problems came from that order:
  - The router commits navigation as a transition, after ordinary state updates, so the tenant
    dashboard re-rendered under the admin session for about 300 ms. `DashboardPage` shows every
    tile to `isSuperAdmin`, so the inventory and workforce tiles remounted and called
    `/api/raw-materials`, `/api/products`, `/api/shifts` and others without a tenant. Each
    returned 500.
  - This failed `e2e/platform.spec.ts` › "the console lists tenants and a platform admin can act
    as a tenant owner" on every run, including on commits before the dashboard work.
- **Client caches weren't tied to an identity.** List and detail caches (memory and
  sessionStorage), the Redux data slices and RTK Query were never cleared on sign-out or on
  either impersonation switch, and their keys (`dashboard:summary`, …) are not per tenant. After
  acting as tenant A and then tenant B, or after signing out and in as another company in the
  same tab, B's screens could show A's cached rows until the cache went stale.

## Now

- **`AuthState.identity`** is `"userId|companyId|impersonationId"`, read from the access token
  (null when signed out). It is set by `setAccessToken` and cleared everywhere the token is.
- **`app/sessionReset.ts`** is a listener middleware. When `identity` changes to one this tab
  has not cached for, it:
  - clears every list and detail cache (`clearAllListCaches`, `clearAllDetailCaches`), in
    memory and in sessionStorage;
  - resets every Redux slice except `auth` (`session/reset`, handled in `app/store.ts`);
  - resets the RTK Query cache.

  The identity is also kept in sessionStorage, so a reload whose refresh cookie belongs to
  another user (signed in from another tab) cannot reuse this tab's rows.

- **`AuthState.sessionSwitchTarget`** holds the path being switched to. `beginSessionSwitch(path)`
  is dispatched before the token changes, and `ProtectedRoute` renders "Switching session..."
  until the router actually shows that path, then ends the switch. It also holds off
  `fetchCompany` meanwhile. Both switches use it: `TenantDetailPage` "Act as owner" switches to
  `/dashboard`, and the impersonation banner's Stop switches to `/platform`.

## Also in this change

- **`DataTable` `sourceRowCount`.** A screen that filters on the client passes the pre-filter
  row count. A failed refresh with loaded rows then shows the stale notice and the normal "no
  matches" message, not "Couldn't load this list". Every client-filtering list passes it.
- **Empty env values count as unset.** `parseEnv()` in `apps/api/src/config/env.ts` treats an
  empty value as unset, so a `.env` copied from `.env.example` validates. Required variables left
  empty still fail. `ADMIN_PASSWORD` in the example is quoted, because dotenv reads an unquoted
  `#` as a comment and cut the password to `DevAdmin`. Unit tests are in `test/unit/env.spec.ts`.
- **Visual-language line.** The line in `docs/specs/P1-UI-remake.md` now says it was superseded
  by UI v2.
- **Hand-off correction.** "by Applied Softwares" is the intentional maker credit from the UI v2
  branding commit; the colorize note wrongly called it a probable mistake and is corrected.

## Checks

- **New e2e test.** `e2e/platform.spec.ts` › "stopping impersonation makes no tenant-scoped calls
  and drops the tenant's cache" records every `/api` request after Stop. It fails if any goes
  outside `/api/auth` and `/api/platform`, or if any list or detail cache survives. With the web
  change stashed it fails on the four inventory calls; with it, it passes.
- **Full smoke suite.** All 61 tests pass locally. The previously failing platform test passed
  three runs in a row.
- **On screen.** OEE thresholds were checked on the production and OEE dashboards with stubbed
  data (93%, 72%, 40% and no data), in light and dark, at 1440 px and 390 px.
- **Local.** Web typecheck and unit tests pass, and there are no new lint warnings.

## Not done

- A tenant-scoped API route still answers a tenantless call with 500 rather than a 4xx. With this
  change the web app no longer makes such calls, but the API behaviour is a tenancy/auth decision
  for the named approver.
- `PRODUCT.md` says the shell carries no brand beyond "Shiftline", which the maker credit
  contradicts. The owner should decide which one is right.
