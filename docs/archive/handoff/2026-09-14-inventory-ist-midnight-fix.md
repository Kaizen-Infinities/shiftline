# Inventory EOD stock — the IST-midnight bug, fixed

## Shipped

The bug found in passing while verifying `docs/handoff/2026-09-13-P2T-04-bugfixes.md` (its "Found
in passing, not fixed here" section) is fixed, at the owner's request.

`inventory.service.ts`'s `getEodStock()` needed two different things from "today (IST)" and used
the same value for both:

- a **calendar-day identity** to compare against the `date` query parameter (itself built as
  `new Date(Date.UTC(year, month - 1, day))` from a `YYYY-MM-DD` string in the controller) — any
  stable, matching representation works here, since it's only ever compared for equality;
- the **real UTC instant IST midnight falls at**, to filter `RawMaterialTransaction` /
  `FinishedGoodsTransaction` rows by `txnDateTime: { gte: ... }` — this one has to be a real
  instant in elapsed time, not a date label.

It used `new Date(Date.UTC(nowParts.year, nowParts.month, nowParts.day))` — UTC midnight of the
IST calendar day's own date — for both. That's fine as a calendar-day identity, but wrong as a
real instant: since IST is UTC+5:30, true IST midnight is `18:30 UTC` the _previous_ UTC day, 5.5
hours earlier. For that whole 5.5-hour stretch of every IST day (18:30–00:00 UTC), any transaction
that happened was excluded from "today's net change", so the live "today" view's `startQty` came
out equal to the live balance, as if nothing had moved yet.

Fixed by keeping the calendar-identity value (`todayISTStart`, unchanged, still used only for the
`isToday` equality check) and adding a second value, `todayISTStartUtc`, for the transaction
filters — computed by a new shared helper, `getISTDayStartUtc()` in `dateUtils.ts`, which builds
the real UTC instant via `new Date(\`${getISTDateString(d)}T00:00:00+05:30\`)`. This is the same
technique `eodStockSnapshot.job.ts` already used correctly (`` new Date(`${dateStr}T00:00:00+05:30`) ``)
for the scheduled EOD job; the bug was only ever in the live "today" view and the route controller
never needed a real instant, so neither of those needed to change.

## Tests

Added a regression test to `inventory.spec.ts` pinned to fixed, fake wall-clock times (via
`vi.useFakeTimers({ toFake: ["Date"] })`) rather than depending on when the suite happens to run:
a transaction stamped at 00:30 IST is asserted to count toward "today's" reversal. This is the
same shape of proof as the two pre-existing "today" tests, just deliberately placed inside the
window the bug used to drop. Full suite: 79 files, 500 tests, green. Typecheck (api, api's test
project, web, shared), lint (0 errors, same 510 pre-existing warnings), prettier and
`e2e:typecheck` all clean.

## Next

Nothing pending from this fix. Phase 2 (the shop floor) begins from
`docs/handoff/2026-09-13-commission-phase-2.md`.

## Blocked on you

Nothing.

## Changelog

The end-of-day stock view no longer understates today's opening balance for goods received or
issued in the first few hours after midnight India time.
