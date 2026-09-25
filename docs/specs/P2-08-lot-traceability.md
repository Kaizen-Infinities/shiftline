# P2-08 — Lot traceability and recall (M7)

## Why

"Which customers got parts made from this bad batch of resin?" is a question the system cannot
answer today and the question every OEM and every recall turns on. The fields look like they are
there — `RawMaterial.batchNo`, `ProductionOrder.batchNo` and `lotNo` — but the chain is broken in
the middle: **`RawMaterialTransaction` has no batch column at all**, so material-lot to
production-order consumption is untraceable, and `RawMaterial.batchNo` sits on the _master_ rather
than on a stock layer, so one material cannot hold two batches at once.

Read `docs/specs/P2-00-shop-floor-foundation.md` first. This package fixes a schema defect before it
adds a feature.

## Scope

- **`MaterialLot`** (audited): the stock layer that is missing. Material, store and
  `StoreLocation` (the bin hierarchy already exists — use it, do not build another), lot number
  unique per tenant and material, supplier and GRN line of origin, received date, manufacture and
  expiry dates, quantity received, quantity remaining, and status `AVAILABLE`, `QUARANTINE`
  (P2-07's incoming inspection holds it here), `CONSUMED`, `REJECTED`.
- **Schema fix.** Add a nullable `materialLotId` to `RawMaterialTransaction` and backfill existing
  rows to a synthetic per-material "unknown" lot rather than leaving holes in the genealogy — a null
  lot in history is indistinguishable from an untraced one, and the migration must say which it is.
  New issues require a lot; historical rows keep the synthetic one.
- **`ProductLot`** (audited): the output side. Production order, lot number, quantity produced,
  produced date, the `MaterialLot` rows consumed with their quantities, and the P2-07 inspection
  that released it. This is the genealogy join and it is written as production is booked, not
  reconstructed later.
- **Dispatch linkage.** Lot on `GoodsDispatchItem` and on the sales invoice line, so a shipment
  names the lots in it. `goods-dispatch.service.ts` already surfaces the producing order's
  `batchNo` — replace that inference with the real link.
- **Forward and backward trace.** Backward: from a customer shipment to the product lots, to the
  material lots, to the supplier GRNs. Forward: from a supplier lot to every product lot, every
  dispatch and every customer. Both as a single service with a depth limit and a cycle guard.
- **Recall report:** given a material lot or a product lot, the affected customers, quantities,
  dispatch dates and invoice numbers, exportable, plus what is still in stock and what is still in
  date — the "what's still out there" answer a recall actually needs.
- **FEFO/FIFO issue suggestion** by expiry then receipt date when issuing material; a suggestion,
  not an enforcement, since the store sometimes knows better.
- Routes `/api/material-lots` CRUD, `/api/product-lots`, `/api/traceability/(forward|backward)`,
  `/api/traceability/recall`. New permission module `traceability`
  (`view, create, export`) in `permissions.ts`, feature `quality`, paths in `api-paths.ts`, keys to
  OWNER, PRODUCTION, STORES and AUDITOR (read-only) in `ROLE_DEFS`.
- Web: lot register, a trace explorer rendering the tree in both directions, the recall report, and
  a lot selector on the material issue screen. Each into `e2e/smoke.spec.ts`.

**Anchor files:** `modules/raw-material-transaction/` and `modules/inventory/` — read both before
the migration; `modules/goods-dispatch/goods-dispatch.service.ts:161-162` for the `batchNo`
inference being replaced; `modules/account-export/` for a large structured export.

## Out of scope

Serial-number traceability of individual pieces; the expiry and shelf-life semantics a food vertical
needs (V3); barcode and QR scanning for putaway and picking (WM3, Phase 3); supplier lot data
exchanged by EDI.

## Acceptance

- `traceability.spec.ts`: the backfill migration assigns every existing `RawMaterialTransaction` to
  a synthetic lot and none is left null; a new issue without a lot is refused; one material holds
  two lots simultaneously with separate remaining quantities; a production order consuming two
  material lots produces a product lot linked to both; backward trace from a dispatch reaches both
  supplier GRNs; forward trace from a supplier lot reaches every customer that received it; the
  recall report totals reconcile with the dispatch quantities and separately report stock still on
  hand; a cyclic or self-referential link cannot hang the trace; FEFO suggests the earliest expiry
  and FIFO the earliest receipt.
- **None of `inventory`, `hourly-production` or `goods-dispatch` has an integration suite.** Write
  characterisation cases for current stock movement and dispatch behaviour before the migration,
  prove them green, and keep them green after the backfill.
- New models into `AUDITED_MODELS` and `MODELS_WITHOUT_SEED_ROWS`; `npx vitest run routes leak -u`.
