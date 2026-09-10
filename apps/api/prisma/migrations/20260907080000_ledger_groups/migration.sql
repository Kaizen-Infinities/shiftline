-- AlterTable
ALTER TABLE "account_ledgers" ADD COLUMN     "group_id" INTEGER;

-- CreateTable
CREATE TABLE "ledger_groups" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nature" "LedgerType" NOT NULL,
    "parent_id" INTEGER,
    "schedule_head" VARCHAR(80),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ledger_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_groups_company_id_parent_id_idx" ON "ledger_groups"("company_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_groups_company_id_code_key" ON "ledger_groups"("company_id", "code");

-- AddForeignKey
ALTER TABLE "ledger_groups" ADD CONSTRAINT "ledger_groups_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ledger_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_groups" ADD CONSTRAINT "ledger_groups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_ledgers" ADD CONSTRAINT "account_ledgers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "ledger_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "ledger_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ledger_groups";
CREATE POLICY tenant_isolation ON "ledger_groups" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "ledger_groups";
CREATE POLICY platform_bypass ON "ledger_groups" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: the chart of accounts is a master of the books (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_ledger_groups ON "ledger_groups";
CREATE TRIGGER audit_ledger_groups AFTER INSERT OR UPDATE OR DELETE ON "ledger_groups" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
