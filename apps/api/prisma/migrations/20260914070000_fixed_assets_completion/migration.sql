
-- AlterEnum
ALTER TYPE "DepreciationRunStatus" ADD VALUE 'REVERSED';

-- AlterTable
ALTER TABLE "depreciation_runs" ADD COLUMN     "reversal_voucher_id" INTEGER,
ADD COLUMN     "reversed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reversed_by" VARCHAR(36);

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "opening_balance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "opening_it_wdv" DECIMAL(14,2),
ADD COLUMN     "source_line_id" VARCHAR(40);

-- Capitalising the same source line twice must fail even under a race: one asset per
-- (company, source document, source line). NULLs (typed-in assets) are not compared, so this
-- only guards capitalisation, never ordinary additions.
CREATE UNIQUE INDEX "fixed_assets_source_doc_uq" ON "fixed_assets" (
  "company_id",
  "source_doc_type",
  "source_doc_id",
  (COALESCE("source_line_id", ''))
) WHERE "source_doc_type" IS NOT NULL AND "source_doc_id" IS NOT NULL;

