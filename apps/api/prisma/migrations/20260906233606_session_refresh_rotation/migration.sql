-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "last_used_at" TIMESTAMPTZ(6),
ADD COLUMN     "prev_token_hash" VARCHAR(64),
ADD COLUMN     "rotated_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "user_sessions_prev_token_hash_idx" ON "user_sessions"("prev_token_hash");
