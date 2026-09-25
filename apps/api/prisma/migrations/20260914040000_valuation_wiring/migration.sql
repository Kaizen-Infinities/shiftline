-- AlterEnum
ALTER TYPE "StoreCategory" ADD VALUE 'JOB_WORK';

-- AlterTable
ALTER TABLE "stock_valuation_entries" ADD COLUMN     "reversed_entry_id" UUID;

