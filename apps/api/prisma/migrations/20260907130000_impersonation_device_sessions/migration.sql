-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "device_id" VARCHAR(120);

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" UUID NOT NULL,
    "admin_id" BIGINT NOT NULL,
    "admin_session_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "ended_reason" VARCHAR(120),
    "ip_address" VARCHAR(45),

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_sessions_company_id_started_at_idx" ON "impersonation_sessions"("company_id", "started_at");

-- CreateIndex
CREATE INDEX "impersonation_sessions_admin_id_started_at_idx" ON "impersonation_sessions"("admin_id", "started_at");

-- Platform data, but the row names a tenant: same row-level security as every tenant table
-- (the console reads it through the bypass; nothing inside a tenant touches it).
ALTER TABLE "impersonation_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "impersonation_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "impersonation_sessions";
CREATE POLICY tenant_isolation ON "impersonation_sessions" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "impersonation_sessions";
CREATE POLICY platform_bypass ON "impersonation_sessions" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
