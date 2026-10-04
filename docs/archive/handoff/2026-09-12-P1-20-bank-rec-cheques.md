# P1-20 — Bank reconciliation and cheques

## Shipped

- **Statement parser** (`statement.parse.ts`) for the layouts HDFC, ICICI, SBI, Axis and Kotak
  actually export, plus a generic mapper. It normalises what the banks disagree about: dates in
  four orders (day-first by default, because no Indian bank writes 03/04 to mean 4 March, with a
  leading four-digit year taken as ISO), amounts with Indian grouping, brackets or a `Cr`/`Dr`
  marker, and a single signed column where the bank does not give two.
- **Import** with de-duplication: each line is hashed on its date, amount, reference and
  description, so re-importing an overlapping export counts the repeats and skips them rather
  than doubling the bank.
- **Matching** with a confidence and a reason. Amount and direction get a voucher into the
  running (50); the same date adds 30, a date within two days 20; a reference that survives
  normalisation and appears on the voucher adds 25. Automatic matching needs 80 and refuses a tie.
- **Manual match, unmatch and set-aside**, because the rules will always be wrong about
  something and a bank charge has no voucher to match.
- **The BRS**: book balance, cheques issued but not presented, deposits not yet credited, charges
  and credits not in the books, the reconciled balance and — named rather than absorbed — the
  difference that is still unexplained.
- **The cheque register**: received and issued, post-dated by their own date, through in-hand,
  deposited, cleared, bounced and cancelled. A bounce posts the reversal (the customer owes it
  again) and the bank's charge as a separate cost rather than netted into it.
- One seed ledger (`BANK-CHG-001`), permissions `banking.{view,manage}` granted to Owner and
  Accounts, migration `20260913000000_bank_rec_cheques` with RLS and audit triggers, web
  `/accounts/bank-reconciliation` with four tabs, in `e2e/smoke.spec.ts`. `banking.spec.ts`
  (10 tests).

## Decisions worth knowing

- **Amount alone is never a match.** A company paying three suppliers ₹50,000 on the same day
  would get three wrong matches and no way of noticing. Amount is 50 points out of the 80 needed;
  something else has to agree.
- **A tie is not a match.** Two candidates equally sure means the rules cannot tell them apart,
  so both are left for a person rather than one being picked arbitrarily.
- **Every match shows its reasons.** The dialog prints "the amount is the same; the date is the
  same" and the confidence, because a match nobody can check is a match nobody should trust.
- **Day-first dates.** Getting this backwards silently moves a transaction into another month,
  and nothing downstream would notice.
- **The unexplained difference is displayed.** A reconciliation that hides its own gap is worse
  than no reconciliation: the gap is the entire point of the exercise.
- **A bounce charge is its own expense.** Netting it into the reversal would lose the cost and
  leave the customer's account wrong by the charge.

## Half-done / known gaps

- **A re-presented cheque is not handled properly.** A bounced cheque can be marked cleared
  afterwards — which is what happens in practice, it goes in again and clears — but nothing
  re-posts the receipt, so the books stay reversed while the register says cleared. Re-presenting
  should be its own action that posts the receipt again; today it quietly does not.
- Nothing creates a cheque from a receipt or a payment. The register is entered by hand, and
  `refDocType`/`refDocId` are there for the wiring that has not happened yet.
- A matched statement line does not post anything. Matching says "this line is that voucher"; a
  charge or interest the books have never seen still has to be entered by hand, deliberately —
  posting an unidentified debit automatically is how a suspense account fills up.
- Only CSV. XLS and XLSX need a parser dependency; the paste box covers most of what people
  actually do.
- The BRS reads the bank balance from the statement's running-balance column. A bank that does
  not export one leaves that null and the difference cannot be computed; it says so rather than
  guessing.
- No bank feed. Account aggregator and corporate APIs both need an arrangement the company does
  not have.
- Cheques due are listed but nothing warns about them; a daily job like the MSME one would be
  small.

## Next

P1-16: statutory payroll and filings.

## Blocked on you

- Which banks the company actually uses, and one real statement export from each. The five
  layouts here are from public samples; a real file may have a column this does not know, which
  is what the generic mapper is for — but knowing beats mapping.

## Changelog sentence

Bank statements now import from the major banks' own CSV exports, match themselves against the
books where they are sure and show their reasoning where they are not, reconcile to a BRS that
names its own unexplained difference, and cheques are tracked from post-dated through to cleared
or bounced.
