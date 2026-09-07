# P1-12 — E-way bill (FI2)

## Why

Goods worth more than ₹50,000 cannot move without an e-way bill; the bill lapses by distance
and the transporter must be able to update the vehicle on the way. Shiftline raises it from the
document (through the IRN when there is one), tracks validity and warns before it lapses.

## Scope

- `Transporter` master (code, name, transporter id GSTIN/TRANSIN, phone, email; retired, never
  deleted); `EwayBill` per movement (audited, RLS): document reference (invoice or dispatch
  challan), IRN when raised through it, EWB number/date/validity, from/to GSTIN, pincode and
  state, distance, mode, transporter, vehicle, value, request/response, Part B and extension
  history, trip sheet number, cancellation; `ConsolidatedEwayBill` (trip sheet).
- `EwayBillProvider` (`generate`, `generateByIrn`, `updatePartB`, `extend`, `cancel`,
  `consolidate`); fixture provider with NIC validity arithmetic (1 day per 200 km, 20 km for
  ODC) and the portal's refusals; GSP adapter (NIC v1.03 paths plus the e-invoice portal's
  generate-by-IRN) sharing the e-invoice credentials.
- Payload from a tax invoice (reuses the IRN payload: seller, buyer, ship-to, lines) or from a
  goods dispatch as a delivery challan for own use (value at product rate, tax by place).
- Service: one live bill per document; road transport needs a vehicle or a transporter id;
  Part B sets validity when it was empty; extension only within 8 hours either side of
  expiry; cancellation within 24 hours and not while on a trip sheet; trip sheets over live
  bills from one GSTIN; hourly sweep marks EXPIRED and warns holders of `eway-bill.update` once
  per bill 12 hours before expiry.
- Routes `/api/eway-bills` (reasons, list with `expiringWithinHours`, consolidated GET/POST,
  document lookup, generate, get, part-b, extend, cancel) and `/api/transporters` CRUD.
  Permissions `eway-bill.{view,generate,update,cancel}`, `transporters.{view,create,edit,delete}`
  (feature `gst-compliance`; Accounts and Stores roles).
- Web: `EwayBillPanel` on the sales invoice view and the goods dispatch detail,
  `/compliance/eway-bills` register with trip-sheet creation, `/settings/transporters`.

## Out of scope

Distance lookup from pincodes (the portal computes it when 0 is sent; the user can enter it);
multi-vehicle and rail/air specifics beyond the mode code; e-way bill PDF print (P1-14 delivery
challan template); the portal's "reject by recipient" flow.

## Acceptance

- `eway-bill.spec.ts`: transporter CRUD with id validation and retirement; bill through the IRN
  with payload assertions, validity, second live bill refused, Part B, extension outside the
  window refused, cancel with reason, regenerate after cancel; dispatch challan bill with tax
  split, trip sheet, cancellation of a consolidated bill refused; sweep expires and warns once,
  extension inside the window; NIC validity arithmetic.
- Leak suite sweeps the new routes; `EwayBill`, `ConsolidatedEwayBill`, `Transporter` in the
  model sweep list.
