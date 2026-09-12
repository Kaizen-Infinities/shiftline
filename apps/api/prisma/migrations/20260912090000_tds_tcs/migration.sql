-- CreateEnum
CREATE TYPE "DeducteeType" AS ENUM ('COMPANY', 'INDIVIDUAL_HUF', 'FIRM', 'AOP_BOI', 'LOCAL_AUTHORITY', 'NON_RESIDENT');

-- CreateEnum
CREATE TYPE "TdsEventKind" AS ENUM ('ON_BILL', 'ON_PAYMENT', 'ON_COLLECTION');

-- CreateEnum
CREATE TYPE "TdsDeductionStatus" AS ENUM ('PENDING', 'CHALLAN_PAID', 'RETURN_FILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "pan" VARCHAR(10),
ADD COLUMN     "tan" VARCHAR(10);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "deductee_type" "DeducteeType",
ADD COLUMN     "higher_rate_206ab" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tds_sections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "act_code" VARCHAR(40),
    "name" VARCHAR(160) NOT NULL,
    "is_tcs" BOOLEAN NOT NULL DEFAULT false,
    "rate_company" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rate_individual" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "rate_no_pan" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "threshold_single" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "threshold_annual" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ledger_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tds_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_deductions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "section_id" UUID NOT NULL,
    "supplier_id" INTEGER,
    "deductee_name" VARCHAR(160) NOT NULL,
    "deductee_pan" VARCHAR(10),
    "deductee_type" "DeducteeType" NOT NULL DEFAULT 'COMPANY',
    "higher_rate" BOOLEAN NOT NULL DEFAULT false,
    "kind" "TdsEventKind" NOT NULL DEFAULT 'ON_BILL',
    "doc_type" VARCHAR(16) NOT NULL,
    "doc_id" VARCHAR(40) NOT NULL,
    "doc_no" VARCHAR(40) NOT NULL,
    "deduction_date" DATE NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fy_code" VARCHAR(7) NOT NULL,
    "quarter" VARCHAR(2) NOT NULL,
    "challan_id" UUID,
    "status" "TdsDeductionStatus" NOT NULL DEFAULT 'PENDING',
    "rate_reason" VARCHAR(160),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "tds_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tds_challans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "bsr_code" VARCHAR(7) NOT NULL,
    "challan_serial" VARCHAR(10) NOT NULL,
    "challan_date" DATE NOT NULL,
    "period_key" VARCHAR(7) NOT NULL,
    "fy_code" VARCHAR(7) NOT NULL,
    "quarter" VARCHAR(2) NOT NULL,
    "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "education_cess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "late_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payment_code" VARCHAR(3) NOT NULL DEFAULT '200',
    "is_tcs" BOOLEAN NOT NULL DEFAULT false,
    "remarks" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tds_challans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tds_sections_company_id_code_key" ON "tds_sections"("company_id", "code");

-- CreateIndex
CREATE INDEX "tds_deductions_company_id_fy_code_quarter_idx" ON "tds_deductions"("company_id", "fy_code", "quarter");

-- CreateIndex
CREATE INDEX "tds_deductions_company_id_status_idx" ON "tds_deductions"("company_id", "status");

-- CreateIndex
CREATE INDEX "tds_deductions_challan_id_idx" ON "tds_deductions"("challan_id");

-- CreateIndex
CREATE UNIQUE INDEX "tds_deductions_company_id_doc_type_doc_id_section_id_key" ON "tds_deductions"("company_id", "doc_type", "doc_id", "section_id");

-- CreateIndex
CREATE INDEX "tds_challans_company_id_fy_code_quarter_idx" ON "tds_challans"("company_id", "fy_code", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "tds_challans_company_id_bsr_code_challan_serial_challan_dat_key" ON "tds_challans"("company_id", "bsr_code", "challan_serial", "challan_date");

-- AddForeignKey
ALTER TABLE "tds_sections" ADD CONSTRAINT "tds_sections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "tds_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "tds_challans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tds_challans" ADD CONSTRAINT "tds_challans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tds_sections','tds_deductions','tds_challans']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: a deduction is money withheld on someone else's behalf and a challan is its
-- payment to the government (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_tds_sections ON "tds_sections";
CREATE TRIGGER audit_tds_sections AFTER INSERT OR UPDATE OR DELETE ON "tds_sections" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_tds_deductions ON "tds_deductions";
CREATE TRIGGER audit_tds_deductions AFTER INSERT OR UPDATE OR DELETE ON "tds_deductions" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_tds_challans ON "tds_challans";
CREATE TRIGGER audit_tds_challans AFTER INSERT OR UPDATE OR DELETE ON "tds_challans" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
