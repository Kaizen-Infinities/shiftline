-- Audit actions for the shift console supervisor override (server-verified, replaces a client-side passcode).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUPERVISOR_OVERRIDE_GRANTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUPERVISOR_OVERRIDE_DENIED';
