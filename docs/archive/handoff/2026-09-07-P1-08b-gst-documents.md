# P1-08 part B — GST on documents

## Shipped

- Business place, place of supply and supply type on sales invoices, GRNs, sales and purchase
  returns, vouchers, dispatches, expenses and petty cash; the CGST/SGST/IGST split now comes from
  state codes (`gst.calc.ts`), not state names. HSN and cess per line, copied from the item master.
- Document numbering service (`documentNumberService.next/peek`) over `DocumentSequence`: series
  per type, branch and financial year; sales invoices and GRNs draw from it when no number is sent.
- Document types on sales invoices; a composition or unregistered company issues bills of supply
  (`BOS` series) with zero tax.
- Credit notes from sales returns and debit notes from purchase returns, mirroring the original
  document's tax nature; `PRICE_ADJUSTMENT` returns move no stock.
- Reverse charge on GRNs and expenses with RCM ledgers; GST and TDS fields on expenses and petty
  cash; postings updated for cess, split reversal on returns, ITC/blocked credit and TDS payable.
- Migration `20260907060000_gst_documents`; 150 API tests (gst-documents.spec.ts adds 9).
- Fixed the onboarding browser test: a tenant provisioned without a GSTIN now starts as "Not
  registered" (since part A), so the test picks "Regular" before filling the GSTIN.

## Half-done / known gaps

- Sales-return updates and expense updates re-post vouchers by deleting the old one (expense) or
  keeping the first (returns), as before; proper cancel/reverse flows are P1-09.
- Goods dispatches accept `businessPlaceId` in the schema but the dispatch service does not set it
  yet (the delivery challan work in P1-14 owns that).
- Reverse-charge purchase returns raise a debit note without tax (RCM tax is adjusted in GSTR-3B,
  P1-13). Imports (OVERSEAS suppliers) are treated as inter-state until P1-17.
- Invoice-level discounts still recompute `taxTotal` proportionally without rewriting the line
  split (legacy behaviour); `grandTotal` is consistent, the per-line amounts are pre-discount.
- The web forms do not yet show HSN, the split, the document type or the auto number (Part C).

## Next

- Part C: HSN and slab screens, GSTIN per place in settings and the onboarding step, invoice/GRN
  forms with HSN and the computed split, returns forms with kind and note number.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
