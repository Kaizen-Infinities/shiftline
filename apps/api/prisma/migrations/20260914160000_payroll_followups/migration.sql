-- AlterTable
ALTER TABLE "payroll_results" ADD COLUMN     "ot_hours_over_cap" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "overtime_quarter_periods" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employee_id" BIGINT NOT NULL,
    "quarter_key" VARCHAR(7) NOT NULL,
    "quarter_start" DATE NOT NULL,
    "quarter_end" DATE NOT NULL,
    "hours_accrued" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "breached" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "overtime_quarter_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "overtime_quarter_periods_company_id_employee_id_quarter_key_key" ON "overtime_quarter_periods"("company_id", "employee_id", "quarter_key");

-- AddForeignKey
ALTER TABLE "overtime_quarter_periods" ADD CONSTRAINT "overtime_quarter_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data migration (P2-16): employees created before work_state_code existed (P2-02) never got a
-- value backfilled onto them. Default every NULL to the employing company's own state, the same
-- state the run already falls back to at compute time when the column is NULL — so this changes
-- what is stored, not what payroll has been charging.
UPDATE "employees" e
SET "work_state_code" = c."state_code"
FROM "companies" c
WHERE e."company_id" = c."id"
  AND e."work_state_code" IS NULL
  AND c."state_code" IS NOT NULL;

-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['overtime_quarter_periods']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: the overtime quarterly running total feeds payroll and the OSH Code compliance
-- record, same as the rest of the statutory payroll tables (same trigger as
-- 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_overtime_quarter_periods ON "overtime_quarter_periods";
CREATE TRIGGER audit_overtime_quarter_periods AFTER INSERT OR UPDATE OR DELETE ON "overtime_quarter_periods" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

