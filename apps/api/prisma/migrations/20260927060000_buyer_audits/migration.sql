-- CreateEnum
CREATE TYPE "BuyerAuditStandard" AS ENUM ('BSCI', 'WRAP', 'SMETA', 'SA8000', 'SEDEX', 'HIGG', 'CUSTOMER_COC', 'OTHER');

-- CreateEnum
CREATE TYPE "BuyerAuditStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditFindingArea" AS ENUM ('WORKING_HOURS', 'WAGES', 'HEALTH_SAFETY', 'CHILD_LABOUR', 'DOCUMENTATION', 'ENVIRONMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditFindingSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'OBSERVATION');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'VERIFIED');

-- CreateTable
CREATE TABLE "buyer_audits" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "audit_no" VARCHAR(30) NOT NULL,
    "standard" "BuyerAuditStandard" NOT NULL,
    "customer_id" UUID,
    "auditor_firm" VARCHAR(120),
    "auditor_name" VARCHAR(80),
    "scheduled_date" DATE NOT NULL,
    "actual_date" DATE,
    "status" "BuyerAuditStatus" NOT NULL DEFAULT 'PLANNED',
    "rating" VARCHAR(40),
    "next_audit_due" DATE,
    "remarks" VARCHAR(500),
    "cancel_reason" VARCHAR(300),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "buyer_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_findings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "audit_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "area" "AuditFindingArea" NOT NULL,
    "severity" "AuditFindingSeverity" NOT NULL,
    "clause_ref" VARCHAR(40),
    "description" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrective_actions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "finding_id" UUID NOT NULL,
    "action" VARCHAR(500) NOT NULL,
    "owner_user_id" VARCHAR(36),
    "owner_employee_id" BIGINT,
    "owner_name" VARCHAR(120),
    "due_date" DATE NOT NULL,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'OPEN',
    "evidence_note" VARCHAR(1000),
    "closed_on" DATE,
    "verified_by" VARCHAR(36),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buyer_audits_company_id_status_scheduled_date_idx" ON "buyer_audits"("company_id", "status", "scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_audits_company_id_audit_no_key" ON "buyer_audits"("company_id", "audit_no");

-- CreateIndex
CREATE INDEX "audit_findings_company_id_severity_idx" ON "audit_findings"("company_id", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "audit_findings_audit_id_seq_key" ON "audit_findings"("audit_id", "seq");

-- CreateIndex
CREATE INDEX "corrective_actions_company_id_status_due_date_idx" ON "corrective_actions"("company_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "corrective_actions_finding_id_idx" ON "corrective_actions"("finding_id");

-- AddForeignKey
ALTER TABLE "buyer_audits" ADD CONSTRAINT "buyer_audits_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_audits" ADD CONSTRAINT "buyer_audits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "buyer_audits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "audit_findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['buyer_audits', 'audit_findings', 'corrective_actions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-08): a buyer's auditor asks who changed a finding or closed an action, and
-- when, so every change is kept (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_buyer_audits ON "buyer_audits";
CREATE TRIGGER audit_buyer_audits AFTER INSERT OR UPDATE OR DELETE ON "buyer_audits" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_audit_findings ON "audit_findings";
CREATE TRIGGER audit_audit_findings AFTER INSERT OR UPDATE OR DELETE ON "audit_findings" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_corrective_actions ON "corrective_actions";
CREATE TRIGGER audit_corrective_actions AFTER INSERT OR UPDATE OR DELETE ON "corrective_actions" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

