-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('SLM', 'WDV');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'DISPOSED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "AssetEventKind" AS ENUM ('ADDITION', 'REVALUATION', 'TRANSFER', 'DISPOSAL', 'IMPAIRMENT');

-- CreateEnum
CREATE TYPE "DepreciationRunStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "asset_classes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "useful_life_years" INTEGER NOT NULL DEFAULT 15,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'SLM',
    "residual_percent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "schedule_ii_head" VARCHAR(80),
    "it_block_name" VARCHAR(80),
    "it_block_rate" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "asset_ledger_code" VARCHAR(30) NOT NULL,
    "accum_dep_ledger_code" VARCHAR(30) NOT NULL,
    "dep_expense_ledger_code" VARCHAR(30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "class_id" UUID NOT NULL,
    "business_place_id" BIGINT,
    "acquired_on" DATE NOT NULL,
    "capitalised_on" DATE NOT NULL,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "residual_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'SLM',
    "useful_life_months" INTEGER NOT NULL,
    "accumulated_depreciation" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "serial_no" VARCHAR(80),
    "location" VARCHAR(120),
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_doc_type" VARCHAR(20),
    "source_doc_id" VARCHAR(40),
    "supplier_id" INTEGER,
    "disposed_on" DATE,
    "disposal_proceeds" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "asset_id" UUID NOT NULL,
    "kind" "AssetEventKind" NOT NULL,
    "effective_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "wdv_at_event" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "result_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "from_business_place_id" BIGINT,
    "to_business_place_id" BIGINT,
    "narration" VARCHAR(255),
    "voucher_id" INTEGER,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "period_key" VARCHAR(7) NOT NULL,
    "status" "DepreciationRunStatus" NOT NULL DEFAULT 'DRAFT',
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "voucher_id" INTEGER,
    "prepared_by" VARCHAR(36),
    "posted_by" VARCHAR(36),
    "posted_at" TIMESTAMPTZ(6),
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_depreciations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "run_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "period_key" VARCHAR(7) NOT NULL,
    "days_in_use" INTEGER NOT NULL DEFAULT 0,
    "opening_wdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_wdv" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "method" "DepreciationMethod" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_classes_company_id_code_key" ON "asset_classes"("company_id", "code");

-- CreateIndex
CREATE INDEX "fixed_assets_company_id_status_idx" ON "fixed_assets"("company_id", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_company_id_class_id_idx" ON "fixed_assets"("company_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_company_id_code_key" ON "fixed_assets"("company_id", "code");

-- CreateIndex
CREATE INDEX "asset_events_company_id_asset_id_idx" ON "asset_events"("company_id", "asset_id");

-- CreateIndex
CREATE INDEX "asset_events_company_id_effective_on_idx" ON "asset_events"("company_id", "effective_on");

-- CreateIndex
CREATE INDEX "depreciation_runs_company_id_status_idx" ON "depreciation_runs"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_runs_company_id_period_key_key" ON "depreciation_runs"("company_id", "period_key");

-- CreateIndex
CREATE INDEX "asset_depreciations_company_id_period_key_idx" ON "asset_depreciations"("company_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "asset_depreciations_company_id_asset_id_period_key_key" ON "asset_depreciations"("company_id", "asset_id", "period_key");

-- AddForeignKey
ALTER TABLE "asset_classes" ADD CONSTRAINT "asset_classes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "asset_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "depreciation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_classes','fixed_assets','asset_events','depreciation_runs','asset_depreciations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: the register is a book of account in its own right — the balance sheet's largest
-- number is built from it (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_asset_classes ON "asset_classes";
CREATE TRIGGER audit_asset_classes AFTER INSERT OR UPDATE OR DELETE ON "asset_classes" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_fixed_assets ON "fixed_assets";
CREATE TRIGGER audit_fixed_assets AFTER INSERT OR UPDATE OR DELETE ON "fixed_assets" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_asset_events ON "asset_events";
CREATE TRIGGER audit_asset_events AFTER INSERT OR UPDATE OR DELETE ON "asset_events" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_depreciation_runs ON "depreciation_runs";
CREATE TRIGGER audit_depreciation_runs AFTER INSERT OR UPDATE OR DELETE ON "depreciation_runs" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
