-- CreateEnum
CREATE TYPE "RetentionDataClass" AS ENUM ('BOOKS', 'FILINGS', 'PAYROLL', 'AUDIT_LOGS', 'EOD_SNAPSHOTS', 'SESSIONS', 'LOGIN_ATTEMPTS', 'SYNC_TOMBSTONES');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('RETAIN', 'ARCHIVE', 'PURGE');

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "data_class" "RetentionDataClass" NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL DEFAULT 'RETAIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_sweeps" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "data_class" "RetentionDataClass" NOT NULL,
    "action" "RetentionAction" NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "cutoff" TIMESTAMPTZ(6) NOT NULL,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "affected" INTEGER NOT NULL DEFAULT 0,
    "archive_path" VARCHAR(500),
    "error" VARCHAR(1000),
    "triggered_by" VARCHAR(36),
    "job_id" VARCHAR(64),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "retention_sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_company_id_data_class_key" ON "retention_policies"("company_id", "data_class");

-- CreateIndex
CREATE INDEX "retention_sweeps_company_id_started_at_idx" ON "retention_sweeps"("company_id", "started_at");

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_sweeps" ADD CONSTRAINT "retention_sweeps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "retention_policies";
CREATE POLICY tenant_isolation ON "retention_policies" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "retention_policies";
CREATE POLICY platform_bypass ON "retention_policies" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "retention_sweeps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_sweeps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "retention_sweeps";
CREATE POLICY tenant_isolation ON "retention_sweeps" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "retention_sweeps";
CREATE POLICY platform_bypass ON "retention_sweeps" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
