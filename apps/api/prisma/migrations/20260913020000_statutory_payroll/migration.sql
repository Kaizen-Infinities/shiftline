-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- CreateTable
CREATE TABLE "statutory_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "state_code" VARCHAR(2) NOT NULL,
    "state_name" VARCHAR(80) NOT NULL,
    "pt_slabs" JSONB NOT NULL,
    "pt_enabled" BOOLEAN NOT NULL DEFAULT true,
    "lwf_employee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lwf_employer" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lwf_frequency" VARCHAR(16) NOT NULL DEFAULT 'ANNUAL',
    "lwf_months" JSONB NOT NULL DEFAULT '[12]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "statutory_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_statutory" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "payroll_run_id" INTEGER NOT NULL,
    "employee_id" BIGINT NOT NULL,
    "employee_code" VARCHAR(40) NOT NULL,
    "period_key" VARCHAR(7) NOT NULL,
    "state_code" VARCHAR(2),
    "uan" VARCHAR(12),
    "esic_number" VARCHAR(17),
    "pf_wage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_wage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pt_wage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "epf_employee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "eps_employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "epf_employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "edli_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pf_admin_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vpf" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_employee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "esi_employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "professional_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lwf_employee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lwf_employer" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "income_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wage_share_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wage_check_passed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_statutory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_tax_declarations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employee_id" BIGINT NOT NULL,
    "fy_code" VARCHAR(10) NOT NULL,
    "regime" "TaxRegime" NOT NULL DEFAULT 'NEW',
    "declarations" JSONB NOT NULL DEFAULT '{}',
    "projected_income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "projected_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_deducted_to_date" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "proofs_verified" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_tax_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "statutory_rules_company_id_state_code_key" ON "statutory_rules"("company_id", "state_code");

-- CreateIndex
CREATE INDEX "payroll_statutory_company_id_period_key_idx" ON "payroll_statutory"("company_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_statutory_company_id_payroll_run_id_employee_id_key" ON "payroll_statutory"("company_id", "payroll_run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_tax_declarations_company_id_employee_id_fy_code_key" ON "employee_tax_declarations"("company_id", "employee_id", "fy_code");

-- AddForeignKey
ALTER TABLE "statutory_rules" ADD CONSTRAINT "statutory_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statutory" ADD CONSTRAINT "payroll_statutory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_tax_declarations" ADD CONSTRAINT "employee_tax_declarations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['statutory_rules','payroll_statutory','employee_tax_declarations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: payroll is a book of account and a declaration decides how much tax comes off
-- someone's pay (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_payroll_statutory ON "payroll_statutory";
CREATE TRIGGER audit_payroll_statutory AFTER INSERT OR UPDATE OR DELETE ON "payroll_statutory" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_employee_tax_declarations ON "employee_tax_declarations";
CREATE TRIGGER audit_employee_tax_declarations AFTER INSERT OR UPDATE OR DELETE ON "employee_tax_declarations" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_statutory_rules ON "statutory_rules";
CREATE TRIGGER audit_statutory_rules AFTER INSERT OR UPDATE OR DELETE ON "statutory_rules" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
