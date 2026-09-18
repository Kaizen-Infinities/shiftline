# Repository setup (one-time, by an org admin)

1. **Branch protection on `main`** (Settings → Branches → Add rule):
   - Require a pull request before merging; 1 approval; dismiss stale approvals.
   - Require review from Code Owners.
   - Require status checks: `Typecheck, lint, format`, `Schema and migration gate`,
     `API tests`, `Web tests and build`.
   - Require branches to be up to date; require linear history; block force pushes.
2. **CODEOWNERS**: replace the placeholder handle in `.github/CODEOWNERS` with the named
   approver for filing / payment / tenancy / auth changes.
3. **Actions**: allow GitHub Actions for the repo; Dependabot security updates on.
4. **Secrets** (only when an external service is wired): add as repository secrets, never
   in workflow files or `.env.example`.
5. **Environments**: local-only development needs none. When Railway hosting is enabled, create a
   protected `production` environment with required reviewers and follow
   `railway-cloudflare.md`; keep deployment credentials out of repository secrets unless a
   GitHub Actions workflow explicitly needs them.
