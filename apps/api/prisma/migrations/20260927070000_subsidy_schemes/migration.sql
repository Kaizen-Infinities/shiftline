-- CreateEnum
CREATE TYPE "SubsidySchemeKind" AS ENUM ('CAPITAL_SUBSIDY', 'POWER_SUBSIDY_LTPT', 'INTEREST_SUBVENTION', 'NEEDS', 'PLI', 'STATE_OTHER', 'CENTRAL_OTHER');

-- CreateEnum
CREATE TYPE "SubsidySchemeStatus" AS ENUM ('APPLIED', 'SANCTIONED', 'ACTIVE', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubsidyClaimStatus" AS ENUM ('DRAFT', 'FILED', 'APPROVED', 'DISBURSED', 'REJECTED');

-- CreateTable
CREATE TABLE "subsidy_schemes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "scheme_code" VARCHAR(30) NOT NULL,
    "kind" "SubsidySchemeKind" NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "authority" VARCHAR(80),
    "sanction_order_no" VARCHAR(80),
    "sanction_date" DATE,
    "sanctioned_amount" DECIMAL(14,2),
    "eligibility_notes" VARCHAR(2000),
    "valid_from" DATE,
    "valid_to" DATE,
    "status" "SubsidySchemeStatus" NOT NULL DEFAULT 'APPLIED',
    "details" JSONB,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subsidy_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subsidy_claims" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "scheme_id" UUID NOT NULL,
    "claim_no" VARCHAR(30) NOT NULL,
    "period_from" DATE NOT NULL,
    "period_to" DATE NOT NULL,
    "amount_claimed" DECIMAL(14,2) NOT NULL,
    "status" "SubsidyClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "filed_on" DATE,
    "reference_no" VARCHAR(80),
    "approved_on" DATE,
    "approved_amount" DECIMAL(14,2),
    "disbursed_amount" DECIMAL(14,2),
    "disbursed_on" DATE,
    "bank_ref" VARCHAR(80),
    "rejection_reason" VARCHAR(500),
    "notes" VARCHAR(1000),
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subsidy_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subsidy_schemes_company_id_status_idx" ON "subsidy_schemes"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subsidy_schemes_company_id_scheme_code_key" ON "subsidy_schemes"("company_id", "scheme_code");

-- CreateIndex
CREATE INDEX "subsidy_claims_scheme_id_idx" ON "subsidy_claims"("scheme_id");

-- CreateIndex
CREATE INDEX "subsidy_claims_company_id_status_idx" ON "subsidy_claims"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subsidy_claims_company_id_claim_no_key" ON "subsidy_claims"("company_id", "claim_no");

-- AddForeignKey
ALTER TABLE "subsidy_schemes" ADD CONSTRAINT "subsidy_schemes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsidy_claims" ADD CONSTRAINT "subsidy_claims_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subsidy_claims" ADD CONSTRAINT "subsidy_claims_scheme_id_fkey" FOREIGN KEY ("scheme_id") REFERENCES "subsidy_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subsidy_schemes', 'subsidy_claims']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS platform_bypass ON %I', t);
    EXECUTE format('CREATE POLICY platform_bypass ON %I USING (app_rls_bypass()) WITH CHECK (app_rls_bypass())', t);
  END LOOP;
END $$;

-- Audit trail (TN-10): a sanction order and the money claimed and received under it are
-- government grants in the books, so every change is kept (same trigger as 20260906235000_audit_trail).
DROP TRIGGER IF EXISTS audit_subsidy_schemes ON "subsidy_schemes";
CREATE TRIGGER audit_subsidy_schemes AFTER INSERT OR UPDATE OR DELETE ON "subsidy_schemes" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
DROP TRIGGER IF EXISTS audit_subsidy_claims ON "subsidy_claims";
CREATE TRIGGER audit_subsidy_claims AFTER INSERT OR UPDATE OR DELETE ON "subsidy_claims" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
