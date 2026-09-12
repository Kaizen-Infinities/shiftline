-- CreateEnum
CREATE TYPE "PaymentGatewayProvider" AS ENUM ('FIXTURE', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('CREATED', 'PARTIALLY_PAID', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentCaptureStatus" AS ENUM ('CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "SubscriptionInvoiceStatus" AS ENUM ('DUE', 'PAID', 'FAILED', 'VOID');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "provider_customer_id" VARCHAR(120),
ADD COLUMN     "provider_subscription_id" VARCHAR(120);

-- CreateTable
CREATE TABLE "payment_gateway_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "provider" "PaymentGatewayProvider" NOT NULL DEFAULT 'FIXTURE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "key_id" VARCHAR(120),
    "key_secret" VARCHAR(400),
    "webhook_secret" VARCHAR(400),
    "webhook_token" VARCHAR(64) NOT NULL,
    "bank_ledger_code" VARCHAR(20) NOT NULL DEFAULT 'BANK-001',
    "fee_ledger_code" VARCHAR(20) NOT NULL DEFAULT 'PG-FEE-001',
    "expiry_hours" INTEGER NOT NULL DEFAULT 72,
    "last_verified_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "link_no" VARCHAR(30) NOT NULL,
    "provider" "PaymentGatewayProvider" NOT NULL DEFAULT 'FIXTURE',
    "provider_link_id" VARCHAR(120),
    "short_url" VARCHAR(400),
    "sales_invoice_id" UUID,
    "customer_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'CREATED',
    "description" VARCHAR(255),
    "notify_email" VARCHAR(120),
    "notify_phone" VARCHAR(20),
    "expires_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" VARCHAR(255),
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_captures" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "payment_link_id" UUID NOT NULL,
    "provider_payment_id" VARCHAR(120) NOT NULL,
    "status" "PaymentCaptureStatus" NOT NULL DEFAULT 'CAPTURED',
    "amount" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fee_tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "method" VARCHAR(30),
    "captured_at" TIMESTAMPTZ(6) NOT NULL,
    "sales_invoice_payment_id" UUID,
    "voucher_id" VARCHAR(36),
    "fee_voucher_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_captures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "provider_event_id" VARCHAR(160) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "signature_valid" BOOLEAN NOT NULL DEFAULT false,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "error" VARCHAR(500),
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "plan_code" VARCHAR(30) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "SubscriptionInvoiceStatus" NOT NULL DEFAULT 'DUE',
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "provider_invoice_id" VARCHAR(120),
    "provider_payment_id" VARCHAR(120),
    "failure_reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_configs_company_id_key" ON "payment_gateway_configs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_configs_webhook_token_key" ON "payment_gateway_configs"("webhook_token");

-- CreateIndex
CREATE INDEX "payment_links_company_id_status_idx" ON "payment_links"("company_id", "status");

-- CreateIndex
CREATE INDEX "payment_links_company_id_sales_invoice_id_idx" ON "payment_links"("company_id", "sales_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_company_id_link_no_key" ON "payment_links"("company_id", "link_no");

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_company_id_provider_link_id_key" ON "payment_links"("company_id", "provider_link_id");

-- CreateIndex
CREATE INDEX "payment_captures_company_id_payment_link_id_idx" ON "payment_captures"("company_id", "payment_link_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_captures_company_id_provider_payment_id_key" ON "payment_captures"("company_id", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_company_id_status_idx" ON "payment_webhook_events"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_company_id_provider_event_id_key" ON "payment_webhook_events"("company_id", "provider_event_id");

-- CreateIndex
CREATE INDEX "subscription_invoices_company_id_status_idx" ON "subscription_invoices"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_company_id_period_start_key" ON "subscription_invoices"("company_id", "period_start");

-- AddForeignKey
ALTER TABLE "payment_gateway_configs" ADD CONSTRAINT "payment_gateway_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_captures" ADD CONSTRAINT "payment_captures_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_captures" ADD CONSTRAINT "payment_captures_payment_link_id_fkey" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_gateway_configs','payment_links','payment_captures','payment_webhook_events','subscription_invoices']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: money coming in and the bill the tenant owes the platform are both argued about
-- later (same trigger as 20260906235000_audit_trail). The webhook log is not audited — it is
-- already an immutable record of what arrived, and auditing it would store every payload twice.
DROP TRIGGER IF EXISTS audit_payment_links ON "payment_links";
CREATE TRIGGER audit_payment_links AFTER INSERT OR UPDATE OR DELETE ON "payment_links" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_payment_captures ON "payment_captures";
CREATE TRIGGER audit_payment_captures AFTER INSERT OR UPDATE OR DELETE ON "payment_captures" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_subscription_invoices ON "subscription_invoices";
CREATE TRIGGER audit_subscription_invoices AFTER INSERT OR UPDATE OR DELETE ON "subscription_invoices" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
