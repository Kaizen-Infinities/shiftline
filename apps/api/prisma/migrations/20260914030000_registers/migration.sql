-- CreateTable
CREATE TABLE "employee_fine_deductions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "employeeId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "cause" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "shownCauseGiven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_fine_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_fine_deductions_company_id_idx" ON "employee_fine_deductions"("company_id");

-- CreateIndex
CREATE INDEX "employee_fine_deductions_employeeId_occurredOn_idx" ON "employee_fine_deductions"("employeeId", "occurredOn");

-- AddForeignKey
ALTER TABLE "employee_fine_deductions" ADD CONSTRAINT "employee_fine_deductions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_fine_deductions" ADD CONSTRAINT "employee_fine_deductions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant table (same shape as 20260906220000_enable_rls).
ALTER TABLE "employee_fine_deductions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_fine_deductions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "employee_fine_deductions";
CREATE POLICY tenant_isolation ON "employee_fine_deductions" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "employee_fine_deductions";
CREATE POLICY platform_bypass ON "employee_fine_deductions" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
