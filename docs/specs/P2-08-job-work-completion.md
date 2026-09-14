# P2-08 — Job work completion

## Why

P1-14b shipped the challan and the return clock but left the loop open: a return challan did not
update its parent, there was no way to cancel a challan, ITC-04 had no portal JSON and sat off
the filing gate, tables 5B and 5C did not exist, and no e-way bill could be raised from a challan.
This package closes those gaps.

## Scope

- A `JOB_WORK_RETURN` challan raised with each line's `parentItemId` set records the returned
  quantity and any scrap against the parent challan's matching line in the same transaction, and
  restates the parent's status. Lines without a `parentItemId` behave as before — the separate
  `receive` endpoint remains for receipts that are not backed by a return challan document, and
  for direct supply (table 5C, recorded as a `directSupply` outcome with an invoice reference).
  Over-receipt (returned + consumed + scrap + direct supply > sent) is refused either way.
- `POST /api/job-work/challans/:id/cancel` with a reason: refused once a return has been
  recorded against the challan (its own lines, or a child return challan), goes through
  `eInvoiceService.assertDocumentCancellable("JOB_WORK_CHALLAN", id, tx)`, cancels any live
  e-way bill via `ewayBillService.cancel`, and sets `CANCELLED` — never deletes. A cancelled
  return challan reverses what it posted to its parent. The return clocks and the register skip
  cancelled challans.
- ITC-04 on the filing gate: `jobWorkService.itc04(periodKey)` now also returns table 5B (worker
  to worker, via `fromJobWorkerId`) and 5C (direct supply, from the per-line flag and invoice
  reference), plus the offline-utility JSON (schema version `GST-ITC04-2.1`, following the
  GSTR-1 builder's field-naming). `register(periodKey, actor)` hashes the JSON and registers it
  as `ITC04` on the gate; `markFiled` requires `assertSubmittable` first.
- `POST /api/job-work/challans/:id/eway-bill` raises one through `ewayBillService.generate` with
  a new `JWC` doc type built from the challan (mirrors the `CHL` builder used for goods dispatch).
- Web: cancel action and an `EwayBillPanel` on the challan view, an ITC-04 screen under
  `/compliance/gst` with JSON download and `ApprovalPanel`, and the parent's outstanding
  quantities shown when raising a return challan.

## Out of scope

Challans moving stock or valuation (P2-04); job-work invoicing; a turnover-based quarterly
ITC-04 cadence (the registry keeps the existing half-yearly `HALF_YEARLY` cadence).

## Acceptance

`job-work-completion.spec.ts`: one-step return updates the parent and closes it; over-receipt
(via the one-step path) is refused; cancel with reason; cancel refused after a return; a
cancelled return reverses the parent; cancelled challans are absent from the register and the
overdue clock; ITC-04 tables 4/5A/5B/5C from fixtures with exact values and a JSON shape
assertion; the gate refuses submission until approved and refuses a stale hash; e-way bill raised
from a challan; permission refusal; cross-tenant isolation.
