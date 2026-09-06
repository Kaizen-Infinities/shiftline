-- AlterEnum
ALTER TYPE "RetentionDataClass" ADD VALUE 'AGENT_POSITIONS';

-- CreateTable
CREATE TABLE "mobile_devices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "device_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "platform" VARCHAR(20),
    "app_version" VARCHAR(20),
    "model" VARCHAR(80),
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sync_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mobile_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_positions" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "agent_user_id" VARCHAR(36) NOT NULL,
    "device_id" VARCHAR(64),
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracy_m" DECIMAL(8,2),
    "speed_kmh" DECIMAL(6,2),
    "heading" DECIMAL(6,2),
    "battery_pct" INTEGER,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_devices_company_id_user_id_idx" ON "mobile_devices"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_devices_company_id_device_id_key" ON "mobile_devices"("company_id", "device_id");

-- CreateIndex
CREATE INDEX "agent_positions_company_id_agent_user_id_recorded_at_idx" ON "agent_positions"("company_id", "agent_user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "agent_positions_company_id_received_at_idx" ON "agent_positions"("company_id", "received_at");

-- AddForeignKey
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_positions" ADD CONSTRAINT "agent_positions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
ALTER TABLE "mobile_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_devices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "mobile_devices";
CREATE POLICY tenant_isolation ON "mobile_devices" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "mobile_devices";
CREATE POLICY platform_bypass ON "mobile_devices" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "agent_positions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_positions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "agent_positions";
CREATE POLICY tenant_isolation ON "agent_positions" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "agent_positions";
CREATE POLICY platform_bypass ON "agent_positions" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());
