-- CreateEnum
CREATE TYPE "ChallanKind" AS ENUM ('JOB_WORK_OUT', 'JOB_WORK_RETURN', 'BRANCH_TRANSFER', 'EXHIBITION', 'LINE_SALES', 'OTHER');

-- CreateEnum
CREATE TYPE "ChallanStatus" AS ENUM ('OPEN', 'PART_RETURNED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "job_workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "gstin" VARCHAR(15),
    "state_code" VARCHAR(2),
    "address_line1" VARCHAR(255),
    "city" VARCHAR(100),
    "pincode" VARCHAR(10),
    "contact_person" VARCHAR(120),
    "phone" VARCHAR(20),
    "email" VARCHAR(120),
    "process_type" VARCHAR(80),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "job_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_challans" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "challan_no" VARCHAR(30) NOT NULL,
    "challan_date" DATE NOT NULL,
    "kind" "ChallanKind" NOT NULL,
    "status" "ChallanStatus" NOT NULL DEFAULT 'OPEN',
    "job_worker_id" UUID,
    "parent_challan_id" UUID,
    "business_place_id" BIGINT,
    "store_id" VARCHAR(20),
    "to_business_place_id" BIGINT,
    "place_of_supply" VARCHAR(2),
    "supply_type" "SupplyType" NOT NULL DEFAULT 'INTRA_STATE',
    "purpose" VARCHAR(255),
    "capital_goods" BOOLEAN NOT NULL DEFAULT false,
    "return_due_date" DATE,
    "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "transporter_name" VARCHAR(120),
    "vehicle_number" VARCHAR(20),
    "remarks" VARCHAR(500),
    "closed_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(36),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "delivery_challans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_challan_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "challan_id" UUID NOT NULL,
    "item_type" "ItemCategoryType" NOT NULL,
    "raw_material_id" VARCHAR(20),
    "product_item_id" BIGINT,
    "description" VARCHAR(255),
    "uom" VARCHAR(20),
    "hsn_code" VARCHAR(8),
    "quantity_sent" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantity_returned" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantity_consumed" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantity_scrap" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "delivery_challan_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_workers_company_id_code_key" ON "job_workers"("company_id", "code");

-- CreateIndex
CREATE INDEX "delivery_challans_company_id_kind_status_idx" ON "delivery_challans"("company_id", "kind", "status");

-- CreateIndex
CREATE INDEX "delivery_challans_company_id_job_worker_id_idx" ON "delivery_challans"("company_id", "job_worker_id");

-- CreateIndex
CREATE INDEX "delivery_challans_return_due_date_idx" ON "delivery_challans"("return_due_date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_challans_company_id_challan_no_key" ON "delivery_challans"("company_id", "challan_no");

-- CreateIndex
CREATE INDEX "delivery_challan_items_challan_id_idx" ON "delivery_challan_items"("challan_id");

-- CreateIndex
CREATE INDEX "delivery_challan_items_company_id_raw_material_id_idx" ON "delivery_challan_items"("company_id", "raw_material_id");

-- AddForeignKey
ALTER TABLE "job_workers" ADD CONSTRAINT "job_workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_job_worker_id_fkey" FOREIGN KEY ("job_worker_id") REFERENCES "job_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_parent_challan_id_fkey" FOREIGN KEY ("parent_challan_id") REFERENCES "delivery_challans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_business_place_id_fkey" FOREIGN KEY ("business_place_id") REFERENCES "business_places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_challan_id_fkey" FOREIGN KEY ("challan_id") REFERENCES "delivery_challans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_company_id_raw_material_id_fkey" FOREIGN KEY ("company_id", "raw_material_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_product_item_id_fkey" FOREIGN KEY ("product_item_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_workers','delivery_challans','delivery_challan_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: a delivery challan is the document the credit on job-work goods rests on, and
-- the job worker is a master (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_job_workers ON "job_workers";
CREATE TRIGGER audit_job_workers AFTER INSERT OR UPDATE OR DELETE ON "job_workers" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_delivery_challans ON "delivery_challans";
CREATE TRIGGER audit_delivery_challans AFTER INSERT OR UPDATE OR DELETE ON "delivery_challans" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_delivery_challan_items ON "delivery_challan_items";
CREATE TRIGGER audit_delivery_challan_items AFTER INSERT OR UPDATE OR DELETE ON "delivery_challan_items" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
