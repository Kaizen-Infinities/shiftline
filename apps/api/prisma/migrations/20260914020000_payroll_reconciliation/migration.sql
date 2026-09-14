-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "work_state_code" VARCHAR(2);

-- AlterTable
ALTER TABLE "payroll_results" ADD COLUMN     "salary_tds" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "esi_contribution_periods" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employee_id" BIGINT NOT NULL,
    "period_key" VARCHAR(9) NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "wage_at_start" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "esi_contribution_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "esi_contribution_periods_company_id_employee_id_period_key_key" ON "esi_contribution_periods"("company_id", "employee_id", "period_key");

-- AddForeignKey
ALTER TABLE "esi_contribution_periods" ADD CONSTRAINT "esi_contribution_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['esi_contribution_periods']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: the ESI contribution-period decision feeds the monthly filing, same as the rest of
-- the statutory payroll tables (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_esi_contribution_periods ON "esi_contribution_periods";
CREATE TRIGGER audit_esi_contribution_periods AFTER INSERT OR UPDATE OR DELETE ON "esi_contribution_periods" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
