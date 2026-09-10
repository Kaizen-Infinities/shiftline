-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "onboarding_step" VARCHAR(40),
ADD COLUMN     "slug" VARCHAR(40),
ADD COLUMN     "tos_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "tos_accepted_by" VARCHAR(36);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "email" VARCHAR(120) NOT NULL,
    "full_name" VARCHAR(160),
    "role_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_user_id" VARCHAR(36),
    "revoked_at" TIMESTAMPTZ(6),
    "invited_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_company_id_email_idx" ON "invitations"("company_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "invitations";
CREATE POLICY tenant_isolation ON "invitations" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "invitations";
CREATE POLICY platform_bypass ON "invitations" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_invitations ON "invitations";
CREATE TRIGGER audit_invitations AFTER INSERT OR UPDATE OR DELETE ON "invitations" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
