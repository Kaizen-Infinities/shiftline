-- CreateEnum
CREATE TYPE "EwayBillStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "transporters" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "transporter_id" VARCHAR(15),
    "phone" VARCHAR(20),
    "email" VARCHAR(120),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transporters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eway_bills" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "doc_type" VARCHAR(3) NOT NULL,
    "doc_ref" VARCHAR(40) NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "e_invoice_id" UUID,
    "irn" VARCHAR(64),
    "ewb_no" VARCHAR(12),
    "ewb_date" TIMESTAMPTZ(6),
    "valid_upto" TIMESTAMPTZ(6),
    "status" "EwayBillStatus" NOT NULL DEFAULT 'PENDING',
    "from_gstin" VARCHAR(15) NOT NULL,
    "from_pincode" VARCHAR(6) NOT NULL,
    "from_state_code" VARCHAR(2) NOT NULL,
    "to_gstin" VARCHAR(15),
    "to_pincode" VARCHAR(6) NOT NULL,
    "to_state_code" VARCHAR(2) NOT NULL,
    "distance_km" INTEGER NOT NULL DEFAULT 0,
    "trans_mode" VARCHAR(1) NOT NULL DEFAULT '1',
    "transporter_id" VARCHAR(15),
    "transporter_name" VARCHAR(120),
    "trans_doc_no" VARCHAR(30),
    "trans_doc_date" DATE,
    "vehicle_no" VARCHAR(15),
    "vehicle_type" VARCHAR(1) NOT NULL DEFAULT 'R',
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "error" VARCHAR(1000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updates" JSONB NOT NULL DEFAULT '[]',
    "extensions" INTEGER NOT NULL DEFAULT 0,
    "consolidated_no" VARCHAR(12),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(36),
    "cancel_reason" VARCHAR(1),
    "cancel_remarks" VARCHAR(100),
    "requested_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "eway_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidated_eway_bills" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "cewb_no" VARCHAR(12) NOT NULL,
    "cewb_date" TIMESTAMPTZ(6) NOT NULL,
    "vehicle_no" VARCHAR(15) NOT NULL,
    "from_place" VARCHAR(50) NOT NULL,
    "from_state_code" VARCHAR(2) NOT NULL,
    "trans_mode" VARCHAR(1) NOT NULL DEFAULT '1',
    "trans_doc_no" VARCHAR(30),
    "ewb_nos" JSONB NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidated_eway_bills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transporters_company_id_code_key" ON "transporters"("company_id", "code");

-- CreateIndex
CREATE INDEX "eway_bills_company_id_doc_type_doc_ref_idx" ON "eway_bills"("company_id", "doc_type", "doc_ref");

-- CreateIndex
CREATE INDEX "eway_bills_company_id_status_valid_upto_idx" ON "eway_bills"("company_id", "status", "valid_upto");

-- CreateIndex
CREATE UNIQUE INDEX "eway_bills_company_id_ewb_no_key" ON "eway_bills"("company_id", "ewb_no");

-- CreateIndex
CREATE UNIQUE INDEX "consolidated_eway_bills_company_id_cewb_no_key" ON "consolidated_eway_bills"("company_id", "cewb_no");

-- AddForeignKey
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eway_bills" ADD CONSTRAINT "eway_bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidated_eway_bills" ADD CONSTRAINT "consolidated_eway_bills_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).

ALTER TABLE "transporters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transporters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "transporters";
CREATE POLICY tenant_isolation ON "transporters" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "transporters";
CREATE POLICY platform_bypass ON "transporters" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "eway_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "eway_bills" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "eway_bills";
CREATE POLICY tenant_isolation ON "eway_bills" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "eway_bills";
CREATE POLICY platform_bypass ON "eway_bills" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "consolidated_eway_bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consolidated_eway_bills" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "consolidated_eway_bills";
CREATE POLICY tenant_isolation ON "consolidated_eway_bills" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "consolidated_eway_bills";
CREATE POLICY platform_bypass ON "consolidated_eway_bills" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: e-way bills are tax documents and transporters a master (same trigger as 20260906235000_audit_trail).

DROP TRIGGER IF EXISTS audit_transporters ON "transporters";
CREATE TRIGGER audit_transporters AFTER INSERT OR UPDATE OR DELETE ON "transporters" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_eway_bills ON "eway_bills";
CREATE TRIGGER audit_eway_bills AFTER INSERT OR UPDATE OR DELETE ON "eway_bills" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_consolidated_eway_bills ON "consolidated_eway_bills";
CREATE TRIGGER audit_consolidated_eway_bills AFTER INSERT OR UPDATE OR DELETE ON "consolidated_eway_bills" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
