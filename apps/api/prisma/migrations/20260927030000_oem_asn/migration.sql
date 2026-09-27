-- CreateEnum
CREATE TYPE "AsnStatus" AS ENUM ('DRAFT', 'SENT', 'ACKNOWLEDGED', 'CANCELLED');

-- CreateTable
CREATE TABLE "customer_part_maps" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "customer_id" UUID NOT NULL,
    "product_id" BIGINT NOT NULL,
    "customer_part_no" VARCHAR(40) NOT NULL,
    "description" VARCHAR(120),
    "pack_qty" DECIMAL(14,3),
    "pack_type" VARCHAR(30),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_part_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "asn_no" VARCHAR(40) NOT NULL,
    "customer_id" UUID NOT NULL,
    "sales_invoice_id" UUID NOT NULL,
    "invoice_no" VARCHAR(40) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "vehicle_no" VARCHAR(15),
    "transporter_name" VARCHAR(100),
    "lr_no" VARCHAR(30),
    "lr_date" DATE,
    "dispatch_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "AsnStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_at" TIMESTAMPTZ(6),
    "acknowledged_at" TIMESTAMPTZ(6),
    "ack_ref" VARCHAR(60),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(300),
    "notes" VARCHAR(500),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asn_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "asn_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "product_id" BIGINT NOT NULL,
    "customer_part_no" VARCHAR(40) NOT NULL,
    "description" VARCHAR(120),
    "uom" VARCHAR(20),
    "qty" DECIMAL(14,3) NOT NULL,
    "pack_qty" DECIMAL(14,3) NOT NULL,
    "packs" INTEGER NOT NULL,
    "schedule_line_id" UUID,
    "dispatch_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asn_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_part_maps_company_id_customer_id_product_id_idx" ON "customer_part_maps"("company_id", "customer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_part_maps_company_id_customer_id_customer_part_no_key" ON "customer_part_maps"("company_id", "customer_id", "customer_part_no");

-- CreateIndex
CREATE INDEX "asns_company_id_customer_id_dispatch_at_idx" ON "asns"("company_id", "customer_id", "dispatch_at");

-- CreateIndex
CREATE INDEX "asns_sales_invoice_id_idx" ON "asns"("sales_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "asns_company_id_asn_no_key" ON "asns"("company_id", "asn_no");

-- CreateIndex
CREATE UNIQUE INDEX "asn_lines_dispatch_id_key" ON "asn_lines"("dispatch_id");

-- CreateIndex
CREATE INDEX "asn_lines_schedule_line_id_idx" ON "asn_lines"("schedule_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "asn_lines_asn_id_seq_key" ON "asn_lines"("asn_id", "seq");

-- AddForeignKey
ALTER TABLE "customer_part_maps" ADD CONSTRAINT "customer_part_maps_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_part_maps" ADD CONSTRAINT "customer_part_maps_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_part_maps" ADD CONSTRAINT "customer_part_maps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asns" ADD CONSTRAINT "asns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asns" ADD CONSTRAINT "asns_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asns" ADD CONSTRAINT "asns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asn_lines" ADD CONSTRAINT "asn_lines_asn_id_fkey" FOREIGN KEY ("asn_id") REFERENCES "asns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asn_lines" ADD CONSTRAINT "asn_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asn_lines" ADD CONSTRAINT "asn_lines_schedule_line_id_fkey" FOREIGN KEY ("schedule_line_id") REFERENCES "customer_schedule_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asn_lines" ADD CONSTRAINT "asn_lines_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "customer_schedule_dispatches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asn_lines" ADD CONSTRAINT "asn_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_part_maps', 'asns', 'asn_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-07): the part-number master and the ASNs sent to the OEM are what a vendor
-- rating dispute is settled with (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_customer_part_maps ON "customer_part_maps";
CREATE TRIGGER audit_customer_part_maps AFTER INSERT OR UPDATE OR DELETE ON "customer_part_maps" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_asns ON "asns";
CREATE TRIGGER audit_asns AFTER INSERT OR UPDATE OR DELETE ON "asns" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_asn_lines ON "asn_lines";
CREATE TRIGGER audit_asn_lines AFTER INSERT OR UPDATE OR DELETE ON "asn_lines" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

