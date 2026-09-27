-- CreateEnum
CREATE TYPE "MsmeClaimStatus" AS ENUM ('DRAFT', 'FILED', 'HEARING', 'SETTLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "MsmeClaimForum" AS ENUM ('SAMADHAAN', 'MSEFC', 'DIRECT');

-- CreateTable
CREATE TABLE "msme_claim_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "bank_rate" DECIMAL(5,2) NOT NULL DEFAULT 6.75,
    "bank_rate_note" VARCHAR(200),
    "udyam_number" VARCHAR(19),
    "enterprise_category" "MsmeCategory",
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "msme_claim_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msme_recovery_claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "claim_no" VARCHAR(30) NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "MsmeClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "forum" "MsmeClaimForum" NOT NULL DEFAULT 'SAMADHAAN',
    "as_of_date" DATE NOT NULL,
    "bank_rate" DECIMAL(5,2) NOT NULL,
    "annual_rate" DECIMAL(6,2) NOT NULL,
    "principal_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "filed_on" DATE,
    "reference_no" VARCHAR(60),
    "hearing_on" DATE,
    "settled_on" DATE,
    "settled_amount" DECIMAL(14,2),
    "notes" VARCHAR(1000),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "msme_recovery_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "msme_recovery_claim_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "claim_id" UUID NOT NULL,
    "sales_invoice_id" UUID NOT NULL,
    "invoice_no" VARCHAR(40) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "accepted_on" DATE NOT NULL,
    "invoice_amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "principal_outstanding" DECIMAL(14,2) NOT NULL,
    "limit_days" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "days_late" INTEGER NOT NULL,
    "interest" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "msme_recovery_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "msme_claim_settings_company_id_key" ON "msme_claim_settings"("company_id");

-- CreateIndex
CREATE INDEX "msme_recovery_claims_company_id_status_idx" ON "msme_recovery_claims"("company_id", "status");

-- CreateIndex
CREATE INDEX "msme_recovery_claims_customer_id_idx" ON "msme_recovery_claims"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "msme_recovery_claims_company_id_claim_no_key" ON "msme_recovery_claims"("company_id", "claim_no");

-- CreateIndex
CREATE INDEX "msme_recovery_claim_lines_sales_invoice_id_idx" ON "msme_recovery_claim_lines"("sales_invoice_id");

-- CreateIndex
CREATE INDEX "msme_recovery_claim_lines_company_id_idx" ON "msme_recovery_claim_lines"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "msme_recovery_claim_lines_claim_id_sales_invoice_id_key" ON "msme_recovery_claim_lines"("claim_id", "sales_invoice_id");

-- AddForeignKey
ALTER TABLE "msme_claim_settings" ADD CONSTRAINT "msme_claim_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msme_recovery_claims" ADD CONSTRAINT "msme_recovery_claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msme_recovery_claims" ADD CONSTRAINT "msme_recovery_claims_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msme_recovery_claim_lines" ADD CONSTRAINT "msme_recovery_claim_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msme_recovery_claim_lines" ADD CONSTRAINT "msme_recovery_claim_lines_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "msme_recovery_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "msme_recovery_claim_lines" ADD CONSTRAINT "msme_recovery_claim_lines_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['msme_claim_settings', 'msme_recovery_claims', 'msme_recovery_claim_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-05): a claim is a legal demand on a buyer and the bank rate decides its
-- interest, so every change to either is kept (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_msme_claim_settings ON "msme_claim_settings";
CREATE TRIGGER audit_msme_claim_settings AFTER INSERT OR UPDATE OR DELETE ON "msme_claim_settings" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_msme_recovery_claims ON "msme_recovery_claims";
CREATE TRIGGER audit_msme_recovery_claims AFTER INSERT OR UPDATE OR DELETE ON "msme_recovery_claims" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_msme_recovery_claim_lines ON "msme_recovery_claim_lines";
CREATE TRIGGER audit_msme_recovery_claim_lines AFTER INSERT OR UPDATE OR DELETE ON "msme_recovery_claim_lines" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

