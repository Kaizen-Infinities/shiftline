-- CreateEnum
CREATE TYPE "MsmeCategory" AS ENUM ('MICRO', 'SMALL', 'MEDIUM', 'NOT_REGISTERED');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "agreed_payment_days" INTEGER,
ADD COLUMN     "has_written_contract" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "msme_category" "MsmeCategory" NOT NULL DEFAULT 'NOT_REGISTERED',
ADD COLUMN     "msme_verified_on" DATE,
ADD COLUMN     "udyam_number" VARCHAR(19);

-- CreateIndex
CREATE INDEX "suppliers_company_id_msme_category_idx" ON "suppliers"("company_id", "msme_category");

