-- CreateEnum
CREATE TYPE "ItcStatus" AS ENUM ('ELIGIBLE', 'INELIGIBLE', 'REVERSED', 'RECLAIMED', 'VOID');

-- CreateTable
CREATE TABLE "itc_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "period_key" VARCHAR(7) NOT NULL,
    "doc_type" VARCHAR(12) NOT NULL,
    "doc_id" VARCHAR(40) NOT NULL,
    "doc_no" VARCHAR(40) NOT NULL,
    "doc_date" DATE NOT NULL,
    "supplier_gstin" VARCHAR(15),
    "hsn_code" VARCHAR(8),
    "source" VARCHAR(16) NOT NULL DEFAULT 'OTHER',
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ItcStatus" NOT NULL DEFAULT 'ELIGIBLE',
    "rule" VARCHAR(12),
    "reason" VARCHAR(255),
    "reversed_period" VARCHAR(7),
    "reclaimed_period" VARCHAR(7),
    "manual_status" "ItcStatus",
    "manual_reason" VARCHAR(255),
    "manual_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "itc_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itc_entries_company_id_period_key_status_idx" ON "itc_entries"("company_id", "period_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "itc_entries_company_id_doc_type_doc_id_key" ON "itc_entries"("company_id", "doc_type", "doc_id");

-- AddForeignKey
ALTER TABLE "itc_entries" ADD CONSTRAINT "itc_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "itc_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "itc_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "itc_entries";
CREATE POLICY tenant_isolation ON "itc_entries" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "itc_entries";
CREATE POLICY platform_bypass ON "itc_entries" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: the credit ledger is a tax record (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_itc_entries ON "itc_entries";
CREATE TRIGGER audit_itc_entries AFTER INSERT OR UPDATE OR DELETE ON "itc_entries" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
