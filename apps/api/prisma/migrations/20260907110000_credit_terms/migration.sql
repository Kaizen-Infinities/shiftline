-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "overdue_interest_rate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "credit_days" INTEGER;

