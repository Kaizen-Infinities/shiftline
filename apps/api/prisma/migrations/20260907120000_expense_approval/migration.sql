-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "approved_at" TIMESTAMPTZ(6),
ADD COLUMN     "approved_by" VARCHAR(36),
ADD COLUMN     "reject_reason" VARCHAR(255);

