-- CreateEnum
CREATE TYPE "FollowUpProviderKind" AS ENUM ('FIXTURE', 'LIVE');

-- AlterTable
ALTER TABLE "gstr2b_settings" ADD COLUMN     "follow_up_provider" "FollowUpProviderKind" NOT NULL DEFAULT 'FIXTURE',
ADD COLUMN     "nudge_after_days" INTEGER NOT NULL DEFAULT 5;

