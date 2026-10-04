# TN-06 — Multi-step job-work process routes

Spec: `docs/research/tamil-nadu/market-and-features.md`, "(d) Prioritised feature list", item 6
(Tiruppur knitting → dyeing → compacting → printing → stitching; Coimbatore casting → fettling →
machining). Builds on the P2-08 job-work module without changing it.

## Shipped

- **Schema** (migration `20260927050000_process_routes`, RLS `tenant_isolation` + `platform_bypass`,
  audit triggers; all four models in `AUDITED_MODELS`):
  - `ProcessRoute`: `@@unique([companyId, routeCode])`, name, description, optional `Product`,
    `active`. Never deleted once a lot uses it (deactivate).
  - `ProcessRouteStep`: `@@unique([routeId, seq])`, name (presets or free text, stored upper case),
    `mode IN_HOUSE | JOB_WORK`, optional default `JobWorker`, `lossNormPct`, `uomIn` / `uomOut`,
    optional `conversionFactor` (units out per unit in, e.g. 1 KG → 4 PCS).
  - `LotRouteProgress`: `@@unique([companyId, lotNo])`, route, optional product, input qty in the
    first step's unit, start date, `currentStepSeq`, status `OPEN | COMPLETED | CANCELLED` (+ reason).
  - `LotStepMovement`: step, `OUT | IN`, qty in the step's unit, date, job worker, optional
    `DeliveryChallan` link, `closesStep` (on IN: the rest is process loss).
- **Calc** (`process-route.calc.ts`, pure, thousandths): unit conversion, per-step sent / received /
  expected / loss % / yield, over-norm flag (judged once the step is done), cumulative yield vs the
  norms' yield, where the lot is (in hand waiting for step n, at job worker X, on the floor,
  finished), close blockers; `checkRouteSteps` (units chain, in-house has no worker, factor 1 for a
  unit-keeping step); `checkMovement` (steps in order, only what is available, no return beyond
  sent × factor + `GAIN_TOLERANCE_PCT` 2 %, done steps take nothing, dates follow the flow, pick
  the worker when two hold it). Two templates: `TIRUPPUR_KNITWEAR`, `COIMBATORE_CASTING`.
- **API** behind `authMiddleware`, `requireFeature("production")`, `process-routes.*`:
  - `/api/process-routes`: `GET /options` (active job workers, products, step names, templates),
    `GET /`, `POST /`, `GET|PATCH /:id` (name, description, product, active), `PUT /:id/steps`
    (409 once a lot uses the route), `DELETE /:id` (409 "deactivate instead" once used).
  - `/api/process-lots`: `GET /board` (counts, WIP per job worker, open lot cards), `GET /` (status,
    route, `q`), `POST /`, `GET /:id` (with movements), `POST /:id/movements`,
    `DELETE /:id/movements/:movementId` (latest only), `POST /:id/close` (every step done),
    `POST /:id/cancel` (reason), `GET /challan-options` (job-work challans for the picker, so the
    screen does not need `job-work.view`).
  - Challan links (job-work steps only): tenant-checked, not cancelled, `JOB_WORK_OUT` for OUT,
    `JOB_WORK_RETURN` (or the outward challan) for IN, same job worker, same date, not linked twice
    to the same step, and lots cannot book more than the challan carries when its lines share the
    unit. The challan itself is only read; its return flow (P2-08) is untouched (the spec proves a
    return challan still closes its parent).
  - Movements take a row lock on the lot, so two people cannot both send the last kilo.
- **Registries**: permission module `process-routes` (view/create/edit/delete) in the `production`
  feature; PRODUCTION gets all, STORES view/create/edit; `API_PATHS.processRoutes`, `processLots`.
- **Web** (Production → Lot board `/production/lots`, Process routes `/production/process-routes`):
  - Lot board: stat tiles (open, at job workers, over loss norm, completed), WIP-at-job-workers chips,
    Open / Completed / Cancelled tabs, a card per lot with the step chain (state-coloured chips,
    qty in → out, loss vs norm chip, red when over), "Where it is", yield vs norm, green
    **Record movement** (step, send / receive, qty with available / expected shortcut, date, job
    worker, challan picker, "this completes the step"), movement history with undo on the latest,
    close and cancel lot; "New lot" form.
  - Process routes: route tiles with ordered steps (mode, units, factor, norm, default worker),
    edit / deactivate / delete-if-unused, editor with the two templates, step presets, reorder,
    unit chaining and a factor field shown only when the unit changes; steps read-only once used.
  - Sidebar entries, hub chips and command palette; two smoke lines. Checked at 1440, 390 and dark.
- **Tests**: `test/unit/process-route.spec.ts` (KG→PCS, loss vs norm, yield, location, every
  movement rule); `test/integration/process-routes.spec.ts` (four-step route happy path with
  dyeing on a real outward + return challan, every validation rejection, used-route lock,
  undo / cancel, challan picker, 403 for accounts and stores-delete, foreign job worker / challan /
  product / route refused, foreign company sees none). Routes and leak snapshots updated; the four
  models are seedless in `leak.spec`.

## Cut / later

- Recording a movement does not raise the challan; the user raises it in Job work and links it.
  "Raise challan from this movement" is the natural next step.
- Movements do not move stock or value (same as challans, P2-04).
- A step's loss and norm are compared in the step's own units; no costing of the loss.
- No split or merge of lots; one route per lot; no editing a used route's norms (make a new route).
- The gain tolerance (2 %) is a constant, not per step.

## Changelog

Knitwear and foundry units can now set up a process route (knitting → dyeing → printing →
stitching, casting → machining), follow every lot through it on a lot board that shows which job
worker holds how much, and see the loss at each step against its norm.
