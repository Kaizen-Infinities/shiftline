-- Scrub personal and commercial identifiers from a RESTORED COPY of a database.
-- Amounts, dates and relationships are preserved so reports still reconcile.
-- Usage: psql "$SCRATCH_DATABASE_URL" -f scripts/anonymise-dump.sql
BEGIN;

UPDATE customers SET
  "firmName"     = 'Customer ' || "customerCode",
  "displayName"  = 'Customer ' || "customerCode",
  email          = lower("customerCode") || '@example.invalid',
  gstin          = NULL,
  mobile         = '["9000000000"]'::jsonb;

UPDATE customer_addresses SET
  "addressLine1" = 'Address withheld', "addressLine2" = NULL, city = 'City', pincode = '000000'
WHERE true;

UPDATE suppliers SET
  legal_name   = 'Supplier ' || supplier_code,
  display_name = 'Supplier ' || supplier_code,
  contact_person = NULL, email = lower(supplier_code) || '@example.invalid',
  gstin = NULL, pan = NULL, whatsapp = NULL, alt_phone = NULL,
  billing_address_line1 = 'Address withheld', mobile = '["9000000000"]'::jsonb;

UPDATE employees SET
  "fullName" = 'Employee ' || "empCode",
  email = lower("empCode") || '@example.invalid',
  phone = NULL, "aadhaarNumber" = NULL, "panNumber" = NULL,
  "bankAccountNo" = NULL, "ifscCode" = NULL, "pfNumber" = NULL, "uanNumber" = NULL, "esiNumber" = NULL,
  address = NULL, "emergencyContact" = NULL;

UPDATE users SET
  "fullName" = 'User ' || left("userId"::text, 8),
  email = 'user-' || left("userId"::text, 8) || '@example.invalid',
  "passwordHash" = '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';

UPDATE companies SET gstin = NULL, phone = NULL, mobile = NULL, email = NULL, website = NULL;

TRUNCATE login_attempts, user_sessions, password_reset_tokens;
UPDATE whatsapp_config SET "accessToken" = 'redacted' WHERE true;
UPDATE email_config SET "smtpPassword" = 'redacted' WHERE true;

COMMIT;
