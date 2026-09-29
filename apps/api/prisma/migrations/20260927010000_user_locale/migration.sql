-- TN-04: per-user UI language. English stays the default; Tamil is the first extra locale.
ALTER TABLE "users" ADD COLUMN "locale" VARCHAR(5) NOT NULL DEFAULT 'en';
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("locale" IN ('en', 'ta'));
