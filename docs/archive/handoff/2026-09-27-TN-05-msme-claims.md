# TN-05 — MSME delayed-payment claim pack (receivable side)

Spec: `docs/research/tamil-nadu/market-and-features.md`, "(d) Prioritised feature list", item 5.

## Shipped

- **Schema** (migration `20260927020000_msme_receivable_claims`, RLS + audit triggers, all three
  models in `AUDITED_MODELS`):
  - `MsmeClaimSetting`: one row per company. RBI bank rate (defaults to 6.75%; the UI and API
    carry a "verify with RBI" note until the tenant saves its own rate), a note on where the rate
    was checked, the tenant's Udyam number and its enterprise category.
  - `MsmeRecoveryClaim` (`@@unique([companyId, claimNo])`, status
    `DRAFT/FILED/HEARING/SETTLED/WITHDRAWN`, forum `SAMADHAAN/MSEFC/DIRECT`, filedOn, referenceNo,
    hearingOn, settledOn/settledAmount, notes, as-of date and the rate used).
  - `MsmeRecoveryClaimLine`: invoice, acceptance date, invoice amount, amount paid, principal
    outstanding, limit days, due date, days late and interest, as of the claim date.
- **Calc** (`modules/msme-claims/msme-claim.calc.ts`, pure): implements MSMED Act s.15–16. The
  due date is the agreed term capped at 45 days, or 15 days with no written agreement. The agreed
  term is the invoice's own due date, else the customer's credit days. Interest is compounded
  with monthly rests at 3× the bank rate from the day after the due date. A whole month earns
  exactly annual/12; a part month earns its share of that rest period's days. Part payments
  reduce the principal from the next day, and interest stops once the principal is paid in full.
  TReDS shows as "CHECK" (issued, ≤180 days old, money still owed; buyer turnover unknown) or
  "NO". Status transitions are forward-only.
- **API** `/api/msme/receivable-claims` (`authMiddleware`, `requireFeature("accounts")`,
  `msme-claims.*`): `GET|PUT /settings`, `GET /eligible?customerId&asOf`, `GET /`, `POST /`
  (the server recomputes every line from the invoice and its dated receipts and ignores any
  figures the client sends), `GET /:id`, `PATCH /:id/status` (409 if the move goes backwards;
  FILED needs a date and a reference; SETTLED needs a date), `POST /:id/recompute`
  (not allowed once SETTLED/WITHDRAWN), and `GET /:id/pdf` (claim statement in the Samadhaan /
  MSEFC order: supplier with Udyam number, buyer, invoice table, amount claimed, basis of
  interest, declaration; rendered with `utils/pdfGenerator`). Claim numbers come from
  `documentNumberService.next("MSME_CLAIM")` (`MSC/2026-27/0001`) unless one is typed in.
  An invoice can sit on only one claim that has not been withdrawn.
- Outstanding per invoice is worked out the same way as the receivable ageing (grand total less
  the `payments` JSON on the invoice), but it uses each receipt's `paymentDate`.
- **Registries**: permission module `msme-claims` (view/create/edit/export) in the `accounts`
  feature, granted to the ACCOUNTS role; `API_PATHS.msmeClaims`; `MSME_CLAIM` document prefix.
- **Web** `/accounts/msme-claims` (`MsmeClaimsPage.tsx`) under Money → Accounts → Outstanding,
  plus a smoke line. The screen has a settings tile, stat tiles, overdue invoices with interest
  and TReDS chips, the green "Raise claim" CTA (one buyer's invoices at a time, forum picker), a
  claims list with status chips, and claim detail with recompute, a status stepper and the PDF
  download.
- **Tests**: `test/unit/msme-claim.spec.ts` has 18 worked examples: the 45-day cap, the 15-day
  default, 1687.50 for one month, 3403.48 compounded over two, 12 months, part-month, payment
  before the due date, late part payment 2728.48, and fully paid late. `test/integration/msme-claims.spec.ts`
  covers the happy path, every validation, forward-only status, recompute, the PDF, 403 for the
  production role, and cross-tenant. The leak and routes snapshots are updated.
- Verified on a running stack (own API + vite): the page renders at 1440 light and 390 dark, and a
  claim was raised, filed and exported as a real Chromium PDF.

## Cut / later

- There is no acceptance or dispute field on sales invoices, so the invoice date stands in for
  acceptance and every issued invoice counts as accepted for TReDS. The calc already takes an
  `acceptedOn`.
- No record of whether the buyer is an MSME, or of its turnover: the TReDS flag is only ever
  "check". The customer's address JSON is printed as-is on the PDF.
- Interest stops accruing once the principal is paid; capitalised interest that is still unpaid
  does not keep compounding. This is a documented simplification.
- No screenshot of the claims tab (the screenshot script cannot click tabs), and the e2e smoke
  line was added but not run here.

## Changelog

Suppliers can now see the interest their buyers owe for paying after the MSMED Act's 45-day
limit, compounded monthly at three times the RBI bank rate, and raise a claim with a ready-to-file
MSME Samadhaan statement in one click.
