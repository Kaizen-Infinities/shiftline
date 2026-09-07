-- CreateTable
CREATE TABLE "filing_approvals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "filing_type" VARCHAR(40) NOT NULL,
    "period_key" VARCHAR(20) NOT NULL,
    "business_place_id" BIGINT,
    "status" VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
    "payload_hash" VARCHAR(64) NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "notes" VARCHAR(500),
    "prepared_by" VARCHAR(36),
    "prepared_at" TIMESTAMPTZ(6),
    "sent_for_approval_at" TIMESTAMPTZ(6),
    "approved_by" VARCHAR(36),
    "approved_at" TIMESTAMPTZ(6),
    "locked_at" TIMESTAMPTZ(6),
    "reject_reason" VARCHAR(500),
    "submitted_by" VARCHAR(36),
    "submitted_at" TIMESTAMPTZ(6),
    "submission_ref" VARCHAR(120),
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "filing_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "filing_approvals_company_id_status_idx" ON "filing_approvals"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "filing_approvals_company_id_filing_type_period_key_business_key" ON "filing_approvals"("company_id", "filing_type", "period_key", "business_place_id");

-- AddForeignKey
ALTER TABLE "filing_approvals" ADD CONSTRAINT "filing_approvals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "filing_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "filing_approvals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "filing_approvals";
CREATE POLICY tenant_isolation ON "filing_approvals" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "filing_approvals";
CREATE POLICY platform_bypass ON "filing_approvals" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: a filing approval is a compliance record (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_filing_approvals ON "filing_approvals";
CREATE TRIGGER audit_filing_approvals AFTER INSERT OR UPDATE OR DELETE ON "filing_approvals" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
