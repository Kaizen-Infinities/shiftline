-- CreateEnum
CREATE TYPE "ProcessStepMode" AS ENUM ('IN_HOUSE', 'JOB_WORK');

-- CreateEnum
CREATE TYPE "ProcessLotStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LotMovementDirection" AS ENUM ('OUT', 'IN');

-- CreateTable
CREATE TABLE "process_routes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "route_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "product_id" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "process_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_route_steps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "route_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "mode" "ProcessStepMode" NOT NULL,
    "default_job_worker_id" UUID,
    "loss_norm_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "uom_in" VARCHAR(20) NOT NULL,
    "uom_out" VARCHAR(20) NOT NULL,
    "conversion_factor" DECIMAL(14,6),
    "remarks" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "process_route_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_route_progress" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "lot_no" VARCHAR(30) NOT NULL,
    "route_id" UUID NOT NULL,
    "product_id" BIGINT,
    "input_qty" DECIMAL(14,3) NOT NULL,
    "input_uom" VARCHAR(20) NOT NULL,
    "start_date" DATE NOT NULL,
    "current_step_seq" INTEGER NOT NULL DEFAULT 1,
    "status" "ProcessLotStatus" NOT NULL DEFAULT 'OPEN',
    "remarks" VARCHAR(300),
    "closed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lot_route_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_step_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "lot_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "step_seq" INTEGER NOT NULL,
    "direction" "LotMovementDirection" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "movement_date" DATE NOT NULL,
    "job_worker_id" UUID,
    "challan_id" UUID,
    "closes_step" BOOLEAN NOT NULL DEFAULT false,
    "remarks" VARCHAR(300),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lot_step_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "process_routes_company_id_active_idx" ON "process_routes"("company_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "process_routes_company_id_route_code_key" ON "process_routes"("company_id", "route_code");

-- CreateIndex
CREATE INDEX "process_route_steps_company_id_idx" ON "process_route_steps"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "process_route_steps_route_id_seq_key" ON "process_route_steps"("route_id", "seq");

-- CreateIndex
CREATE INDEX "lot_route_progress_company_id_status_idx" ON "lot_route_progress"("company_id", "status");

-- CreateIndex
CREATE INDEX "lot_route_progress_route_id_idx" ON "lot_route_progress"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_route_progress_company_id_lot_no_key" ON "lot_route_progress"("company_id", "lot_no");

-- CreateIndex
CREATE INDEX "lot_step_movements_company_id_lot_id_idx" ON "lot_step_movements"("company_id", "lot_id");

-- CreateIndex
CREATE INDEX "lot_step_movements_challan_id_idx" ON "lot_step_movements"("challan_id");

-- CreateIndex
CREATE INDEX "lot_step_movements_job_worker_id_idx" ON "lot_step_movements"("job_worker_id");

-- AddForeignKey
ALTER TABLE "process_routes" ADD CONSTRAINT "process_routes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_routes" ADD CONSTRAINT "process_routes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_route_steps" ADD CONSTRAINT "process_route_steps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_route_steps" ADD CONSTRAINT "process_route_steps_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_route_steps" ADD CONSTRAINT "process_route_steps_default_job_worker_id_fkey" FOREIGN KEY ("default_job_worker_id") REFERENCES "job_workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_route_progress" ADD CONSTRAINT "lot_route_progress_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_route_progress" ADD CONSTRAINT "lot_route_progress_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "process_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_route_progress" ADD CONSTRAINT "lot_route_progress_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_step_movements" ADD CONSTRAINT "lot_step_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_step_movements" ADD CONSTRAINT "lot_step_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lot_route_progress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_step_movements" ADD CONSTRAINT "lot_step_movements_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "process_route_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_step_movements" ADD CONSTRAINT "lot_step_movements_job_worker_id_fkey" FOREIGN KEY ("job_worker_id") REFERENCES "job_workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_step_movements" ADD CONSTRAINT "lot_step_movements_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "delivery_challans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['process_routes', 'process_route_steps', 'lot_route_progress', 'lot_step_movements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-06): the route and its loss norms are the master a job worker's loss is judged
-- against, and each lot movement is the record of what was sent and what came back, so every
-- change is kept (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_process_routes ON "process_routes";
CREATE TRIGGER audit_process_routes AFTER INSERT OR UPDATE OR DELETE ON "process_routes" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_process_route_steps ON "process_route_steps";
CREATE TRIGGER audit_process_route_steps AFTER INSERT OR UPDATE OR DELETE ON "process_route_steps" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_lot_route_progress ON "lot_route_progress";
CREATE TRIGGER audit_lot_route_progress AFTER INSERT OR UPDATE OR DELETE ON "lot_route_progress" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_lot_step_movements ON "lot_step_movements";
CREATE TRIGGER audit_lot_step_movements AFTER INSERT OR UPDATE OR DELETE ON "lot_step_movements" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
