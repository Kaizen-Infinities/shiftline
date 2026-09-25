-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "business_place_id" BIGINT;

-- CreateIndex
CREATE INDEX "employees_business_place_id_idx" ON "employees"("business_place_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data step (P2-15): default every employee's business place to the company's one and only
-- business place, where a tenant has exactly one. A tenant with more than one business place
-- gets no default here — its owner assigns each employee explicitly.
UPDATE "employees" e
SET "business_place_id" = solo."id"
FROM (
  SELECT "company_id", MIN("id") AS "id"
  FROM "business_places"
  GROUP BY "company_id"
  HAVING COUNT(*) = 1
) solo
WHERE e."company_id" = solo."company_id"
  AND e."business_place_id" IS NULL;

