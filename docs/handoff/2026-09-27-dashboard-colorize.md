# Dashboards — colour that carries meaning

**Changelog:** Dashboard figures are now colour-keyed by area (sales blue, purchases amber, cash
green, production violet, matching the charts), and production percentages turn green, amber or
red against one shared OEE scale.

## Before

Every icon square on the executive, production and OEE dashboards was the same pale blue, so
colour told the reader nothing. The two production screens also disagreed on the OEE thresholds
(`> 85` against `>= 85`). The shift efficiency chip was always green, even at 20%. A rising
payable showed a green "good" chip, and an idle machine was amber on one screen and grey on the
other.

## Now

- **Domain tones.** `.sl-tone-sales | -purchase | -cash | -production` in `style.css` tint an icon
  square with the chart series of the same domain. Text contrast is at least 4.96:1 in both
  themes. `StatTile`, `TileHeader` and the other dashboard primitives take a `tone` prop; the
  type and the `toneClass` helper live in `dashboardFormat.ts`.
  - The executive dashboard's six money tiles, its list and transaction headers, and the
    voucher-type chips use these tones.
- **One OEE scale.** `oeeTone` and `oeeChipClass` in `dashboardFormat.ts` set the bands: 85% and
  up is success, 60% and up is warning, below that is danger. They now drive:
  - the OEE page, and the production page's ring;
  - the availability, performance and quality meters (previously always blue);
  - the output-against-target meters and each machine's OEE figure;
  - the shift efficiency chip and its meter.
- **Idle is grey on both screens.** It is a white-backed muted chip on the production page, so it
  stays visible on the grey machine cards.
- **Payable deltas.** `StatTile` has `upIsGood`. Payable passes `false`, so a rise shows red.
- **OEE machine cards** tint their icon square with the machine's status.
- **Docs.** `docs/specs/UI-v2.md` gains a "Colour roles" section. The new `DESIGN.md` points to
  it and marks the old "Passbook Ledger" brief as superseded, as agreed with the owner in this
  session.

## Not done

- The seed has no running orders, so the threshold colours were checked in code, not on screen.
  All the screens were checked with empty data at 1440 px and 390 px, in light and dark.
- The "Visual language" line in `docs/specs/P1-UI-remake.md` still describes the Passbook
  direction. Updating it belongs to whoever owns that spec.
- The sidebar shows "by Applied Softwares" under the Shiftline wordmark. It is out of scope
  here, but it looks like vendor text that should come from config or be removed.
