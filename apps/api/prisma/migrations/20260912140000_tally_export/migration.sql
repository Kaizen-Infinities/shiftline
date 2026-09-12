-- CreateEnum
CREATE TYPE "TallyNameKind" AS ENUM ('GROUP', 'LEDGER', 'UNIT', 'STOCK_ITEM', 'VOUCHER_TYPE');

-- CreateEnum
CREATE TYPE "TallyExportScope" AS ENUM ('MASTERS', 'VOUCHERS', 'BOTH');

-- CreateEnum
CREATE TYPE "TallyExportStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "tally_name_maps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "kind" "TallyNameKind" NOT NULL,
    "source_code" VARCHAR(60) NOT NULL,
    "tally_name" VARCHAR(160) NOT NULL,
    "tally_parent" VARCHAR(160),
    "is_exported" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(255),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tally_name_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tally_export_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "scope" "TallyExportScope" NOT NULL DEFAULT 'BOTH',
    "tally_company" VARCHAR(160) NOT NULL,
    "from_date" DATE,
    "to_date" DATE,
    "incremental" BOOLEAN NOT NULL DEFAULT false,
    "since_at" TIMESTAMPTZ(6),
    "through_at" TIMESTAMPTZ(6),
    "counts" JSONB NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "payload_hash" VARCHAR(64) NOT NULL,
    "status" "TallyExportStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(255),
    "requested_by" VARCHAR(36),
    "confirmed_by" VARCHAR(36),
    "confirmed_at" TIMESTAMPTZ(6),
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "last_downloaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tally_export_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tally_name_maps_company_id_kind_idx" ON "tally_name_maps"("company_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "tally_name_maps_company_id_kind_source_code_key" ON "tally_name_maps"("company_id", "kind", "source_code");

-- CreateIndex
CREATE INDEX "tally_export_runs_company_id_created_at_idx" ON "tally_export_runs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "tally_export_runs_company_id_status_idx" ON "tally_export_runs"("company_id", "status");

-- AddForeignKey
ALTER TABLE "tally_name_maps" ADD CONSTRAINT "tally_name_maps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tally_export_runs" ADD CONSTRAINT "tally_export_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tally_name_maps','tally_export_runs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: the name map decides what a ledger is called in the accountant's books, so a
-- change to it changes what the exported accounts say (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_tally_name_maps ON "tally_name_maps";
CREATE TRIGGER audit_tally_name_maps AFTER INSERT OR UPDATE OR DELETE ON "tally_name_maps" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
