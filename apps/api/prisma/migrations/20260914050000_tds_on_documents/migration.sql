-- AlterTable
ALTER TABLE "grn_invoices" ADD COLUMN     "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tds_section_code" VARCHAR(20);

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "tcs_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tcs_section_code" VARCHAR(20);

-- AlterTable
ALTER TABLE "tds_deductions" ADD COLUMN     "customer_id" UUID;

-- CreateIndex
CREATE INDEX "tds_deductions_customer_id_idx" ON "tds_deductions"("customer_id");

-- AddForeignKey
ALTER TABLE "tds_deductions" ADD CONSTRAINT "tds_deductions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

