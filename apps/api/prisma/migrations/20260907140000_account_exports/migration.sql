-- CreateTable
CREATE TABLE "account_exports" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "status" VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
    "requested_by" VARCHAR(36),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "file_name" VARCHAR(160),
    "size_bytes" BIGINT,
    "sha256" VARCHAR(64),
    "table_counts" JSONB,
    "attachment_count" INTEGER NOT NULL DEFAULT 0,
    "token_hash" VARCHAR(64),
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMPTZ(6),
    "error" VARCHAR(500),

    CONSTRAINT "account_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_exports_company_id_requested_at_idx" ON "account_exports"("company_id", "requested_at");

-- AddForeignKey
ALTER TABLE "account_exports" ADD CONSTRAINT "account_exports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "account_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_exports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "account_exports";
CREATE POLICY tenant_isolation ON "account_exports" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "account_exports";
CREATE POLICY platform_bypass ON "account_exports" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
