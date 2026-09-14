-- AlterTable
ALTER TABLE "employee_fine_deductions" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" TEXT,
ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" TEXT,
ADD COLUMN     "recovered_at" TIMESTAMP(3),
ADD COLUMN     "recovered_in_payroll_result_id" INTEGER,
ADD COLUMN     "show_cause_date" DATE,
ADD COLUMN     "show_cause_remarks" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "wage_period" VARCHAR(7) NOT NULL;

-- CreateIndex
CREATE INDEX "employee_fine_deductions_wage_period_status_idx" ON "employee_fine_deductions"("wage_period", "status");

-- CreateIndex
CREATE INDEX "employee_fine_deductions_recovered_in_payroll_result_id_idx" ON "employee_fine_deductions"("recovered_in_payroll_result_id");

-- AddForeignKey
ALTER TABLE "employee_fine_deductions" ADD CONSTRAINT "employee_fine_deductions_recovered_in_payroll_result_id_fkey" FOREIGN KEY ("recovered_in_payroll_result_id") REFERENCES "payroll_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

