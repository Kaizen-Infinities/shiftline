-- CreateEnum
CREATE TYPE "ExportIncentiveScheme" AS ENUM ('RODTEP', 'ROSCTL', 'DRAWBACK');

-- CreateEnum
CREATE TYPE "ExportIncentiveStatus" AS ENUM ('DECLARED', 'SCROLLED', 'SCRIP_GENERATED', 'UTILISED', 'TRANSFERRED', 'CREDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExportAuthorisationType" AS ENUM ('EPCG', 'ADVANCE_AUTHORISATION');

-- CreateEnum
CREATE TYPE "ExportAuthorisationStatus" AS ENUM ('ACTIVE', 'EO_FULFILLED', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "export_incentive_claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "scheme" "ExportIncentiveScheme" NOT NULL,
    "shipping_bill_no" VARCHAR(20) NOT NULL,
    "shipping_bill_date" DATE NOT NULL,
    "port_code" VARCHAR(10),
    "sales_invoice_id" UUID,
    "fob_value_inr" DECIMAL(16,2) NOT NULL,
    "rate_percent" DECIMAL(6,3),
    "expected_amount" DECIMAL(14,2) NOT NULL,
    "scrolled_amount" DECIMAL(14,2),
    "scrolled_on" DATE,
    "scrip_no" VARCHAR(30),
    "scrip_date" DATE,
    "scrip_expires_on" DATE,
    "utilised_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transferred_to" VARCHAR(120),
    "realised_inr" DECIMAL(14,2),
    "credited_on" DATE,
    "status" "ExportIncentiveStatus" NOT NULL DEFAULT 'DECLARED',
    "notes" VARCHAR(500),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "export_incentive_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_authorisations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "auth_type" "ExportAuthorisationType" NOT NULL,
    "auth_no" VARCHAR(30) NOT NULL,
    "issue_date" DATE NOT NULL,
    "rla_office" VARCHAR(60),
    "duty_saved" DECIMAL(16,2) NOT NULL,
    "eo_multiple" DECIMAL(5,2) NOT NULL DEFAULT 6,
    "eo_amount" DECIMAL(16,2) NOT NULL,
    "eo_period_months" INTEGER NOT NULL,
    "eo_due_date" DATE NOT NULL,
    "block1_due_date" DATE,
    "status" "ExportAuthorisationStatus" NOT NULL DEFAULT 'ACTIVE',
    "eodc_no" VARCHAR(30),
    "eodc_date" DATE,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "export_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_obligation_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "authorisation_id" UUID NOT NULL,
    "shipping_bill_no" VARCHAR(20) NOT NULL,
    "shipping_bill_date" DATE NOT NULL,
    "sales_invoice_id" UUID,
    "fob_value_inr" DECIMAL(16,2) NOT NULL,
    "realised_on" DATE,
    "brc_no" VARCHAR(40),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_obligation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_incentive_claims_company_id_status_idx" ON "export_incentive_claims"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "export_incentive_claims_company_id_scheme_shipping_bill_no_key" ON "export_incentive_claims"("company_id", "scheme", "shipping_bill_no");

-- CreateIndex
CREATE UNIQUE INDEX "export_authorisations_company_id_auth_no_key" ON "export_authorisations"("company_id", "auth_no");

-- CreateIndex
CREATE UNIQUE INDEX "export_obligation_entries_company_id_authorisation_id_shipp_key" ON "export_obligation_entries"("company_id", "authorisation_id", "shipping_bill_no");

-- AddForeignKey
ALTER TABLE "export_incentive_claims" ADD CONSTRAINT "export_incentive_claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_incentive_claims" ADD CONSTRAINT "export_incentive_claims_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_authorisations" ADD CONSTRAINT "export_authorisations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_obligation_entries" ADD CONSTRAINT "export_obligation_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_obligation_entries" ADD CONSTRAINT "export_obligation_entries_authorisation_id_fkey" FOREIGN KEY ("authorisation_id") REFERENCES "export_authorisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['export_incentive_claims', 'export_authorisations', 'export_obligation_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-01): incentive claims are money owed to the company and authorisations carry a
-- legal export obligation (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_export_incentive_claims ON "export_incentive_claims";
CREATE TRIGGER audit_export_incentive_claims AFTER INSERT OR UPDATE OR DELETE ON "export_incentive_claims" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_export_authorisations ON "export_authorisations";
CREATE TRIGGER audit_export_authorisations AFTER INSERT OR UPDATE OR DELETE ON "export_authorisations" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_export_obligation_entries ON "export_obligation_entries";
CREATE TRIGGER audit_export_obligation_entries AFTER INSERT OR UPDATE OR DELETE ON "export_obligation_entries" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
