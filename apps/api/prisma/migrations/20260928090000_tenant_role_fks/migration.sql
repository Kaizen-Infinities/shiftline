-- Tenant-bound role references (security finding F01).
--
-- Before this migration users.roleId and role_permissions.roleId pointed at roles(id) alone, so a
-- row stamped with tenant A's company_id could reference tenant B's role, and authentication then
-- merged that foreign permission row into B's users. The composite foreign keys below make the
-- database refuse any reference whose company_id differs from the role's company_id.
--
-- Existing mismatched rows would make the new constraints fail, so they are neutralised first:
--   * a role_permissions row whose company differs from its role's company is deleted (it can only
--     have been written by another tenant, so it must not grant anything);
--   * a users.roleId pointing at another tenant's role is set to NULL (the user keeps the account
--     and has no permissions until an admin of their own tenant assigns one of their own roles).
-- RLS is bypassed for this session only so the clean-up sees every tenant.
SELECT set_config('app.bypass_rls', 'on', false);

DELETE FROM "role_permissions" rp
USING "roles" r
WHERE rp."roleId" = r."id" AND rp."company_id" <> r."company_id";

UPDATE "users" u
SET "roleId" = NULL
FROM "roles" r
WHERE u."roleId" = r."id" AND u."company_id" <> r."company_id";

SELECT set_config('app.bypass_rls', 'off', false);

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_roleId_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_roleId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_id_key" ON "roles"("company_id", "id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_roleId_fkey" FOREIGN KEY ("company_id", "roleId") REFERENCES "roles"("company_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_company_id_roleId_fkey" FOREIGN KEY ("company_id", "roleId") REFERENCES "roles"("company_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
