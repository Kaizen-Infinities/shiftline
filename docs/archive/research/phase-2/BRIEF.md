Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# Research brief (shared by all domain researchers)

Repo: /home/user/shiftline (npm workspaces). API: apps/api/src/modules/<name>/_.ts, routes mounted in
apps/api/src/routes/index.routes.ts, Prisma schema apps/api/prisma/schema.prisma (5.7k lines), tests in
apps/api/test/integration/_.spec.ts. Web: apps/web/src/modules/<name>, apps/web/src/features/<name>,
routes in apps/web/src/routes/AppRoutes.tsx, nav config in apps/web/src/config or constants. Shared
permissions in packages/shared/src. Specs in docs/specs, handoffs in docs/handoff.

Read CLAUDE.md first. Product: Shiftline, a multi-tenant ERP for Indian secondary-sector (manufacturing)
SMEs; MVP target is plastics processing (injection moulding, blow moulding, extrusion, recycling/granulation):
raw material in bags (PP, HDPE, LDPE, PVC, masterbatch, regrind), moulds/dies, machines by tonnage, shift-wise
production with rejection/scrap/regrind, job-work in and out, GST compliance.

Your job for your assigned domain:

1. INVENTORY: list every existing Prisma model, API module/endpoint group, web screen, permission key and
   test file that belongs to the domain. Be concrete (file paths). Note quality issues you notice (missing
   tenant scoping, no tests, stubs, TODOs).
2. GAPS: propose the features a world-class ERP for this sector needs in this domain that are missing or
   thin. For each: name, one-line rationale, data model sketch (models/fields), endpoints, screens,
   which existing modules it touches, rough size (S/M/L). Aim for 15-30 items, ranked by value to a
   plastics SME owner/accountant/plant manager.
3. Flag which of your gaps can be built in isolation (few cross-domain deps) vs need sequencing.

Constraints to respect in proposals (they are repo rules): everything tenant-scoped via lib/prisma.ts;
books never deleted; audit triggers on books/documents/masters; jobs on pg-boss; permission keys in
packages/shared; nav gated; Tailwind only. DO NOT propose anything whose purpose is to conceal
transactions from tax authorities (no parallel/hidden books, no off-record sales, no purgeable data).
Legitimate cash workflows (cash sales, cash payments with proper vouchers, unregistered/composition
parties, kachha-to-pakka quotation flows that stay recorded) are fine and welcome.

Output: write your report to the file path you were given, as Markdown, max ~400 lines. Then reply with
a 10-line summary. Do not modify any repo files.
