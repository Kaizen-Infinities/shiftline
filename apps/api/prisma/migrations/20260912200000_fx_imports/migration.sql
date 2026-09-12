-- CreateEnum
CREATE TYPE "FxRevaluationStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "fx_revaluations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "period_key" VARCHAR(7) NOT NULL,
    "as_on" DATE NOT NULL,
    "status" "FxRevaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "voucher_id" INTEGER,
    "reversal_voucher_id" INTEGER,
    "prepared_by" VARCHAR(36),
    "posted_by" VARCHAR(36),
    "posted_at" TIMESTAMPTZ(6),
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fx_revaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills_of_entry" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "be_number" VARCHAR(20) NOT NULL,
    "be_date" DATE NOT NULL,
    "port_code" VARCHAR(10),
    "grn_invoice_id" UUID,
    "supplier_id" INTEGER,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "foreign_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "assessable_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "basic_duty" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "social_welfare_surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "landed_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "voucher_id" INTEGER,
    "notes" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bills_of_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fx_revaluations_company_id_status_idx" ON "fx_revaluations"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fx_revaluations_company_id_period_key_key" ON "fx_revaluations"("company_id", "period_key");

-- CreateIndex
CREATE INDEX "bills_of_entry_company_id_be_date_idx" ON "bills_of_entry"("company_id", "be_date");

-- CreateIndex
CREATE UNIQUE INDEX "bills_of_entry_company_id_be_number_be_date_key" ON "bills_of_entry"("company_id", "be_number", "be_date");

-- AddForeignKey
ALTER TABLE "fx_revaluations" ADD CONSTRAINT "fx_revaluations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills_of_entry" ADD CONSTRAINT "bills_of_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fx_revaluations','bills_of_entry']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: both carry tax credit and both move the books (same trigger as
-- 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_fx_revaluations ON "fx_revaluations";
CREATE TRIGGER audit_fx_revaluations AFTER INSERT OR UPDATE OR DELETE ON "fx_revaluations" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_bills_of_entry ON "bills_of_entry";
CREATE TRIGGER audit_bills_of_entry AFTER INSERT OR UPDATE OR DELETE ON "bills_of_entry" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
