-- CreateEnum
CREATE TYPE "GatewayAdapterKind" AS ENUM ('SIMULATOR', 'OPCUA_EUROMAP77', 'EUROMAP63_FILE', 'MODBUS_MQTT');

-- CreateEnum
CREATE TYPE "MachineSignalName" AS ENUM ('STATE', 'CYCLE_COMPLETE', 'SHOT_COUNT', 'PART_COUNT', 'CYCLE_TIME', 'BARREL_TEMP', 'MOULD_TEMP', 'INJECTION_PRESSURE', 'ALARM');

-- CreateEnum
CREATE TYPE "SignalDataType" AS ENUM ('NUMERIC', 'TEXT');

-- AlterEnum
ALTER TYPE "RetentionDataClass" ADD VALUE 'MACHINE_TELEMETRY';

-- CreateTable
CREATE TABLE "machine_gateways" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "code" VARCHAR(20) NOT NULL,
    "machine_id" VARCHAR(20) NOT NULL,
    "adapter_kind" "GatewayAdapterKind" NOT NULL,
    "connection_settings" JSONB NOT NULL DEFAULT '{}',
    "credentials_encrypted" TEXT,
    "poll_interval_seconds" INTEGER NOT NULL DEFAULT 30,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6),
    "last_error" VARCHAR(500),
    "last_error_at" TIMESTAMPTZ(6),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(36),
    "updated_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "machine_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_signal_maps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "gateway_id" UUID NOT NULL,
    "vendor_tag" VARCHAR(100) NOT NULL,
    "canonical_signal" "MachineSignalName" NOT NULL,
    "unit" VARCHAR(20),
    "data_type" "SignalDataType" NOT NULL DEFAULT 'NUMERIC',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "machine_signal_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_signals" (
    "id" BIGSERIAL NOT NULL,
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "machine_id" VARCHAR(20) NOT NULL,
    "gateway_id" UUID NOT NULL,
    "signal" "MachineSignalName" NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "numeric_value" DECIMAL(14,4),
    "text_value" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL DEFAULT (current_setting('app.company_id'::text))::uuid,
    "machine_id" VARCHAR(20) NOT NULL,
    "gateway_id" UUID NOT NULL,
    "production_order_id" VARCHAR(20),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6) NOT NULL,
    "actual_cycle_seconds" DECIMAL(10,2) NOT NULL,
    "parts_produced" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "machine_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "machine_gateways_company_id_machine_id_idx" ON "machine_gateways"("company_id", "machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "machine_gateways_company_id_code_key" ON "machine_gateways"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "machine_signal_maps_company_id_gateway_id_vendor_tag_key" ON "machine_signal_maps"("company_id", "gateway_id", "vendor_tag");

-- CreateIndex
CREATE INDEX "machine_signals_company_id_machine_id_timestamp_idx" ON "machine_signals"("company_id", "machine_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "machine_signals_company_id_machine_id_signal_timestamp_key" ON "machine_signals"("company_id", "machine_id", "signal", "timestamp");

-- CreateIndex
CREATE INDEX "machine_cycles_company_id_machine_id_started_at_idx" ON "machine_cycles"("company_id", "machine_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "machine_cycles_company_id_gateway_id_ended_at_key" ON "machine_cycles"("company_id", "gateway_id", "ended_at");

-- AddForeignKey
ALTER TABLE "machine_gateways" ADD CONSTRAINT "machine_gateways_company_id_machine_id_fkey" FOREIGN KEY ("company_id", "machine_id") REFERENCES "machines"("company_id", "machine_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_gateways" ADD CONSTRAINT "machine_gateways_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_signal_maps" ADD CONSTRAINT "machine_signal_maps_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "machine_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_signal_maps" ADD CONSTRAINT "machine_signal_maps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_signals" ADD CONSTRAINT "machine_signals_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "machine_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_signals" ADD CONSTRAINT "machine_signals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_cycles" ADD CONSTRAINT "machine_cycles_gateway_id_fkey" FOREIGN KEY ("gateway_id") REFERENCES "machine_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_cycles" ADD CONSTRAINT "machine_cycles_company_id_production_order_id_fkey" FOREIGN KEY ("company_id", "production_order_id") REFERENCES "production_orders"("company_id", "production_order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_cycles" ADD CONSTRAINT "machine_cycles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Row-level security for the new tenant tables (same shape as 20260906220000_enable_rls).
-- MachineSignal is RLS-scoped like every tenant table even though it carries no audit trigger.

ALTER TABLE "machine_gateways" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "machine_gateways" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "machine_gateways";
CREATE POLICY tenant_isolation ON "machine_gateways" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "machine_gateways";
CREATE POLICY platform_bypass ON "machine_gateways" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "machine_signal_maps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "machine_signal_maps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "machine_signal_maps";
CREATE POLICY tenant_isolation ON "machine_signal_maps" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "machine_signal_maps";
CREATE POLICY platform_bypass ON "machine_signal_maps" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "machine_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "machine_signals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "machine_signals";
CREATE POLICY tenant_isolation ON "machine_signals" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "machine_signals";
CREATE POLICY platform_bypass ON "machine_signals" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

ALTER TABLE "machine_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "machine_cycles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "machine_cycles";
CREATE POLICY tenant_isolation ON "machine_cycles" USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
DROP POLICY IF EXISTS platform_bypass ON "machine_cycles";
CREATE POLICY platform_bypass ON "machine_cycles" USING (app_rls_bypass()) WITH CHECK (app_rls_bypass());

-- Audit trail: gateways, signal maps and cycle roll-ups are shop-floor masters/facts.
-- MachineSignal (raw samples) deliberately gets no trigger -- P2-00's write path.

DROP TRIGGER IF EXISTS audit_machine_gateways ON "machine_gateways";
CREATE TRIGGER audit_machine_gateways AFTER INSERT OR UPDATE OR DELETE ON "machine_gateways" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_machine_signal_maps ON "machine_signal_maps";
CREATE TRIGGER audit_machine_signal_maps AFTER INSERT OR UPDATE OR DELETE ON "machine_signal_maps" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');

DROP TRIGGER IF EXISTS audit_machine_cycles ON "machine_cycles";
CREATE TRIGGER audit_machine_cycles AFTER INSERT OR UPDATE OR DELETE ON "machine_cycles" FOR EACH ROW EXECUTE FUNCTION audit_row('id', 'company');
