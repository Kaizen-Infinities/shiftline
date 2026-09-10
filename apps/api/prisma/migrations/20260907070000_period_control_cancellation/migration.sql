-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('POSTED', 'CANCELLED');

-- DropIndex
DROP INDEX "vouchers_company_id_refDocType_refDocId_key";

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "books_frozen_up_to" DATE;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36);

-- AlterTable
ALTER TABLE "grn_invoices" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36),
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE "petty_cash_entries" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36),
ADD COLUMN     "status" VARCHAR(20) NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36);

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "backdate_days" INTEGER;

-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36);

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36);

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "cancel_reason" VARCHAR(255),
ADD COLUMN     "cancel_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" VARCHAR(36),
ADD COLUMN     "reversal_of_id" INTEGER,
ADD COLUMN     "status" "VoucherStatus" NOT NULL DEFAULT 'POSTED';

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_reversal_of_id_key" ON "vouchers"("reversal_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_company_id_refDocType_refDocId_cancel_seq_key" ON "vouchers"("company_id", "refDocType", "refDocId", "cancel_seq");

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

