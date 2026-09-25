-- AlterTable
ALTER TABLE "delivery_challan_items" ADD COLUMN     "direct_supply_invoice_date" DATE,
ADD COLUMN     "direct_supply_invoice_no" VARCHAR(30),
ADD COLUMN     "parent_item_id" UUID,
ADD COLUMN     "quantity_direct_supply" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "delivery_challans" ADD COLUMN     "from_job_worker_id" UUID;

-- CreateIndex
CREATE INDEX "delivery_challan_items_parent_item_id_idx" ON "delivery_challan_items"("parent_item_id");

-- AddForeignKey
ALTER TABLE "delivery_challans" ADD CONSTRAINT "delivery_challans_from_job_worker_id_fkey" FOREIGN KEY ("from_job_worker_id") REFERENCES "job_workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_challan_items" ADD CONSTRAINT "delivery_challan_items_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "delivery_challan_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

