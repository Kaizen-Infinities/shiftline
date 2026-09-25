# Page patterns for UI v2 — guide for the page agents

Companion to `docs/specs/UI-v2.md`: how to compose dense ERP screens from the `.sl-*` blocks so they
stay airy (the RazorpayX-style concept art) yet work for a Tally-trained accountant and a supervisor
on a cheap Android phone. Reuse what exists: `DataTable` (`density`, `emptyMessage`, `ariaLabel`),
`ColumnToggle`, `FilterPopover`, `ExportCSVButton`, `WhatsappButton`, `Calculator` (Alt+C),
`useFormShortcuts` (F2/F9), and the Enter-to-next journal grid in `JournalEntryAddPage.tsx`.

## (a) Principles

1. **One green pill per screen.** Exactly one `.sl-cta`, and its label is the domain verb for
   what the button actually does ("Run Payroll", "New Invoice", "Post Voucher", "Plan Week").
   Every other action is a `.sl-btn`, an icon pill or a "…" menu item. On a list page the CTA
   creates. On a document page it moves the document to its next state.
2. **Airy around the edges, dense in the middle.** Whitespace goes between tiles: 24px page
   gutter (16px on mobile), 20–24px tile padding, 16–24px gaps. Inside tables, keep rows at 52px
   by default with a 40px compact toggle (`density="compact"`, remembered per user) on accounts,
   stock and reports, in line with the usual 48–56px standard and 40–44px compact.
3. **Numbers are the content.** Use `tabular-nums`, right-align them, and format rupees in en-IN
   (₹12,34,567.00). Balances carry Dr/Cr. Reports show negatives in parentheses. Never draw a
   money column in a colour that means nothing.
4. **Tally parity where accountants live.** Voucher and document entry must work without a
   mouse: Enter moves to the next field, Esc goes back, Alt+C opens the calculator, F2/F9 saves
   (the current registry), Ctrl+Enter saves on new screens, and Ctrl+D removes a line (Tally).
5. **Chips are the filter language.** Put status and type filters in a row of toggle chips
   (`button.sl-chip` with `aria-pressed`) that show counts, for example "Overdue 12". Quick
   chips apply instantly. Advanced conditions go in `FilterPopover` behind an explicit
   **Apply** button.
6. **Status is text plus colour, never colour alone.** Use `.sl-chip-success|warning|danger|muted`
   with a word ("Posted", "Draft", "Cancelled", "IRN generated").
7. **Progressive disclosure.** Rarely used fields sit under a "More details" disclosure. Derived
   values (the GST split, place of supply, HSN rate) show read-only with a one-line "why" hint,
   because the server derives them.
8. **Skeletons, not spinners.** Use `.sl-skeleton` slabs shaped like the final layout: a table
   gets 6 row slabs and a stat tile gets a label slab plus a big-number slab. Use a spinner only
   inside a button that is working ("Saving…").
9. **Two kinds of empty.** When there is nothing yet, show one friendly line and the CTA. When
   filters return nothing, say so and offer a "Clear filters" `.sl-btn`. The two must never look
   the same.
10. **Errors that help.** Put the message under the field and link the summary at the top of the
    form to the fields. A failed load shows an error tile with Retry and the request id in
    `.sl-muted` small text. Never show raw server text.
11. **Built for the shop floor.** Any screen used on the floor gets targets of at least 48px
    (64px for primary actions, which may be tapped with gloves), a single column,
    `inputMode="decimal"` keypads, steppers and a sticky bottom action. Scanning or picking beats
    typing.
12. **Share where Indian businesses share.** Every document detail page (invoice, PO, payslip,
    challan, quotation) offers WhatsApp share, PDF download and Print as `.sl-btn` pills. Vyapar
    has made WhatsApp the default channel for bills.
13. **Tokens only; two themes; two widths.** Never hard-code a colour. Check every screen at
    1440px and 390px in light, with a quick pass in dark.
14. **Ready for Tamil.** Never fix the width of labels, buttons or chips. Let chips wrap, allow
    for 40–60% longer strings, and keep text out of images. When a Tamil string is shown, set
    `lang="ta"`, use Noto Sans Tamil as the fallback and a line-height of about 1.7.
15. **The tenant, not the product.** Company names, logos and GSTINs come from the tenant record.
    "Riya" in the welcome is the signed-in user's first name.

## (b) Recipes by screen type

### 1. List / table

- **Layout.** A header row holds the `.sl-h1` and a count line in `.sl-muted` ("248 invoices ·
  FY 2026-27"), with the `.sl-cta` on the right and secondary `.sl-btn`s (Export, Import). Under
  it goes a toolbar: status chips (All · Draft · Unpaid · Overdue · Paid), then a search
  `.sl-input` (max 320px, placeholder "Search number, party, GSTIN"), a period picker defaulting
  to the current FY, a `FilterPopover` and a `ColumnToggle`. Then comes the table in one
  `.sl-tile` with `overflow-hidden`.
- **Table.** Headers use `bg-card-2`, 12–13px `text-ink-muted` (not subtle) with sentence-case
  labels, and a sticky position (`sticky top-0`). The first column is the identifier (number or
  code) in `text-accent`, which links to the detail page. The party column shows the name with the
  GSTIN or city underneath in `.sl-muted`. Money is right-aligned in tabular numerals. Status is
  a chip. Row actions sit in a trailing "…" menu. Keep at most 2 visible icon pills, each with an
  `aria-label`. Rows are divided by a hairline in `border-line-soft`.
- **Bulk actions.** A checkbox column appears only if the list has bulk actions. When rows are
  selected, the toolbar swaps for a bar reading "3 selected · Export · Generate IRN · Cancel ·
  Clear". Destructive bulk actions need a modal that states the count.
- **Density.** Rows are 52px by default, or 40px in compact. Paginate at 25/50/100, or use
  "Load more" on mobile. Keep the totals row (sum of the money columns for the current filter)
  sticky at the bottom for money lists.
- **Keyboard.** `/` focuses search, ↑/↓ move the row focus, Enter opens a row, Ins creates
  (existing), and F5 refreshes the data (existing).
- **States.** Loading shows 6 skeleton rows. Empty shows an illustration-free line plus the CTA.
  A filtered empty shows "No invoices match these filters" and "Clear filters". An error shows an
  error tile with Retry.
- **Mobile (<768px).** Each row becomes a stacked card tile: identifier and status on line 1,
  party on line 2, amount right-aligned and large. Filter chips scroll horizontally, and the CTA
  becomes a full-width pill fixed above the tab bar.

### 2. Create / edit form

- **Layout.** A header holds the title ("New customer") and a back link. Sections are separate
  `.sl-tile`s, each with an `.sl-h2` and an optional one-line `.sl-muted` description. Labels
  sit above inputs and fields run in two columns from 768px up. Put the fields that belong
  together on one row (City · State · PIN). A sticky footer holds Cancel (`.sl-btn`) and
  Save (`.sl-cta`), plus "Save & new" (`.sl-btn`) on master data.
- **Fields.** Use `.sl-input` at 44px tall. Mark the required ones with a trailing "*" and the
  text "Required" for screen readers. Input rules:
  - GSTIN: uppercase with `maxLength={15}`, validated with `isValidGstin`. On success, a chip
    under the field shows "33 · Tamil Nadu", and State and PAN are filled from it.
  - Phone: `type="tel"`, shown as "+91 98765 43210".
  - PIN: 6 digits with `inputMode="numeric"`.
  - Money: `inputMode="decimal"`, right-aligned, with a ₹ prefix inside the input.
- **Keyboard.** Enter moves to the next field in data-entry forms (Tally habit). Textareas keep
  Enter, and Ctrl+Enter or F2 saves. Esc with unsaved changes asks for confirmation.
  `useFormShortcuts({})` already wires F2/F9.
- **States.** Validate on blur and again on submit. Scroll to and focus the first error. The Save
  button shows "Saving…" and is disabled while pending. A toast confirms success, then the app
  goes to the detail page. Guard unsaved changes on navigation.

### 3. Voucher / document entry with line items (invoice, PO, GRN, journal, payment)

- **Layout (≥1024px).**
  - Top `.sl-tile`, "Party & terms": Party (search), Date (defaults to today; the FY and locked
    period are shown next to it), Number (preview "Assigned on save", because the server's
    `documentNumberService` owns it), Place of supply, and Branch.
  - Middle `.sl-tile`, the **line grid**. It uses spreadsheet-style cells without boxes; the
    focused cell gets the focus ring. Columns: # · Item (search) · HSN (auto, editable) · Qty ·
    UOM · Rate · Disc % · Taxable · GST % · Amount. There is always one blank row at the bottom,
    and "+ Add line" is a text button, not a CTA.
  - Right rail, or a bottom tile on smaller screens, for **totals**: Taxable, CGST/SGST or IGST
    (derived and read-only, with a hint such as "Intra-state: TN → TN"), Round-off and Grand
    total in `.sl-h1` size with the amount in words ("Rupees Twelve Lakh …"). For journals,
    show Dr total, Cr total and "Difference ₹0.00". The difference turns into a `.sl-chip-danger`
    when it is not zero, and Save stays disabled until it is.
  - Narration goes under the grid; a sticky footer holds Cancel, "Save draft" (`.sl-btn`) and
    the CTA ("Save invoice" or "Post voucher").
- **Keyboard (must).** Enter moves to the next cell, and from the last cell of a row to the
  first cell of the next row. Enter on an empty item cell jumps to Narration and then to Save,
  which is Tally's flow. Shift+Enter/Shift+Tab go back · Ctrl+D deletes the line · Alt+C opens
  the calculator (its result pastes into the amount cell) · pickers open on typing, ↑/↓ + Enter
  pick, with the hint "Alt+N creates a new ledger/item" · Ctrl+Enter or F2 saves.
- **Density.** Grid rows are 40px, with 14px text and tabular numerals. This is the one place
  where compact is the default.
- **Mobile.** Lines become cards (Item, Qty × Rate = Amount) with an "Add line" sheet, and the
  totals bar sticks to the bottom above the Save pill.
- **States.** A locked period shows a warning tile above the grid ("Books closed up to 31 Mar
  2026 — pick a later date") and disables Save. Line errors are marked in the cell and listed in
  the summary.

### 4. Detail / view

- **Summary tile.** Number in `.sl-h1`, status chips (Posted · IRN generated · E-way active),
  party, date and the key figures (Total, Balance due) in large tabular numbers. The CTA is the
  next step: "Record Payment", "Generate IRN" or "Convert to Order". Secondary `.sl-btn`s: Share
  (WhatsApp), PDF, Print, Edit (only while the document is in draft). A "…" menu holds Duplicate
  and Cancel document. Cancel uses a `.sl-btn-danger` in a modal with a reason, and a document is
  never deleted.
- Tabs are a chip row (`role="tablist"`): Details · Lines · Payments · E-invoice · Activity, with
  content in tiles beneath. Activity is a Stripe-style timeline: who, what, when, request id.
- **States.** Loading shows a skeleton summary tile plus 3 slabs. A 404 or foreign tenant shows a
  friendly "Not found" tile with a "Back to list" link.

### 5. Report (filters + export)

- **Filter bar.** A tile with an FY picker (default: current FY), preset chips (This month · Last
  month · Q1–Q4 · This FY · Last FY · Custom), Branch and Party pickers and a "Compare with
  previous period" toggle. Chips apply instantly; heavy reports use **Run report**
  (`.sl-btn-blue`). A report has no green CTA.
- **Output.** A strip of 3–4 stat tiles, then the table: indented collapsible groups, subtotal rows
  in `bg-card-2` at weight 600, a grand total with a top border. Enter drills down (ledger →
  vouchers → document), as in Tally.
- **Export.** Excel, PDF, Print and WhatsApp PDF sit as `.sl-btn` pills at the top right, and
  Ctrl+Shift+E exports (existing). Exports use the same filters and state them in the file header
  ("Trial Balance · FY 2026-27 · as of 24 Sep 2026").
- **Print.** Print stylesheet: no chrome, black on white, repeat the table head on each page.
- **Density.** Compact rows at 40px. Right-align every number, and show zero as "—" in report
  bodies.

### 6. Settings

- **Layout.** A left sub-navigation of `.sl-nav-item` rows on desktop, or a chip row on mobile,
  with one `.sl-tile` per section on the right. Each section is a short form with its own "Save
  changes" (`.sl-cta`) that appears only when the section is dirty, so there is no global CTA.
- Toggles (`ToggleSwitch`) take effect only after Save, except where they say "Applies
  immediately". Dangerous settings go in a separate "Danger zone" tile with `.sl-btn-danger`.
- Secrets (GSP and SMTP credentials) show only as "•••• set on 12 Aug" with a Replace button.
  They are never shown again.

### 7. Wizard (onboarding, payroll run, GST filing, year-end)

- A stepper at the top: numbered pills. Done steps get a check chip, and the current step uses
  `bg-nav-active`. Steps are clickable backwards only. There is one step per tile with a
  one-sentence goal.
- The footer holds Back (`.sl-btn`) and Next or the final verb (`.sl-cta`: "Finalize Payroll",
  "Approve Closing"). The final step is a read-only review with totals and warnings.
  Irreversible actions (execute payroll, file return, approve closing) need a confirm modal that
  restates the amounts.
- Progress saves on the server per step, so the user can "Resume where you left off".

### 8. Mobile / shop-floor entry (shift execution, hourly reports, wastage, attendance, EOD stock)

- **Layout.** A single column. The context header shows the machine, shift and operator as large
  chips, and the big figures sit on top (Target 1,200 · Done 860 · 72%).
- **Actions.** The primary action is `.sl-cta-lg`, full width and at least 64px ("Start
  Production" / "Log Hour"). Stop and Pause are `.sl-btn` at 56px. Qty steppers (− / number / +)
  have 56px buttons and `inputMode="numeric"`.
- **Pickers.** Pick from 2-column tiles (machines, reasons) rather than dropdowns. Show recent
  choices first.
- **Performance.** Assume a ₹8–12k Android on 4G: lazy-load the route, aim for under 150 kB of JS,
  no heavy charts, no hover-only affordances, text ≥16px and numbers 20–28px.
- **Feedback.** An instant optimistic confirmation ("Logged 120 pcs · 10:00–11:00") with Undo
  for 5s. An offline or error banner keeps the entry on screen. Never lose a typed number.

## (c) Per-module notes (primary CTA · chips on key screens)

| Group                           | Screen                    | Primary `.sl-cta`                    | Chips / notes                                                                                                                      |
| ------------------------------- | ------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts**                    | Hub                       | New Voucher                          | Payment · Receipt · Journal · Contra · Petty cash                                                                                  |
|                                 | Voucher list              | New Voucher                          | Posted · Cancelled; type chips. The row menu has "Cancel (reverse)", never Delete                                                  |
|                                 | Books / ledger            | — (report)                           | Day book · Cash · Bank · Ledger; FY picker; Dr/Cr balance column                                                                   |
|                                 | Receivable / payable      | Record Receipt / Record Payment      | Ageing 0–30 · 31–60 · 61–90 · 90+ with counts; MSME 45-day chip-warning                                                            |
|                                 | Bank reconciliation       | Match Entries                        | Unmatched · Matched · All                                                                                                          |
|                                 | TB / P&L / BS / Cash flow | — (Run report)                       | Period presets; Schedule III toggle; Export                                                                                        |
|                                 | Year-end                  | Prepare Closing → Approve Closing    | Wizard; show the freeze date                                                                                                       |
| **Payroll / HR**                | Payroll dashboard         | Run Payroll                          | TDS · PF · ESI · PT · LWF (the concept art). Month chip; "Pay Taxes" only if the button really pays, otherwise "Generate Challans" |
|                                 | Payroll run               | Finalize Payroll                     | Wizard: Attendance → Review → Finalize → Payslips                                                                                  |
|                                 | Attendance                | Mark Attendance                      | Present · Absent · Leave · OT · Half-day with counts; month picker; mobile grid                                                    |
|                                 | Employees                 | Add Employee (or Invite)             | Active · On notice · Exited; department chips                                                                                      |
|                                 | Leave / advances / fines  | Apply Leave / New Advance / Add Fine | Pending · Approved · Rejected                                                                                                      |
|                                 | Payslip                   | —                                    | Share WhatsApp · PDF; statutory register chips                                                                                     |
| **Sales / purchases**           | Sales invoices            | New Invoice                          | Draft · Unpaid · Overdue · Paid · Cancelled; IRN and E-way status chips                                                            |
|                                 | Quotation / order         | New Quotation / New Order            | Detail CTA: Convert to Order → Create Invoice                                                                                      |
|                                 | Dispatch                  | Create E-way Bill (detail)           | Pending · In transit · Delivered                                                                                                   |
|                                 | Purchases / GRN           | New Purchase Order / Receive Goods   | Open · Partially received · Closed                                                                                                 |
|                                 | Customers / suppliers     | Add Customer / Add Supplier          | Grade and type chips; the GSTIN is under the name                                                                                  |
|                                 | Returns                   | New Credit Note / Debit Note         | Returns raise notes. Say so in the empty state                                                                                     |
| **Production / planning**       | Production orders         | New Production Order                 | Planned · Running · On hold · Done; order TNA as a timeline                                                                        |
|                                 | Weekly schedule           | Plan Week                            | Machine chips; a week strip of day chips                                                                                           |
|                                 | Daily plan                | New Daily Plan                       | Shift chips (A · B · C); machine tiles with target and done                                                                        |
|                                 | Shift execution           | Start Production (mobile recipe)     | Machine · shift · operator chips; Stop as `.sl-btn-danger`                                                                         |
|                                 | Hourly reports / wastage  | Log Hour / Record Wastage            | Reason chips; mobile recipe                                                                                                        |
|                                 | Machines / assignments    | Add Machine / Assign Operator        | Running · Idle · Down                                                                                                              |
| **Inventory**                   | Stock                     | New Adjustment (or Receive Goods)    | Raw material · Finished · Wastage · by store; "Low stock" chip-warning                                                             |
|                                 | Stores / store types      | Add Store                            | Active · Inactive                                                                                                                  |
|                                 | EOD stock                 | Close Day                            | A per-item count list, mobile first                                                                                                |
| **GST / compliance / settings** | GST returns               | Prepare GSTR-1 (then File)           | GSTR-1 · GSTR-3B · GSTR-2B · ITC · HSN; a month and FY period chip                                                                 |
|                                 | E-invoices                | Generate IRN (bulk-capable)          | Pending · Generated · Cancelled · Failed                                                                                           |
|                                 | E-way bills               | Generate E-way Bill                  | Active · Expiring < 24h (warning) · Expired · Cancelled                                                                            |
|                                 | Filing approvals          | Approve Filing                       | Pending you · Approved; named approver chip                                                                                        |
|                                 | Settings index            | —                                    | Hub tiles: Company · Branches · GST · Users · Roles · Email · SMS · WhatsApp                                                       |
|                                 | Users / roles             | Invite User / New Role               | Active · Invited · Disabled                                                                                                        |

## (d) Indian formatting helper spec (`apps/web/src/utils/format.ts`, one module for every page)

```ts
// Money arrives as Decimal strings. Never parseFloat for maths; Intl formats strings exactly (Node/Chrome ≥ 106).
formatINR(v: string | number | null | undefined, o?: { decimals?: 0 | 2; symbol?: boolean;
          style?: "plain" | "accounting" | "drcr" }): string
//  "1234567.5"              → "₹12,34,567.50"  (Intl.NumberFormat("en-IN",{style:"currency",currency:"INR"}))
//  -1234, accounting        → "(₹1,234.00)"    (currencySign:"accounting")
//  -1234, drcr              → "₹1,234.00 Cr"   (positive = Dr; ledgers and balances)
//  null / undefined / ""    → "—"
formatINRCompact(v): string  // tiles, charts and chips; put the full value in title/aria-label
//  < 1,00,000  → full: "₹95,000"             (Indian readers don't use "K")
//  ≥ 1 lakh    → "₹12.35L" ;  ≥ 1 crore → "₹1.23Cr"   (en-IN compact, maximumFractionDigits 2)
formatQty(v, uom?, dp = 3)   // "1,250.000 kg" — the en-IN grouping applies to quantities too
fyOf(d: Date): { start: Date; end: Date; label: "FY 2026-27"; short: "FY26-27" }
//  In Asia/Kolkata: month ≥ April → FY starts this year, else last year. 1 Apr 2026 – 31 Mar 2027.
fyQuarter(d) → "Q2 FY26-27"  (Q1 = Apr–Jun) ;  gstPeriod(d) → "Sep 2026" (API code "092026")
formatDate(d) → "24 Sep 2026" (en-IN, 2-digit day, short month; matches utils/dateUtils)
formatGstin(g) → uppercase, no spaces; pair it with a state chip "33 · Tamil Nadu" from gst-states
formatPhone("9876543210") → "+91 98765 43210"
amountInWords(v) → "Rupees Twelve Lakh Thirty-Four Thousand … and Fifty Paise Only"
```

Rules:

- Always use `tabular-nums`. The ₹ sign goes before the number with no space.
- Accept dd/mm/yyyy typed input and never mm/dd.
- Pickers default to the current FY, and the period presets follow the FY, not the calendar
  year.
- `ta-IN` groups the same way (verified), and business UIs keep Western digits.
- Replace the ad-hoc `toLocale*String("en-IN")` calls, which appear in about 85 files today.

## (e) Accessibility checklist (per screen, before the PR)

- [ ] One `h1` per page, `h2` per tile; landmarks `nav`, `main`, `header`; `lang` set (and
      `lang="ta"` on Tamil fragments).
- [ ] Icon-only pills have an `aria-label`; "…" menus are buttons with `aria-haspopup`, arrow keys
      and Esc.
- [ ] Toggle chips use `aria-pressed`, tab chips `role="tab"` + `aria-selected`, the active nav row
      `aria-current="page"`.
- [ ] Every input has a visible `<label for>`; errors use `aria-describedby` + `aria-invalid`, and
      the error summary gets focus on submit.
- [ ] Visible focus on everything (grid cells and chips too); focus is trapped only in modals and
      returns to the trigger on close.
- [ ] Text ≥4.5:1 (table below; no text in `ink-subtle` until it is fixed). Input borders ≥3:1:
      `--color-line` #dbe5ec on white is 1.28:1, so add a stronger input border (≈#7f94a6 light,
      #5a7591 dark, both ≥3:1) or rely on a filled background plus a label.
- [ ] Status never by colour alone; targets ≥44×44px (≥64px shop-floor primary) with 8px gaps.
- [ ] Real `<table>` with `<th scope>`, an `aria-label` (DataTable `ariaLabel`) and `aria-sort`.
- [ ] Toasts, socket refreshes and "Saved" are announced in a polite `aria-live` region.
- [ ] `prefers-reduced-motion` respected (the `.sl-*` classes already are); 200% zoom and 320px
      reflow lose nothing; no horizontal page scroll outside tables; 60% longer strings survive.
- [ ] Every flow (create, save, cancel, filter, export) can be finished with the keyboard alone.

## Keyboard conflicts to resolve (found in `config/shortcuts.ts`)

- **Ctrl+K is bound to Stock**, but the spec gives Ctrl+K to the command palette: move Stock
  (for example to Alt+K) when the palette lands.
- Ctrl+V/X/R/O/U/J/B/I navigate when focus is outside inputs, fighting paste, cut, reload and
  bold habits. Once the palette is the main navigator, consider retiring them.
- F-keys differ from Tally (here F2 = Save and F8 = Delete; in Tally F2 = Date and F8 = Sales).
  A restyle must not change them: show them in the palette and shortcut panel instead.
- Alt+N navigates even from a dirty form: guard it with the unsaved-changes prompt.

## Contrast audit (WCAG 2.x, computed from `style.css` token values)

| Pair                                           | Light                               | Dark                       |
| ---------------------------------------------- | ----------------------------------- | -------------------------- |
| ink on page                                    | 11.37 ✓                             | 14.86 ✓                    |
| ink on card                                    | 12.71 ✓                             | 13.05 ✓                    |
| ink-muted on card                              | 6.37 ✓                              | 7.83 ✓                     |
| ink-subtle on card                             | **3.35 ✗** (page 3.00, card-2 3.14) | 4.61 ✓ (card-2 **4.11 ✗**) |
| chip-fg on chip                                | 10.28 ✓                             | 8.49 ✓                     |
| cta-ink on cta / cta-2                         | 8.00 / 10.30 ✓                      | 7.80 / 10.78 ✓             |
| white on primary (`.sl-btn-blue`, active chip) | **4.16 ✗**                          | **2.61 ✗**                 |
| white on danger (`.sl-btn-danger`)             | **4.40 ✗**                          | **3.09 ✗**                 |
| nav-active-fg on nav-active                    | 10.28 ✓                             | 8.49 ✓                     |
| accent/primary as link text on card            | **4.16 ✗**                          | 5.87 ✓                     |
| success text on its chip tint / on card        | **2.85 / 3.41 ✗**                   | 5.02 / 6.78 ✓              |
| warning text on its chip tint / on card        | **2.47 / 2.95 ✗**                   | 5.04 / 7.00 ✓              |
| danger text on its chip tint / on card         | **3.63 / 4.40 ✗**                   | **4.18 ✗** / 4.96 ✓        |
| info text on card                              | **4.04 ✗**                          | 6.07 ✓                     |

`.sl-muted` and `.sl-section-label` use `ink-subtle`, so in light every context line and section
label fails today. The welcome name (primary on page, 3.72:1) passes only because it is large
text (≥24px).

**Suggested replacements** (all verified with the same formula):

| Token (theme)                                | Now     | Suggest                                                                  | Result                                          |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| `--color-ink-subtle` (light)                 | #7a8fa0 | **#5c7184**                                                              | 5.06 card · 4.53 page · 4.74 card-2             |
| `--color-ink-subtle` (dark)                  | #7890a5 | **#8aa1b5**                                                              | 5.72 card · 5.09 card-2 · 6.51 page             |
| `--color-primary` / `--color-accent` (light) | #4a74f0 | **#3b62d6**                                                              | white 5.38 · as text on card 5.38, on page 4.81 |
| text on primary (dark)                       | #fff    | new `--color-on-primary: #0f1b26` for `.sl-btn-blue` and the active chip | 6.69 (or fill #3d63d6 with white, 5.31)         |
| `--color-danger` (light)                     | #d6453d | **#b8322a**                                                              | white 5.95 · chip 4.78 · card 5.95              |
| danger button fill (dark)                    | #f0675e | new `--color-danger-fill: #c43d35` with white                            | 5.16                                            |
| `--color-danger` text (dark)                 | #f0675e | **#ff8078**                                                              | chip 5.02 · card 6.27                           |
| `--color-success` (light)                    | #2f9e5b | **#1a6e3c**                                                              | chip 4.97 · card 6.29                           |
| `--color-warning` (light)                    | #c98a14 | **#8a5a00**                                                              | chip 4.57 · card 5.93                           |
| `--color-info` (light)                       | #3b7fd6 | **#2f6bbf**                                                              | card 5.28 · page 4.72                           |

Brand tile (a white mark on the brand colour) is a graphic, so 3:1 applies: 3.52 light and
3.04 dark, which passes but has no margin.

## Sources

[Razorpay run payroll](https://razorpay.com/docs/payroll/run-payroll/) · [execute payroll](https://razorpay.com/docs/payroll/execute-payroll/) ·
[TallyPrime keys](https://help.tallysolutions.com/keyboard-shortcuts-tally-prime/) · [Zoho Books invoices](https://www.zoho.com/us/books/help/invoice/) ·
[Zoho GST invoicing](https://www.patronaccounting.com/blog/zoho-books-gst-invoicing-2026) · [Keka vs greytHR](https://hrone.cloud/blog/keka-vs-greythr-india/) ·
[Vyapar Android](https://vyaparapp.in/free/invoicing-software/app-for-android) · [Odoo list keyboard nav](https://apps.odoo.com/apps/modules/19.0/advanced_list_arrow_navigation) ·
[Setproduct tables](https://www.setproduct.com/blog/data-table-ui-design) · [Pencil & Paper tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) ·
[Stripe/Mercury patterns](https://www.themasterly.com/blog/fintech-dashboard-design-guide) · [Manufacturing UX](https://www.aufaitux.com/blog/manufacturing-ux-design/) ·
[MDN Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat) (en-IN compact L/Cr verified in Node 22) ·
[Tamil DS typography](https://tamilui.com/foundations/typography) · [Tamil localization](https://nexaex.in/blog/tamil-language-app-localization-guide)
