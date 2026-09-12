-- CreateEnum
CREATE TYPE "StockMoveKind" AS ENUM ('OPENING', 'RECEIPT', 'ISSUE', 'PRODUCTION_IN', 'SCRAP', 'ADJUSTMENT', 'RETURN_IN', 'RETURN_OUT');

-- CreateEnum
CREATE TYPE "CostCentreKind" AS ENUM ('PRODUCTION', 'SERVICE', 'ADMIN', 'SALES');

-- AlterTable
ALTER TABLE "journal_items" ADD COLUMN     "cost_centre_id" UUID;

-- CreateTable
CREATE TABLE "stock_valuation_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "item_type" VARCHAR(16) NOT NULL,
    "item_id" VARCHAR(40) NOT NULL,
    "store_id" VARCHAR(20),
    "moved_on" DATE NOT NULL,
    "kind" "StockMoveKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "balance_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "avg_rate" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "went_negative" BOOLEAN NOT NULL DEFAULT false,
    "ref_doc_type" VARCHAR(30),
    "ref_doc_id" VARCHAR(40),
    "narration" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_valuation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" "CostCentreKind" NOT NULL DEFAULT 'PRODUCTION',
    "parent_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "fy_code" VARCHAR(10) NOT NULL,
    "period_key" VARCHAR(7),
    "ledger_id" INTEGER NOT NULL,
    "cost_centre_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "scope_key" VARCHAR(120) NOT NULL,
    "notes" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cost_sheets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "product_id" BIGINT NOT NULL,
    "period_key" VARCHAR(7) NOT NULL,
    "quantity_produced" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "material_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labour_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overhead_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "scrap_credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "per_unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "overhead_basis" VARCHAR(40),
    "lines" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_cost_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_valuation_entries_company_id_item_type_item_id_store__idx" ON "stock_valuation_entries"("company_id", "item_type", "item_id", "store_id", "moved_on");

-- CreateIndex
CREATE INDEX "stock_valuation_entries_company_id_moved_on_idx" ON "stock_valuation_entries"("company_id", "moved_on");

-- CreateIndex
CREATE INDEX "cost_centres_company_id_parent_id_idx" ON "cost_centres"("company_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_company_id_code_key" ON "cost_centres"("company_id", "code");

-- CreateIndex
CREATE INDEX "budgets_company_id_fy_code_idx" ON "budgets"("company_id", "fy_code");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_company_id_scope_key_key" ON "budgets"("company_id", "scope_key");

-- CreateIndex
CREATE INDEX "product_cost_sheets_company_id_period_key_idx" ON "product_cost_sheets"("company_id", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "product_cost_sheets_company_id_product_id_period_key_key" ON "product_cost_sheets"("company_id", "product_id", "period_key");

-- AddForeignKey
ALTER TABLE "journal_items" ADD CONSTRAINT "journal_items_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_valuation_entries" ADD CONSTRAINT "stock_valuation_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "account_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_sheets" ADD CONSTRAINT "product_cost_sheets_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_sheets" ADD CONSTRAINT "product_cost_sheets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_valuation_entries','cost_centres','budgets','product_cost_sheets']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: the valuation ledger decides the closing stock on the balance sheet, and a cost
-- centre decides which department carries a cost (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_stock_valuation_entries ON "stock_valuation_entries";
CREATE TRIGGER audit_stock_valuation_entries AFTER INSERT OR UPDATE OR DELETE ON "stock_valuation_entries" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_cost_centres ON "cost_centres";
CREATE TRIGGER audit_cost_centres AFTER INSERT OR UPDATE OR DELETE ON "cost_centres" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_budgets ON "budgets";
CREATE TRIGGER audit_budgets AFTER INSERT OR UPDATE OR DELETE ON "budgets" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
