-- DropForeignKey
ALTER TABLE "bill_of_materials" DROP CONSTRAINT "bill_of_materials_raw_material_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_production_plans" DROP CONSTRAINT "daily_production_plans_carry_forward_from_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_production_plans" DROP CONSTRAINT "daily_production_plans_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_production_plans" DROP CONSTRAINT "daily_production_plans_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_production_plans" DROP CONSTRAINT "daily_production_plans_shift_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_production_plans" DROP CONSTRAINT "daily_production_plans_weekly_program_id_fkey";

-- DropForeignKey
ALTER TABLE "employees" DROP CONSTRAINT "employees_shiftId_fkey";

-- DropForeignKey
ALTER TABLE "finished_goods_stocks" DROP CONSTRAINT "finished_goods_stocks_store_id_fkey";

-- DropForeignKey
ALTER TABLE "finished_goods_transactions" DROP CONSTRAINT "finished_goods_transactions_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "finished_goods_transactions" DROP CONSTRAINT "finished_goods_transactions_store_id_fkey";

-- DropForeignKey
ALTER TABLE "goods_dispatch_items" DROP CONSTRAINT "goods_dispatch_items_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "goods_dispatches" DROP CONSTRAINT "goods_dispatches_destination_store_id_fkey";

-- DropForeignKey
ALTER TABLE "grn_invoice_items" DROP CONSTRAINT "grn_invoice_items_product_id_fkey";

-- DropForeignKey
ALTER TABLE "grn_invoices" DROP CONSTRAINT "grn_invoices_store_id_fkey";

-- DropForeignKey
ALTER TABLE "hourly_productions" DROP CONSTRAINT "hourly_productions_daily_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "hourly_productions" DROP CONSTRAINT "hourly_productions_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "hourly_productions" DROP CONSTRAINT "hourly_productions_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "hourly_productions" DROP CONSTRAINT "hourly_productions_shift_id_fkey";

-- DropForeignKey
ALTER TABLE "machine_oee_snapshots" DROP CONSTRAINT "machine_oee_snapshots_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "machine_operation_assignments" DROP CONSTRAINT "machine_operation_assignments_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "machine_operation_assignments" DROP CONSTRAINT "machine_operation_assignments_shift_id_fkey";

-- DropForeignKey
ALTER TABLE "product_shift_records" DROP CONSTRAINT "product_shift_records_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "product_shift_records" DROP CONSTRAINT "product_shift_records_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "product_shift_records" DROP CONSTRAINT "product_shift_records_shift_id_fkey";

-- DropForeignKey
ALTER TABLE "production_order_history" DROP CONSTRAINT "production_order_history_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "production_orders" DROP CONSTRAINT "production_orders_machineMachineId_fkey";

-- DropForeignKey
ALTER TABLE "production_wastages" DROP CONSTRAINT "production_wastages_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "production_wastages" DROP CONSTRAINT "production_wastages_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "production_wastages" DROP CONSTRAINT "production_wastages_raw_material_id_fkey";

-- DropForeignKey
ALTER TABLE "production_wastages" DROP CONSTRAINT "production_wastages_shift_id_fkey";

-- DropForeignKey
ALTER TABLE "production_wastages" DROP CONSTRAINT "production_wastages_store_id_fkey";

-- DropForeignKey
ALTER TABLE "production_wastages" DROP CONSTRAINT "production_wastages_target_wastage_product_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_return_items" DROP CONSTRAINT "purchase_return_items_rawMaterialId_fkey";

-- DropForeignKey
ALTER TABLE "raw_material_transactions" DROP CONSTRAINT "raw_material_transactions_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "raw_material_transactions" DROP CONSTRAINT "raw_material_transactions_raw_material_id_fkey";

-- DropForeignKey
ALTER TABLE "raw_material_transactions" DROP CONSTRAINT "raw_material_transactions_store_id_fkey";

-- DropForeignKey
ALTER TABLE "raw_materials" DROP CONSTRAINT "raw_materials_store_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_invoices" DROP CONSTRAINT "sales_invoices_store_id_fkey";

-- DropForeignKey
ALTER TABLE "sales_product_stocks" DROP CONSTRAINT "sales_product_stocks_store_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_adjustment_items" DROP CONSTRAINT "stock_adjustment_items_raw_material_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_adjustment_items" DROP CONSTRAINT "stock_adjustment_items_store_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_adjustments" DROP CONSTRAINT "stock_adjustments_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "store_locations" DROP CONSTRAINT "store_locations_store_id_fkey";

-- DropForeignKey
ALTER TABLE "stores" DROP CONSTRAINT "stores_location_id_fkey";

-- DropForeignKey
ALTER TABLE "weekly_machine_programs" DROP CONSTRAINT "weekly_machine_programs_machine_id_fkey";

-- DropForeignKey
ALTER TABLE "weekly_machine_programs" DROP CONSTRAINT "weekly_machine_programs_production_order_id_fkey";

-- DropForeignKey
ALTER TABLE "weekly_machine_programs" DROP CONSTRAINT "weekly_machine_programs_shift_id_fkey";

-- DropIndex
DROP INDEX "shifts_shiftCode_key";

-- AlterTable
ALTER TABLE "daily_production_plans" DROP CONSTRAINT "daily_production_plans_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "daily_production_plans_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "locations" DROP CONSTRAINT "locations_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "machines" DROP CONSTRAINT "machines_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "machines_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "production_orders" DROP CONSTRAINT "production_orders_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "raw_materials" DROP CONSTRAINT "raw_materials_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "raw_materials_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "stores" DROP CONSTRAINT "stores_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "weekly_machine_programs" DROP CONSTRAINT "weekly_machine_programs_pkey",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "weekly_machine_programs_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_production_plans_company_id_daily_plan_id_key" ON "daily_production_plans"("company_id", "daily_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_company_id_location_id_key" ON "locations"("company_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "machines_company_id_machine_id_key" ON "machines"("company_id", "machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_company_id_production_order_id_key" ON "production_orders"("company_id", "production_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "raw_materials_company_id_raw_material_id_key" ON "raw_materials"("company_id", "raw_material_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_company_id_shiftCode_key" ON "shifts"("company_id", "shiftCode");

-- CreateIndex
CREATE UNIQUE INDEX "stores_company_id_store_id_key" ON "stores"("company_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_machine_programs_company_id_weekly_program_id_key" ON "weekly_machine_programs"("company_id", "weekly_program_id");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_shiftId_fkey" FOREIGN KEY ("company_id", "shiftId") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_product_stocks" ADD CONSTRAINT "sales_product_stocks_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_company_id_location_id_fkey" FOREIGN KEY ("company_id", "location_id") REFERENCES "locations"("company_id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_materials" ADD CONSTRAINT "raw_materials_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_company_id_raw_material_id_fkey" FOREIGN KEY ("company_id", "raw_material_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_stocks" ADD CONSTRAINT "finished_goods_stocks_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_transactions" ADD CONSTRAINT "finished_goods_transactions_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finished_goods_transactions" ADD CONSTRAINT "finished_goods_transactions_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_company_id_machineMachineId_fkey" FOREIGN KEY ("company_id", "machineMachineId") REFERENCES "machines"("company_id", "machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatches" ADD CONSTRAINT "goods_dispatches_company_id_destination_store_id_fkey" FOREIGN KEY ("company_id", "destination_store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_operation_assignments" ADD CONSTRAINT "machine_operation_assignments_company_id_shift_id_fkey" FOREIGN KEY ("company_id", "shift_id") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_dispatch_items" ADD CONSTRAINT "goods_dispatch_items_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_machine_programs" ADD CONSTRAINT "weekly_machine_programs_company_id_shift_id_fkey" FOREIGN KEY ("company_id", "shift_id") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_company_id_daily_plan_id_fkey" FOREIGN KEY ("company_id", "daily_plan_id") REFERENCES "daily_production_plans"("company_id", "daily_plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_productions" ADD CONSTRAINT "hourly_productions_company_id_shift_id_fkey" FOREIGN KEY ("company_id", "shift_id") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_company_id_carry_forward_from_plan__fkey" FOREIGN KEY ("company_id", "carry_forward_from_plan_id") REFERENCES "daily_production_plans"("company_id", "daily_plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_company_id_shift_id_fkey" FOREIGN KEY ("company_id", "shift_id") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_production_plans" ADD CONSTRAINT "daily_production_plans_company_id_weekly_program_id_fkey" FOREIGN KEY ("company_id", "weekly_program_id") REFERENCES "weekly_machine_programs"("company_id", "weekly_program_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_company_id_raw_material_id_fkey" FOREIGN KEY ("company_id", "raw_material_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_material_transactions" ADD CONSTRAINT "raw_material_transactions_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoices" ADD CONSTRAINT "grn_invoices_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grn_invoice_items" ADD CONSTRAINT "grn_invoice_items_company_id_product_id_fkey" FOREIGN KEY ("company_id", "product_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_raw_material_id_fkey" FOREIGN KEY ("company_id", "raw_material_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_shift_id_fkey" FOREIGN KEY ("company_id", "shift_id") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_wastages" ADD CONSTRAINT "production_wastages_company_id_target_wastage_product_id_fkey" FOREIGN KEY ("company_id", "target_wastage_product_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_company_id_raw_material_id_fkey" FOREIGN KEY ("company_id", "raw_material_id") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_history" ADD CONSTRAINT "production_order_history_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_company_id_store_id_fkey" FOREIGN KEY ("company_id", "store_id") REFERENCES "stores"("company_id", "store_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_oee_snapshots" ADD CONSTRAINT "machine_oee_snapshots_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shift_records" ADD CONSTRAINT "product_shift_records_company_id_shift_id_fkey" FOREIGN KEY ("company_id", "shift_id") REFERENCES "shifts"("company_id", "shiftCode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_items" ADD CONSTRAINT "purchase_return_items_company_id_rawMaterialId_fkey" FOREIGN KEY ("company_id", "rawMaterialId") REFERENCES "raw_materials"("company_id", "raw_material_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- The audit trigger on raw_materials recorded the business code as entityId; the uuid is the key now.
DROP TRIGGER IF EXISTS audit_raw_materials ON "raw_materials";
CREATE TRIGGER audit_raw_materials AFTER INSERT OR UPDATE OR DELETE ON "raw_materials" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
