-- CreateEnum
CREATE TYPE "OrderTnaStatus" AS ENUM ('ACTIVE', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TnaMilestoneStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "order_tnas" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "tna_no" VARCHAR(30) NOT NULL,
    "customer_id" UUID NOT NULL,
    "sales_order_id" INTEGER,
    "buyer_po_no" VARCHAR(40) NOT NULL,
    "style_ref" VARCHAR(60) NOT NULL,
    "description" VARCHAR(200),
    "order_qty" DECIMAL(14,3) NOT NULL,
    "uom" VARCHAR(10),
    "order_date" DATE NOT NULL,
    "ex_factory_date" DATE NOT NULL,
    "template" VARCHAR(30) NOT NULL,
    "merchandiser" VARCHAR(80),
    "status" "OrderTnaStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_tnas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_tna_milestones" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "tna_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "planned_date" DATE NOT NULL,
    "actual_date" DATE,
    "status" "TnaMilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "owner" VARCHAR(80),
    "remarks" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_tna_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_tnas_company_id_status_ex_factory_date_idx" ON "order_tnas"("company_id", "status", "ex_factory_date");

-- CreateIndex
CREATE UNIQUE INDEX "order_tnas_company_id_tna_no_key" ON "order_tnas"("company_id", "tna_no");

-- CreateIndex
CREATE INDEX "order_tna_milestones_company_id_status_planned_date_idx" ON "order_tna_milestones"("company_id", "status", "planned_date");

-- CreateIndex
CREATE UNIQUE INDEX "order_tna_milestones_tna_id_seq_key" ON "order_tna_milestones"("tna_id", "seq");

-- AddForeignKey
ALTER TABLE "order_tnas" ADD CONSTRAINT "order_tnas_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tnas" ADD CONSTRAINT "order_tnas_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tna_milestones" ADD CONSTRAINT "order_tna_milestones_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_tna_milestones" ADD CONSTRAINT "order_tna_milestones_tna_id_fkey" FOREIGN KEY ("tna_id") REFERENCES "order_tnas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_tnas', 'order_tna_milestones']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-03): the T&A plan and its milestone dates are what the buyer's merchandiser
-- argues about, so every change is kept (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_order_tnas ON "order_tnas";
CREATE TRIGGER audit_order_tnas AFTER INSERT OR UPDATE OR DELETE ON "order_tnas" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_order_tna_milestones ON "order_tna_milestones";
CREATE TRIGGER audit_order_tna_milestones AFTER INSERT OR UPDATE OR DELETE ON "order_tna_milestones" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

