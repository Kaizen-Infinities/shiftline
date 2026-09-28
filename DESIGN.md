# Design

The web app's visual system is **UI v2**, specified in [`docs/specs/UI-v2.md`](docs/specs/UI-v2.md):
a cool-white product on white rounded tiles, a blue accent, one green primary action per screen,
and pale-blue chips. Tokens and building blocks live in `apps/web/src/assets/css/style.css`.

Colour roles (brand/action, status, domain identity) are defined in the "Colour roles" section
of that spec. Chart series colours are `--chart-series-1..4`, and domain tones reuse them.

The earlier "Passbook Ledger" direction (the surface brief under
`apps/web/.impeccable/surfaces/` and the "Visual language" line in
`docs/specs/P1-UI-remake.md`) is superseded by UI v2.
