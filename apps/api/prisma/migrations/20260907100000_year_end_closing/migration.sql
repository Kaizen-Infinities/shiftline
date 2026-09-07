-- CreateEnum
CREATE TYPE "YearEndStatus" AS ENUM ('PREPARED', 'APPROVED', 'REVERSED', 'DISCARDED');

-- CreateTable
CREATE TABLE "year_end_closings" (
    "id" SERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "fy_code" VARCHAR(10) NOT NULL,
    "fy_start" DATE NOT NULL,
    "fy_end" DATE NOT NULL,
    "status" "YearEndStatus" NOT NULL DEFAULT 'PREPARED',
    "total_income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_expense" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_profit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "retained_earnings_ledger_id" INTEGER NOT NULL,
    "notes" VARCHAR(255),
    "prepared_by" VARCHAR(36),
    "prepared_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" VARCHAR(36),
    "approved_at" TIMESTAMPTZ(6),
    "reversed_by" VARCHAR(36),
    "reversed_at" TIMESTAMPTZ(6),
    "reverse_reason" VARCHAR(255),
    "closing_voucher_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "year_end_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "year_end_closings_closing_voucher_id_key" ON "year_end_closings"("closing_voucher_id");

-- CreateIndex
CREATE INDEX "year_end_closings_company_id_fy_code_idx" ON "year_end_closings"("company_id", "fy_code");

-- AddForeignKey
ALTER TABLE "year_end_closings" ADD CONSTRAINT "year_end_closings_closing_voucher_id_fkey" FOREIGN KEY ("closing_voucher_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_end_closings" ADD CONSTRAINT "year_end_closings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "year_end_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "year_end_closings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "year_end_closings";
CREATE POLICY tenant_isolation ON "year_end_closings" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "year_end_closings";
CREATE POLICY platform_bypass ON "year_end_closings" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: a year-end closing is a book entry (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_year_end_closings ON "year_end_closings";
CREATE TRIGGER audit_year_end_closings AFTER INSERT OR UPDATE OR DELETE ON "year_end_closings" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
