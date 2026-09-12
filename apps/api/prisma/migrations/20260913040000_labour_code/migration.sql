-- CreateEnum
CREATE TYPE "LeaveAccrualBasis" AS ENUM ('ANNUAL', 'MONTHLY', 'DAYS_WORKED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "holiday_on" DATE NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'FESTIVAL',
    "state_code" VARCHAR(2),
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "days_per_year" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "basis" "LeaveAccrualBasis" NOT NULL DEFAULT 'ANNUAL',
    "days_worked_per_day" INTEGER NOT NULL DEFAULT 20,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "carry_forward_max" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "encashable" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employee_id" BIGINT NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "fy_code" VARCHAR(10) NOT NULL,
    "opening" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "accrued" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "taken" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "encashed" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "lapsed" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "closing" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_settlements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employee_id" BIGINT NOT NULL,
    "employee_code" VARCHAR(40) NOT NULL,
    "separation_on" DATE NOT NULL,
    "last_working_day" DATE NOT NULL,
    "reason" VARCHAR(160),
    "notice_days_required" INTEGER NOT NULL DEFAULT 0,
    "notice_days_served" INTEGER NOT NULL DEFAULT 0,
    "salary_due" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "leave_encashment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gratuity" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_dues" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notice_recovery" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advance_recovery" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_recovery" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "years_of_service" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "last_drawn_wage" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gratuity_eligible" BOOLEAN NOT NULL DEFAULT false,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "voucher_id" INTEGER,
    "notes" VARCHAR(255),
    "prepared_by" VARCHAR(36),
    "approved_by" VARCHAR(36),
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "final_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_company_id_holiday_on_idx" ON "holidays"("company_id", "holiday_on");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_company_id_holiday_on_name_key" ON "holidays"("company_id", "holiday_on", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_company_id_code_key" ON "leave_types"("company_id", "code");

-- CreateIndex
CREATE INDEX "leave_balances_company_id_fy_code_idx" ON "leave_balances"("company_id", "fy_code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_company_id_employee_id_leave_type_id_fy_code_key" ON "leave_balances"("company_id", "employee_id", "leave_type_id", "fy_code");

-- CreateIndex
CREATE INDEX "final_settlements_company_id_status_idx" ON "final_settlements"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "final_settlements_company_id_employee_id_separation_on_key" ON "final_settlements"("company_id", "employee_id", "separation_on");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holidays','leave_types','leave_balances','final_settlements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: a leave balance and a settlement are both money owed to a person, and both are
-- argued about (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_leave_balances ON "leave_balances";
CREATE TRIGGER audit_leave_balances AFTER INSERT OR UPDATE OR DELETE ON "leave_balances" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_final_settlements ON "final_settlements";
CREATE TRIGGER audit_final_settlements AFTER INSERT OR UPDATE OR DELETE ON "final_settlements" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_leave_types ON "leave_types";
CREATE TRIGGER audit_leave_types AFTER INSERT OR UPDATE OR DELETE ON "leave_types" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
