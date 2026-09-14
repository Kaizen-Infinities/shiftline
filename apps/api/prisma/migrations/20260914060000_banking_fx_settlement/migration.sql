-- AlterTable
ALTER TABLE "cheques" ADD COLUMN     "presented_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source_doc_id" VARCHAR(36);

-- AlterTable
ALTER TABLE "grn_invoices" ADD COLUMN     "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
ADD COLUMN     "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "foreign_total" DECIMAL(14,2);

