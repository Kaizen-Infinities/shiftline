-- CreateEnum
CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED', 'SEZ', 'OVERSEAS', 'UIN');

-- CreateEnum
CREATE TYPE "HsnType" AS ENUM ('HSN', 'SAC');

-- AlterTable
ALTER TABLE "business_places" ADD COLUMN     "gstin" VARCHAR(15);

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "gst_registration_type" "GstRegistrationType" NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "state_code" VARCHAR(2);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "gst_reg_type" "GstRegistrationType" NOT NULL DEFAULT 'UNREGISTERED',
ADD COLUMN     "state_code" VARCHAR(2);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gst_rate" DECIMAL(5,2),
ADD COLUMN     "hsn_code_id" UUID;

-- AlterTable
ALTER TABLE "raw_materials" ADD COLUMN     "gst_rate" DECIMAL(5,2),
ADD COLUMN     "hsn_code_id" UUID;

-- AlterTable: keep existing supplier registration types (free text such as "Regular") while
-- converting the column to the enum; anything unrecognised follows the GSTIN.
ALTER TABLE "suppliers" ALTER COLUMN "gst_reg_type" TYPE "GstRegistrationType" USING (
  CASE upper(trim(coalesce("gst_reg_type", '')))
    WHEN 'REGULAR' THEN 'REGULAR'
    WHEN 'COMPOSITION' THEN 'COMPOSITION'
    WHEN 'UNREGISTERED' THEN 'UNREGISTERED'
    WHEN 'SEZ' THEN 'SEZ'
    WHEN 'OVERSEAS' THEN 'OVERSEAS'
    WHEN 'UIN' THEN 'UIN'
    ELSE CASE WHEN nullif("gstin", '') IS NOT NULL THEN 'REGULAR' ELSE 'UNREGISTERED' END
  END
)::"GstRegistrationType";

-- CreateTable
CREATE TABLE "hsn_codes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(8) NOT NULL,
    "type" "HsnType" NOT NULL DEFAULT 'HSN',
    "description" VARCHAR(255) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "hsn_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gst_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "name" VARCHAR(40) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "cess_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gst_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hsn_codes_company_id_type_idx" ON "hsn_codes"("company_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "hsn_codes_company_id_code_key" ON "hsn_codes"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "gst_rates_company_id_rate_cess_rate_key" ON "gst_rates"("company_id", "rate", "cess_rate");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_hsn_code_id_fkey" FOREIGN KEY ("hsn_code_id") REFERENCES "hsn_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_hsn_code_id_fkey" FOREIGN KEY ("hsn_code_id") REFERENCES "hsn_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hsn_codes" ADD CONSTRAINT "hsn_codes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gst_rates" ADD CONSTRAINT "gst_rates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Backfill from existing GSTINs: registration type and state code.
UPDATE "customers" SET "gst_reg_type" = 'REGULAR', "state_code" = left("gstin", 2)
  WHERE nullif("gstin", '') IS NOT NULL AND "gstin" ~ '^[0-9]{2}';
UPDATE "companies" SET "state_code" = left("gstin", 2)
  WHERE "state_code" IS NULL AND nullif("gstin", '') IS NOT NULL AND "gstin" ~ '^[0-9]{2}';
UPDATE "companies" SET "gst_registration_type" = 'UNREGISTERED' WHERE nullif("gstin", '') IS NULL;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
ALTER TABLE "hsn_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hsn_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "hsn_codes";
CREATE POLICY tenant_isolation ON "hsn_codes" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "hsn_codes";
CREATE POLICY platform_bypass ON "hsn_codes" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "gst_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gst_rates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "gst_rates";
CREATE POLICY tenant_isolation ON "gst_rates" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "gst_rates";
CREATE POLICY platform_bypass ON "gst_rates" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: tax masters are books-adjacent (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_hsn_codes ON "hsn_codes";
CREATE TRIGGER audit_hsn_codes AFTER INSERT OR UPDATE OR DELETE ON "hsn_codes" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_gst_rates ON "gst_rates";
CREATE TRIGGER audit_gst_rates AFTER INSERT OR UPDATE OR DELETE ON "gst_rates" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
