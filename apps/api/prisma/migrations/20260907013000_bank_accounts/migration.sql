-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "ledger_id" INTEGER NOT NULL,
    "bank_name" VARCHAR(120) NOT NULL,
    "account_name" VARCHAR(160),
    "account_number" VARCHAR(34),
    "ifsc" VARCHAR(11),
    "branch" VARCHAR(120),
    "upi_id" VARCHAR(80),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledger_id_key" ON "bank_accounts"("ledger_id");

-- CreateIndex
CREATE INDEX "bank_accounts_company_id_idx" ON "bank_accounts"("company_id");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_id_fkey" FOREIGN KEY ("ledger_id") REFERENCES "account_ledgers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "bank_accounts";
CREATE POLICY tenant_isolation ON "bank_accounts" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "bank_accounts";
CREATE POLICY platform_bypass ON "bank_accounts" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail (same trigger as 20260906235000_audit_trail; BankAccount is in AUDITED_MODELS).
DROP TRIGGER IF EXISTS audit_bank_accounts ON "bank_accounts";
CREATE TRIGGER audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON "bank_accounts" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
