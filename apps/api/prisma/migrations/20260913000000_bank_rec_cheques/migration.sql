-- CreateEnum
CREATE TYPE "StatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ChequeKind" AS ENUM ('RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('IN_HAND', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED');

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "bank_account_id" UUID NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "file_name" VARCHAR(160),
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "imported_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "statement_id" UUID NOT NULL,
    "bank_account_id" UUID NOT NULL,
    "txn_date" DATE NOT NULL,
    "value_date" DATE,
    "description" VARCHAR(400) NOT NULL,
    "ref_no" VARCHAR(60),
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "running_balance" DECIMAL(14,2),
    "normalised_ref" VARCHAR(60),
    "dedupe_hash" VARCHAR(64) NOT NULL,
    "status" "StatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_voucher_id" INTEGER,
    "match_confidence" INTEGER,
    "matched_by" VARCHAR(36),
    "matched_at" TIMESTAMPTZ(6),
    "notes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "kind" "ChequeKind" NOT NULL,
    "cheque_no" VARCHAR(20) NOT NULL,
    "cheque_date" DATE NOT NULL,
    "bank_name" VARCHAR(120),
    "party_name" VARCHAR(160),
    "customer_id" UUID,
    "supplier_id" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ChequeStatus" NOT NULL DEFAULT 'IN_HAND',
    "bank_account_id" UUID,
    "deposited_on" DATE,
    "cleared_on" DATE,
    "bounced_on" DATE,
    "bounce_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bounce_reason" VARCHAR(160),
    "ref_doc_type" VARCHAR(30),
    "ref_doc_id" VARCHAR(40),
    "voucher_id" INTEGER,
    "reversal_voucher_id" INTEGER,
    "notes" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statements_company_id_bank_account_id_from_date_idx" ON "bank_statements"("company_id", "bank_account_id", "from_date");

-- CreateIndex
CREATE INDEX "bank_statement_lines_company_id_bank_account_id_txn_date_idx" ON "bank_statement_lines"("company_id", "bank_account_id", "txn_date");

-- CreateIndex
CREATE INDEX "bank_statement_lines_company_id_status_idx" ON "bank_statement_lines"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_company_id_bank_account_id_dedupe_hash_key" ON "bank_statement_lines"("company_id", "bank_account_id", "dedupe_hash");

-- CreateIndex
CREATE INDEX "cheques_company_id_status_cheque_date_idx" ON "cheques"("company_id", "status", "cheque_date");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_company_id_kind_cheque_no_cheque_date_key" ON "cheques"("company_id", "kind", "cheque_no", "cheque_date");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_statements','bank_statement_lines','cheques']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: a cheque is money in transit and a reconciliation decides what the bank balance
-- means (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_cheques ON "cheques";
CREATE TRIGGER audit_cheques AFTER INSERT OR UPDATE OR DELETE ON "cheques" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_bank_statements ON "bank_statements";
CREATE TRIGGER audit_bank_statements AFTER INSERT OR UPDATE OR DELETE ON "bank_statements" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
