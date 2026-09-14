-- CreateTable
CREATE TABLE "tally_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "auto_export_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tally_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tally_configs_company_id_key" ON "tally_configs"("company_id");

-- AddForeignKey
ALTER TABLE "tally_configs" ADD CONSTRAINT "tally_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
-- Not audited: a settings row with no secret and no book/document/master shape, same as
-- sms_configs and payment_gateway_configs.

ALTER TABLE "tally_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tally_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tally_configs";
CREATE POLICY tenant_isolation ON "tally_configs" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "tally_configs";
CREATE POLICY platform_bypass ON "tally_configs" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

