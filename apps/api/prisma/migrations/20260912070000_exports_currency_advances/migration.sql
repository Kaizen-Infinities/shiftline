-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('UNDER_LUT', 'WITH_TAX');

-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('MANUAL', 'RBI', 'IMPORT');

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
ADD COLUMN     "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "export_type" "ExportType",
ADD COLUMN     "foreign_total" DECIMAL(14,2),
ADD COLUMN     "lut_number" VARCHAR(30),
ADD COLUMN     "port_code" VARCHAR(10),
ADD COLUMN     "shipping_bill_date" DATE,
ADD COLUMN     "shipping_bill_no" VARCHAR(20);

-- CreateTable
CREATE TABLE "currencies" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "symbol" VARCHAR(6),
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "currency_code" VARCHAR(3) NOT NULL,
    "rate_date" DATE NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'MANUAL',
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "receipt_no" VARCHAR(30) NOT NULL,
    "receipt_date" DATE NOT NULL,
    "customer_id" UUID NOT NULL,
    "business_place_id" BIGINT,
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cess" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "place_of_supply" VARCHAR(2),
    "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE',
    "customer_gstin" VARCHAR(15),
    "payment_method" VARCHAR(50) NOT NULL DEFAULT 'Bank',
    "reference_number" VARCHAR(100),
    "narration" VARCHAR(500),
    "adjusted_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(36),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "advance_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_adjustments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "advance_id" UUID NOT NULL,
    "sales_invoice_id" UUID,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'ADJUSTED',
    "amount" DECIMAL(14,2) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refund_voucher_no" VARCHAR(30),
    "adjusted_on" DATE NOT NULL,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_company_id_code_key" ON "currencies"("company_id", "code");

-- CreateIndex
CREATE INDEX "exchange_rates_company_id_currency_code_rate_date_idx" ON "exchange_rates"("company_id", "currency_code", "rate_date");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_company_id_currency_code_rate_date_key" ON "exchange_rates"("company_id", "currency_code", "rate_date");

-- CreateIndex
CREATE INDEX "advance_receipts_company_id_customer_id_status_idx" ON "advance_receipts"("company_id", "customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "advance_receipts_company_id_receipt_no_key" ON "advance_receipts"("company_id", "receipt_no");

-- CreateIndex
CREATE INDEX "advance_adjustments_company_id_advance_id_idx" ON "advance_adjustments"("company_id", "advance_id");

-- CreateIndex
CREATE INDEX "advance_adjustments_sales_invoice_id_idx" ON "advance_adjustments"("sales_invoice_id");

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_currency_code_fkey" FOREIGN KEY ("company_id", "currency_code") REFERENCES "currencies"("company_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_receipts" ADD CONSTRAINT "advance_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "advance_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_adjustments" ADD CONSTRAINT "advance_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['currencies','exchange_rates','advance_receipts','advance_adjustments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: advances are books of account and the currency master feeds every conversion
-- (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_advance_receipts ON "advance_receipts";
CREATE TRIGGER audit_advance_receipts AFTER INSERT OR UPDATE OR DELETE ON "advance_receipts" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_advance_adjustments ON "advance_adjustments";
CREATE TRIGGER audit_advance_adjustments AFTER INSERT OR UPDATE OR DELETE ON "advance_adjustments" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_currencies ON "currencies";
CREATE TRIGGER audit_currencies AFTER INSERT OR UPDATE OR DELETE ON "currencies" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_exchange_rates ON "exchange_rates";
CREATE TRIGGER audit_exchange_rates AFTER INSERT OR UPDATE OR DELETE ON "exchange_rates" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
