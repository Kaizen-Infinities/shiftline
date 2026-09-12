-- CreateEnum
CREATE TYPE "SmsProviderName" AS ENUM ('FIXTURE', 'MSG91');

-- CreateEnum
CREATE TYPE "SmsCategory" AS ENUM ('TRANSACTIONAL', 'SERVICE_IMPLICIT', 'SERVICE_EXPLICIT', 'PROMOTIONAL');

-- CreateEnum
CREATE TYPE "SmsMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('MOBILE_VERIFY', 'FIELD_LOGIN', 'PAYMENT_CONFIRM');

-- CreateTable
CREATE TABLE "sms_configs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "provider" "SmsProviderName" NOT NULL DEFAULT 'FIXTURE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sender_id" VARCHAR(6),
    "principal_entity_id" VARCHAR(30),
    "auth_key" VARCHAR(400),
    "daily_cap" INTEGER NOT NULL DEFAULT 2000,
    "last_verified_at" TIMESTAMPTZ(6),
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sms_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_templates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "category" "SmsCategory" NOT NULL DEFAULT 'TRANSACTIONAL',
    "dlt_template_id" VARCHAR(30),
    "body" VARCHAR(1000) NOT NULL,
    "variables" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sms_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "to_mobile" VARCHAR(15) NOT NULL,
    "template_code" VARCHAR(40),
    "dlt_template_id" VARCHAR(30),
    "body" VARCHAR(1000) NOT NULL,
    "segments" INTEGER NOT NULL DEFAULT 1,
    "status" "SmsMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" VARCHAR(120),
    "purpose" VARCHAR(30),
    "error" VARCHAR(255),
    "request_id" VARCHAR(64),
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "sms_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "purpose" "OtpPurpose" NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "code_hash" VARCHAR(120) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMPTZ(6),
    "sms_message_id" UUID,
    "requested_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sms_configs_company_id_key" ON "sms_configs"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "sms_templates_company_id_code_key" ON "sms_templates"("company_id", "code");

-- CreateIndex
CREATE INDEX "sms_messages_company_id_to_mobile_idx" ON "sms_messages"("company_id", "to_mobile");

-- CreateIndex
CREATE INDEX "sms_messages_company_id_status_idx" ON "sms_messages"("company_id", "status");

-- CreateIndex
CREATE INDEX "otp_challenges_company_id_mobile_purpose_idx" ON "otp_challenges"("company_id", "mobile", "purpose");

-- AddForeignKey
ALTER TABLE "sms_configs" ADD CONSTRAINT "sms_configs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sms_configs','sms_templates','sms_messages','otp_challenges']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail: a template decides what every customer of this tenant receives, so a change to
-- one is worth keeping (same trigger as 20260906235000_audit_trail). The account row is not
-- audited — it holds an encrypted credential, and audit rows are never deleted, so auditing it
-- would keep old ciphertext forever. Nor is the message log, which is already a record of what
-- was sent, or the OTP table, whose only interesting column is a hash.
DROP TRIGGER IF EXISTS audit_sms_templates ON "sms_templates";
CREATE TRIGGER audit_sms_templates AFTER INSERT OR UPDATE OR DELETE ON "sms_templates" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
