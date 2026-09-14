-- CreateTable
CREATE TABLE "costing_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "wip_ledger_code" VARCHAR(20) NOT NULL DEFAULT 'WIP',
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "costing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "costing_settings_company_id_key" ON "costing_settings"("company_id");

-- AddForeignKey
ALTER TABLE "costing_settings" ADD CONSTRAINT "costing_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['costing_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: which ledger WIP posts to is a books decision, argued about the same way any
-- other posting setting is (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_costing_settings ON "costing_settings";
CREATE TRIGGER audit_costing_settings AFTER INSERT OR UPDATE OR DELETE ON "costing_settings" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
