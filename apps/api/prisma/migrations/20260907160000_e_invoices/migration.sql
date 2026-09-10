-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "e_invoice_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'FIXTURE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "applicable_from" DATE,
    "aato_crore" DECIMAL(10,2),
    "base_url" VARCHAR(200),
    "client_id" VARCHAR(200),
    "client_secret" VARCHAR(500),
    "username" VARCHAR(200),
    "password" VARCHAR(500),
    "last_verified_at" TIMESTAMPTZ(6),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "e_invoice_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "doc_type" VARCHAR(3) NOT NULL,
    "doc_id" UUID NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "seller_gstin" VARCHAR(15) NOT NULL,
    "buyer_gstin" VARCHAR(15) NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "irn" VARCHAR(64),
    "ack_no" VARCHAR(30),
    "ack_date" TIMESTAMPTZ(6),
    "signed_invoice" TEXT,
    "signed_qr" TEXT,
    "ewb_no" VARCHAR(20),
    "ewb_date" TIMESTAMPTZ(6),
    "ewb_valid_till" TIMESTAMPTZ(6),
    "request" JSONB NOT NULL,
    "response" JSONB,
    "error" VARCHAR(1000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requested_by" VARCHAR(36),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(36),
    "cancel_reason" VARCHAR(2),
    "cancel_remarks" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "e_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "e_invoice_configs_company_id_key" ON "e_invoice_configs"("company_id");

-- CreateIndex
CREATE INDEX "e_invoices_company_id_status_idx" ON "e_invoices"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "e_invoices_company_id_doc_type_doc_id_key" ON "e_invoices"("company_id", "doc_type", "doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "e_invoices_company_id_irn_key" ON "e_invoices"("company_id", "irn");

-- AddForeignKey
ALTER TABLE "e_invoice_configs" ADD CONSTRAINT "e_invoice_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_invoices" ADD CONSTRAINT "e_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
ALTER TABLE "e_invoice_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "e_invoice_configs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "e_invoice_configs";
CREATE POLICY tenant_isolation ON "e_invoice_configs" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "e_invoice_configs";
CREATE POLICY platform_bypass ON "e_invoice_configs" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "e_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "e_invoices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "e_invoices";
CREATE POLICY tenant_isolation ON "e_invoices" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "e_invoices";
CREATE POLICY platform_bypass ON "e_invoices" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: an IRN record is a tax document (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_e_invoices ON "e_invoices";
CREATE TRIGGER audit_e_invoices AFTER INSERT OR UPDATE OR DELETE ON "e_invoices" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
