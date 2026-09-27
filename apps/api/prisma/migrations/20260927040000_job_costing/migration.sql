-- CreateEnum
CREATE TYPE "ProjectJobStatus" AS ENUM ('QUOTED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectJobStageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ProjectJobCostType" AS ENUM ('MATERIAL', 'LABOUR', 'SUBCONTRACT', 'OVERHEAD');

-- CreateEnum
CREATE TYPE "ProjectJobCostStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "ProjectJobBillingKind" AS ENUM ('ADVANCE', 'STAGE_INVOICE', 'FINAL');

-- CreateTable
CREATE TABLE "project_jobs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "job_no" VARCHAR(30) NOT NULL,
    "customer_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "quoted_amount" DECIMAL(14,2) NOT NULL,
    "quote_date" DATE NOT NULL,
    "target_date" DATE,
    "chassis_no" VARCHAR(40),
    "chassis_make" VARCHAR(80),
    "chassis_received_on" DATE,
    "condition_notes" VARCHAR(500),
    "status" "ProjectJobStatus" NOT NULL DEFAULT 'QUOTED',
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_job_stages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "job_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "planned_start" DATE,
    "planned_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "status" "ProjectJobStageStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_job_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_job_costs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "job_id" UUID NOT NULL,
    "type" "ProjectJobCostType" NOT NULL,
    "cost_date" DATE NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "uom" VARCHAR(20),
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "raw_material_id" UUID,
    "stock_issue_id" BIGINT,
    "employee_id" BIGINT,
    "vendor_name" VARCHAR(120),
    "status" "ProjectJobCostStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_job_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_job_billings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "job_id" UUID NOT NULL,
    "kind" "ProjectJobBillingKind" NOT NULL,
    "bill_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "advance_adjusted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stage_id" UUID,
    "sales_invoice_id" UUID,
    "reference" VARCHAR(60),
    "remarks" VARCHAR(300),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_job_billings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_jobs_company_id_status_idx" ON "project_jobs"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_jobs_company_id_job_no_key" ON "project_jobs"("company_id", "job_no");

-- CreateIndex
CREATE INDEX "project_job_stages_company_id_idx" ON "project_job_stages"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_job_stages_job_id_seq_key" ON "project_job_stages"("job_id", "seq");

-- CreateIndex
CREATE INDEX "project_job_costs_company_id_job_id_type_idx" ON "project_job_costs"("company_id", "job_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "project_job_costs_company_id_stock_issue_id_key" ON "project_job_costs"("company_id", "stock_issue_id");

-- CreateIndex
CREATE INDEX "project_job_billings_company_id_job_id_idx" ON "project_job_billings"("company_id", "job_id");

-- AddForeignKey
ALTER TABLE "project_jobs" ADD CONSTRAINT "project_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_jobs" ADD CONSTRAINT "project_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_stages" ADD CONSTRAINT "project_job_stages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_stages" ADD CONSTRAINT "project_job_stages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_costs" ADD CONSTRAINT "project_job_costs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_costs" ADD CONSTRAINT "project_job_costs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_billings" ADD CONSTRAINT "project_job_billings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_billings" ADD CONSTRAINT "project_job_billings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "project_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_job_billings" ADD CONSTRAINT "project_job_billings_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "project_job_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_jobs', 'project_job_stages', 'project_job_costs', 'project_job_billings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-09): the quote, the custody record of the customer's chassis, the costs booked
-- and the money billed against a job are what the customer disputes, so every change is kept
-- (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_project_jobs ON "project_jobs";
CREATE TRIGGER audit_project_jobs AFTER INSERT OR UPDATE OR DELETE ON "project_jobs" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_project_job_stages ON "project_job_stages";
CREATE TRIGGER audit_project_job_stages AFTER INSERT OR UPDATE OR DELETE ON "project_job_stages" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_project_job_costs ON "project_job_costs";
CREATE TRIGGER audit_project_job_costs AFTER INSERT OR UPDATE OR DELETE ON "project_job_costs" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_project_job_billings ON "project_job_billings";
CREATE TRIGGER audit_project_job_billings AFTER INSERT OR UPDATE OR DELETE ON "project_job_billings" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
