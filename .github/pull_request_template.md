## What

<!-- One paragraph. Link the spec in docs/specs/ and the hand-off note. -->

## Why

## Definition of done

- [ ] Integration tests cover the happy path and every validation rejection; CI is green
- [ ] Every new query is tenant-scoped and a cross-tenant test proves a foreign `companyId` returns nothing
- [ ] No endpoint returns a raw error message; no secret in code; env validated
- [ ] Permission keys registered in `packages/shared`; nav gated; socket events per tenant
- [ ] Verified on the running stack (screenshot below)
- [ ] One user-facing sentence for the changelog:
- [ ] Hand-off note added under `docs/handoff/`

## Screenshot / evidence

## Needs the named approver?

- [ ] Touches filing, payment, tenancy or auth (CODEOWNERS will request review)
