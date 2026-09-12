-- CreateEnum
CREATE TYPE "ImsStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Gstr2bMatchStatus" AS ENUM ('MATCHED', 'MISMATCH', 'MISSING_IN_2B', 'MISSING_IN_BOOKS');

-- CreateTable
CREATE TABLE "gstr2b_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "period_key" VARCHAR(7) NOT NULL,
    "gstin" VARCHAR(15) NOT NULL,
    "supplier_gstin" VARCHAR(15) NOT NULL,
    "supplier_name" VARCHAR(160),
    "doc_type" VARCHAR(4) NOT NULL,
    "doc_no" VARCHAR(40) NOT NULL,
    "doc_no_norm" VARCHAR(40) NOT NULL,
    "doc_date" DATE NOT NULL,
    "doc_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "place_of_supply" VARCHAR(2),
    "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "itc_available" BOOLEAN NOT NULL DEFAULT true,
    "itc_reason" VARCHAR(120),
    "filing_period" VARCHAR(7),
    "filing_date" DATE,
    "source_kind" VARCHAR(10) NOT NULL DEFAULT 'IMPORT',
    "raw" JSONB,
    "match_status" "Gstr2bMatchStatus",
    "matched_doc_type" VARCHAR(12),
    "matched_doc_id" VARCHAR(40),
    "mismatch_fields" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gstr2b_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ims_actions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "record_id" UUID NOT NULL,
    "status" "ImsStatus" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(255),
    "decided_by" VARCHAR(36),
    "decided_at" TIMESTAMPTZ(6),
    "pushed_at" TIMESTAMPTZ(6),
    "pushed_by" VARCHAR(36),
    "push_ref" VARCHAR(64),
    "push_error" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ims_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gstr2b_records_company_id_period_key_match_status_idx" ON "gstr2b_records"("company_id", "period_key", "match_status");

-- CreateIndex
CREATE INDEX "gstr2b_records_company_id_supplier_gstin_doc_no_norm_idx" ON "gstr2b_records"("company_id", "supplier_gstin", "doc_no_norm");

-- CreateIndex
CREATE UNIQUE INDEX "gstr2b_records_company_id_period_key_supplier_gstin_doc_typ_key" ON "gstr2b_records"("company_id", "period_key", "supplier_gstin", "doc_type", "doc_no");

-- CreateIndex
CREATE UNIQUE INDEX "ims_actions_record_id_key" ON "ims_actions"("record_id");

-- CreateIndex
CREATE INDEX "ims_actions_company_id_status_idx" ON "ims_actions"("company_id", "status");

-- AddForeignKey
ALTER TABLE "gstr2b_records" ADD CONSTRAINT "gstr2b_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ims_actions" ADD CONSTRAINT "ims_actions_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "gstr2b_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ims_actions" ADD CONSTRAINT "ims_actions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
ALTER TABLE "gstr2b_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_records" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "gstr2b_records";
CREATE POLICY tenant_isolation ON "gstr2b_records" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "gstr2b_records";
CREATE POLICY platform_bypass ON "gstr2b_records" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "ims_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ims_actions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ims_actions";
CREATE POLICY tenant_isolation ON "ims_actions" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "ims_actions";
CREATE POLICY platform_bypass ON "ims_actions" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: what the portal said and what the company decided about its credit are both tax
-- records (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_gstr2b_records ON "gstr2b_records";
CREATE TRIGGER audit_gstr2b_records AFTER INSERT OR UPDATE OR DELETE ON "gstr2b_records" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_ims_actions ON "ims_actions";
CREATE TRIGGER audit_ims_actions AFTER INSERT OR UPDATE OR DELETE ON "ims_actions" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
