-- CreateEnum
CREATE TYPE "CustomerScheduleStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleFirmness" AS ENUM ('FIRM', 'TENTATIVE');

-- CreateTable
CREATE TABLE "customer_schedules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "schedule_no" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "customer_po_no" VARCHAR(40),
    "period_month" DATE NOT NULL,
    "received_on" DATE NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "status" "CustomerScheduleStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(500),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_schedule_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "schedule_id" UUID NOT NULL,
    "product_id" BIGINT,
    "customer_part_no" VARCHAR(40) NOT NULL,
    "description" VARCHAR(120),
    "due_date" DATE NOT NULL,
    "firmness" "ScheduleFirmness" NOT NULL DEFAULT 'FIRM',
    "scheduled_qty" DECIMAL(14,3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_schedule_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_schedule_dispatches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "line_id" UUID NOT NULL,
    "dispatch_date" DATE NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "sales_invoice_id" UUID,
    "invoice_no" VARCHAR(30),
    "asn_no" VARCHAR(40),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_schedule_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_schedules_company_id_customer_id_period_month_idx" ON "customer_schedules"("company_id", "customer_id", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "customer_schedules_company_id_schedule_no_revision_key" ON "customer_schedules"("company_id", "schedule_no", "revision");

-- CreateIndex
CREATE INDEX "customer_schedule_lines_company_id_due_date_idx" ON "customer_schedule_lines"("company_id", "due_date");

-- CreateIndex
CREATE INDEX "customer_schedule_lines_schedule_id_idx" ON "customer_schedule_lines"("schedule_id");

-- CreateIndex
CREATE INDEX "customer_schedule_dispatches_line_id_idx" ON "customer_schedule_dispatches"("line_id");

-- CreateIndex
CREATE INDEX "customer_schedule_dispatches_company_id_dispatch_date_idx" ON "customer_schedule_dispatches"("company_id", "dispatch_date");

-- AddForeignKey
ALTER TABLE "customer_schedules" ADD CONSTRAINT "customer_schedules_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_schedules" ADD CONSTRAINT "customer_schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_schedule_lines" ADD CONSTRAINT "customer_schedule_lines_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "customer_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_schedule_lines" ADD CONSTRAINT "customer_schedule_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_schedule_lines" ADD CONSTRAINT "customer_schedule_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_schedule_dispatches" ADD CONSTRAINT "customer_schedule_dispatches_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "customer_schedule_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_schedule_dispatches" ADD CONSTRAINT "customer_schedule_dispatches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_schedules', 'customer_schedule_lines', 'customer_schedule_dispatches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-02): the schedule and the dispatches booked against it decide the
-- supplier's vendor rating, so every change is kept (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_customer_schedules ON "customer_schedules";
CREATE TRIGGER audit_customer_schedules AFTER INSERT OR UPDATE OR DELETE ON "customer_schedules" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_customer_schedule_lines ON "customer_schedule_lines";
CREATE TRIGGER audit_customer_schedule_lines AFTER INSERT OR UPDATE OR DELETE ON "customer_schedule_lines" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_customer_schedule_dispatches ON "customer_schedule_dispatches";
CREATE TRIGGER audit_customer_schedule_dispatches AFTER INSERT OR UPDATE OR DELETE ON "customer_schedule_dispatches" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

