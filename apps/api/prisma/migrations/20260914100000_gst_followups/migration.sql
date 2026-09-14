-- CreateEnum
CREATE TYPE "FollowUpChannel" AS ENUM ('WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "gstr2b_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "date_tolerance_days" INTEGER NOT NULL DEFAULT 7,
    "value_tolerance" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gstr2b_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_follow_ups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "period_key" VARCHAR(7) NOT NULL,
    "gstin" VARCHAR(15) NOT NULL,
    "supplier_gstin" VARCHAR(15) NOT NULL,
    "supplier_name" VARCHAR(160),
    "channel" "FollowUpChannel" NOT NULL,
    "record_ids" JSONB NOT NULL,
    "recipient" VARCHAR(160) NOT NULL,
    "message" TEXT NOT NULL,
    "status" "FollowUpStatus" NOT NULL,
    "error" VARCHAR(255),
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gstr2b_settings_company_id_key" ON "gstr2b_settings"("company_id");

-- CreateIndex
CREATE INDEX "supplier_follow_ups_company_id_period_key_gstin_supplier_gs_idx" ON "supplier_follow_ups"("company_id", "period_key", "gstin", "supplier_gstin", "sent_at");

-- AddForeignKey
ALTER TABLE "gstr2b_settings" ADD CONSTRAINT "gstr2b_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_follow_ups" ADD CONSTRAINT "supplier_follow_ups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).

ALTER TABLE "gstr2b_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gstr2b_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "gstr2b_settings";
CREATE POLICY tenant_isolation ON "gstr2b_settings" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "gstr2b_settings";
CREATE POLICY platform_bypass ON "gstr2b_settings" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "supplier_follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_follow_ups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "supplier_follow_ups";
CREATE POLICY tenant_isolation ON "supplier_follow_ups" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "supplier_follow_ups";
CREATE POLICY platform_bypass ON "supplier_follow_ups" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- No audit trigger: settings and follow-ups are operational, not books, documents or masters.
