-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" BIGSERIAL NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "file_name" VARCHAR(255),
    "bytes" BIGINT,
    "sha256" VARCHAR(64),
    "duration_ms" INTEGER,
    "error" VARCHAR(1000),
    "triggered_by" VARCHAR(36),
    "job_id" VARCHAR(64),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_started_at_idx" ON "backup_runs"("started_at");
