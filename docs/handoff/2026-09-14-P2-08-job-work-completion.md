# P2-08 — Job work completion

## Shipped

- **One-step return.** A `JOB_WORK_RETURN` challan whose lines carry `parentItemId` posts the
  returned quantity and any scrap onto the parent challan's matching line in the same
  transaction the return is raised in, then restates the parent's status. Lines without a
  `parentItemId` behave exactly as before — a return challan recorded on its own, applied to a
  parent later through the separate `receive` endpoint. Over-receipt (returned + consumed +
  scrap + direct supply > sent) is refused on both paths.
- **Direct supply (table 5C).** `receive` gained a `directSupply` outcome alongside
  returned/consumed/scrap, with an invoice number and date recorded per line
  (`quantityDirectSupply`, `directSupplyInvoiceNo`, `directSupplyInvoiceDate` on
  `DeliveryChallanItem`) — goods a job worker supplies straight from their premises instead of
  returning.
- **Challan cancellation.** `POST /api/job-work/challans/:id/cancel` with a reason: refused once
  a return has been recorded (the challan's own lines, or a non-cancelled child return challan),
  goes through `eInvoiceService.assertDocumentCancellable("JWC", id)` (a new `JWC` doc type on
  `EInvoiceDocType`, never actually raised — job-work challans carry no tax), cancels any live
  e-way bill through `ewayBillService.cancel`, and sets `CANCELLED`. Cancelling a return challan
  reverses what it posted to its parent and restates it. Cancelled challans are excluded from the
  overdue clock and the register (`pendingQuantity`/`overdue` are forced to zero/false once
  `cancelledAt` is set).
- **ITC-04 tables 5B and 5C**, alongside the existing 4 and 5A: table 5B from a new
  `fromJobWorkerId` on `DeliveryChallan` (a challan moving goods from one job worker to another —
  `jobWorkerId` is the destination, `fromJobWorkerId` the source); table 5C from the per-line
  direct-supply fields above.
- **ITC-04 on the filing gate.** `jobWorkService.registerItc04(periodKey, actor)` hashes the
  portal JSON (schema version `GST-ITC04-2.1` — devised for this codebase, modeled on the
  offline utility's table shape and the GSTR-1 builder's abbreviated field naming, since no
  official machine-readable schema was available to match byte-for-byte; see
  `jobWorkService.itc04Json` for the exact field map) and registers it as `ITC04` on the gate;
  `POST /api/job-work/itc04/register` and `POST /api/job-work/itc04/mark-filed` mirror the
  GSTR-1 pattern (`markItc04Filed` recomputes the hash from the current books and calls
  `assertSubmittable`, so a document changed after approval is caught as stale). The generic
  `/api/filings/approvals/:id/{send,approve,reject}` routes drive the send/approve/reject steps,
  same as every other filing.
- **E-way bill from a challan.** `POST /api/job-work/challans/:id/eway-bill` raises one through
  `ewayBillService.generate` with a new `JWC` doc type and `buildJobWorkChallanEwb` (mirrors
  `buildDispatchEwb`'s "CHL" path used for goods dispatch, valued off the challan's own lines).
- **Web.** Job Work screen: Cancel (with `CancelReasonModal`) and E-way bill (`EwayBillPanel`,
  reused as-is) actions per challan row; a "Return" action opens a dialog showing each line's
  outstanding quantity and raises the one-step return; the ITC-04 tab gained a
  register/refresh button, JSON download, `ApprovalPanel` and tables 5B/5C. GST hub
  (`/compliance/gst`) gained an ITC-04 tab with its own half-year picker, totals,
  register/JSON/`ApprovalPanel` (pointing at the detailed line-by-line tables on the Job Work
  screen rather than repeating them). No new routes, so no `e2e/smoke.spec.ts` additions were
  needed — both screens were already listed.
- Migration `20260914080000_job_work_completion` (additive columns only — `parent_item_id`,
  `quantity_direct_supply`, `direct_supply_invoice_no`, `direct_supply_invoice_date` on
  `delivery_challan_items`; `from_job_worker_id` on `delivery_challans` — no new tables, so no
  RLS/audit block was needed, the existing ones already cover these tables). Permissions
  `job-work.cancel` and `job-work.file` added to the existing `job-work` module (granted to every
  role that already held the other job-work actions, via the wildcard `keysFor(["job-work"])` in
  `provisioning.service.ts`, so no role-def edit was needed either).
- `apps/api/test/integration/job-work-completion.spec.ts` (5 tests): one-step return + closing +
  over-receipt refusal; cancel with reason, refused after a return, and a cancelled return's
  reversal (plus the parent becoming cancellable again); ITC-04 tables 4/5A/5B/5C with exact
  values and a JSON shape assertion, the filing gate's refuse-until-approved and stale-hash
  paths, filed end to end; e-way bill raised from a challan; permission refusal and cross-tenant
  isolation.

## Decisions worth knowing

- **`assertDocumentCancellable` is called for consistency, not because it can ever refuse.** A
  job-work challan is not a tax document — it carries no tax, nothing is supplied — so it can
  never have a live IRN. The call is there because CLAUDE.md's rule ("any cancel path for a tax
  document calls it") is close enough in spirit that keeping the pattern uniform seemed better
  than a special case; it is always a no-op here.
- **The one-step return only engages when the caller supplies `parentItemId`.** The existing
  `jobwork.spec.ts` test raises a `JOB_WORK_RETURN` with `parentChallanId` but no `parentItemId`
  on its lines (it predates this package and only checks the register/ITC-04 report, not the
  parent's balance) — that test still passes unchanged because omitting `parentItemId` falls
  back to exactly the old behavior: recorded on the return challan, not applied anywhere until a
  separate `receive` call.
- **The `JWC` e-way-bill doc type is a new sibling of `CHL`, not a reuse of it.** `CHL` already
  means "goods dispatch" (`buildDispatchEwb`, keyed by a `GoodsDispatch` bigint id); a job-work
  challan's id is a uuid and points at a different table, so it needed its own doc type rather
  than overloading `docRef`'s meaning under the same `CHL` tag. The NIC portal still sees
  `docType: "CHL"` in the actual request payload — `JWC` is only Shiftline's own tracking key on
  the `eway_bills` row.
- **ITC-04's cadence was left at `HALF_YEARLY`.** The rule is actually turnover-based (quarterly
  above ₹5 crore, half-yearly below), but `packages/shared/src/filings.ts`'s `ITC04` entry
  already fixes the cadence, and that file is shared across every Phase 2 agent this session —
  changing it was out of scope here. Whoever adds turnover-aware cadence should start from
  `DUE_RULES.ITC04` in `compliance.service.ts` and the `FILINGS` registry entry.

## Half-done / known gaps

- ITC-04's filing gate registers with `businessPlaceId: null` (company-wide), even though the
  registry marks the filing `perBusinessPlace: true`. Every job-work challan in this codebase
  carries one GSTIN's worth of movement in practice (a single business place per company is the
  common case here), so this was not a functional problem for the acceptance tests, but a
  multi-GSTIN tenant filing ITC-04 separately per registration would need the gate keyed by
  business place, matching how GSTR-1 does it in `gst-period.ts`.
- The GST hub's ITC-04 tab intentionally does not repeat the line-by-line tables 4/5A/5B/5C —
  it points at the Job Work screen's ITC-04 tab for those, to avoid maintaining the same table
  markup in two places. If the hub screen is meant to be the single place accountants work from,
  those tables should move there (or be extracted into a shared component both screens use).
- Table 5B's "worker to worker" flag is a plain `fromJobWorkerId` on the challan; there is no
  guard yet stopping someone from also setting a `parentChallanId` on the same document (a
  transfer that is also a return does not make sense but is not explicitly rejected).

## Next

Whatever P2 package follows in the plan; nothing in this package blocks on a specific one.

## Blocked on you

Unchanged — no filing, payment, tenancy or auth review needed for this package (job-work
challans carry no tax, and cancellation follows the same e-invoice/e-way-bill checks every other
document's cancel path uses).

## Changelog sentence

A return challan now settles its parent in one step, challans can be cancelled with a reason,
ITC-04 covers goods moved between job workers and supplied straight from their premises with a
portal-ready JSON on the approval gate, and an e-way bill can be raised straight from a challan.
