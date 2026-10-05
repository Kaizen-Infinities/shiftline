-- New permission key eod-stock.run (manual stock-snapshot rerun, security finding F06/F10).
--
-- The route used to be open to anyone who could see EOD stock; it now needs its own key. Roles
-- already in the database would lose the button, so grant the key to every tenant's OWNER role and
-- to every role that already holds eod-stock.edit (the closest existing write key). New tenants
-- get it from ROLE_DEFS (OWNER holds the whole registry, STORES holds every eod-stock action).
-- Idempotent: the permission row and the grants are inserted only when missing.
-- RLS is bypassed for this session only so the grant sees every tenant, and each grant carries
-- the role's own company_id (the composite FK from the previous migration would refuse otherwise).
SELECT set_config('app.bypass_rls', 'on', false);

INSERT INTO "permissions" ("key", "module", "action", "description")
VALUES ('eod-stock.run', 'eod-stock', 'run', 'Can run EOD Stock')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("company_id", "roleId", "permissionId")
SELECT r."company_id", r."id", p."id"
FROM "roles" r
CROSS JOIN "permissions" p
WHERE p."key" = 'eod-stock.run'
  AND (
    r."code" = 'OWNER'
    OR EXISTS (
      SELECT 1
      FROM "role_permissions" rp
      JOIN "permissions" pe ON pe."id" = rp."permissionId"
      WHERE rp."roleId" = r."id"
        AND rp."company_id" = r."company_id"
        AND pe."key" = 'eod-stock.edit'
    )
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

SELECT set_config('app.bypass_rls', 'off', false);
