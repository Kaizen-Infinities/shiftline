-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable: leave without pay (P2-09) — a leave type marked allow_negative may take a
-- balance negative on approval instead of being refused for insufficient balance.
ALTER TABLE "leave_types" ADD COLUMN "allow_negative" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employee_id" BIGINT NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "fy_code" VARCHAR(10) NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "half_day_start" BOOLEAN NOT NULL DEFAULT false,
    "half_day_end" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "reason" VARCHAR(255),
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "applied_by" VARCHAR(36),
    "approver_id" VARCHAR(36),
    "decided_at" TIMESTAMPTZ(6),
    "comments" VARCHAR(255),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_requests_company_id_employee_id_status_idx" ON "leave_requests"("company_id", "employee_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_company_id_from_date_to_date_idx" ON "leave_requests"("company_id", "from_date", "to_date");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: a leave request changes a leave balance and is argued about the same way a
-- settlement is (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_leave_requests ON "leave_requests";
CREATE TRIGGER audit_leave_requests AFTER INSERT OR UPDATE OR DELETE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
