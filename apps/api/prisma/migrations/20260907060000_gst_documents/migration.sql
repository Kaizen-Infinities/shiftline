-- CreateEnum
CREATE TYPE "SupplyType" AS ENUM ('INTRA_STATE', 'INTER_STATE', 'EXPORT', 'SEZ', 'DEEMED_EXPORT');

-- CreateEnum
CREATE TYPE "SalesDocumentType" AS ENUM ('TAX_INVOICE', 'BILL_OF_SUPPLY', 'EXPORT_INVOICE');

-- CreateEnum
CREATE TYPE "ReturnKind" AS ENUM ('GOODS_RETURN', 'PRICE_ADJUSTMENT');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "business_place_id" BIGINT,
ADD COLUMN     "cgst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8),
ADD COLUMN     "igst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "itc_eligible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sgst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE',
ADD COLUMN     "taxable_amount" DECIMAL(12,2),
ADD COLUMN     "tds_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tds_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tds_section" VARCHAR(10),
ADD COLUMN     "vendor_gstin" VARCHAR(15);

-- AlterTable
ALTER TABLE "goods_dispatches" ADD COLUMN     "business_place_id" BIGINT;

-- AlterTable
ALTER TABLE "grn_invoice_items" ADD COLUMN     "cess_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8);

-- AlterTable
ALTER TABLE "grn_invoices" ADD COLUMN     "business_place_id" BIGINT,
ADD COLUMN     "place_of_supply" VARCHAR(2),
ADD COLUMN     "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supplier_gstin" VARCHAR(15),
ADD COLUMN     "supplier_invoice_date" DATE,
ADD COLUMN     "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE',
ADD COLUMN     "totalCess" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "petty_cash_entries" ADD COLUMN     "business_place_id" BIGINT,
ADD COLUMN     "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8),
ADD COLUMN     "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vendor_gstin" VARCHAR(15);

-- AlterTable
ALTER TABLE "purchase_return_items" ADD COLUMN     "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8),
ADD COLUMN     "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "business_place_id" BIGINT,
ADD COLUMN     "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "debit_note_no" VARCHAR(30),
ADD COLUMN     "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "ReturnKind" NOT NULL DEFAULT 'GOODS_RETURN',
ADD COLUMN     "place_of_supply" VARCHAR(2),
ADD COLUMN     "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "supplier_gstin" VARCHAR(15),
ADD COLUMN     "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE',
ADD COLUMN     "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_invoice_items" ADD COLUMN     "cess_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8);

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "business_place_id" BIGINT,
ADD COLUMN     "cess_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customer_gstin" VARCHAR(15),
ADD COLUMN     "document_type" "SalesDocumentType" NOT NULL DEFAULT 'TAX_INVOICE',
ADD COLUMN     "place_of_supply" VARCHAR(2),
ADD COLUMN     "reverse_charge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE';

-- AlterTable
ALTER TABLE "sales_return_items" ADD COLUMN     "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8),
ADD COLUMN     "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "business_place_id" BIGINT,
ADD COLUMN     "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "credit_note_no" VARCHAR(30),
ADD COLUMN     "customer_gstin" VARCHAR(15),
ADD COLUMN     "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "kind" "ReturnKind" NOT NULL DEFAULT 'GOODS_RETURN',
ADD COLUMN     "place_of_supply" VARCHAR(2),
ADD COLUMN     "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE';

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "business_place_id" BIGINT;

-- AddForeignKey
ALTER TABLE "goods_dispatches" ADD CONSTRAINT "goods_dispatches_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoices" ADD CONSTRAINT "grn_invoices_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

