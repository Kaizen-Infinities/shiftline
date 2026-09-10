-- Runs once when the postgres volume is created (docker-entrypoint-initdb.d).
-- Roles for the RLS split (P0-08): the app connects as shiftline_app and cannot
-- bypass row-level security; migrations run as shiftline_migrator (table owner).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shiftline_migrator') THEN
    CREATE ROLE shiftline_migrator LOGIN PASSWORD 'shiftline_migrator' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shiftline_app') THEN
    CREATE ROLE shiftline_app LOGIN PASSWORD 'shiftline_app' NOBYPASSRLS;
  END IF;
END $$;

GRANT ALL PRIVILEGES ON DATABASE shiftline TO shiftline_migrator;
GRANT CONNECT ON DATABASE shiftline TO shiftline_app;

-- Test database for the integration suite (P0-04).
CREATE DATABASE shiftline_test OWNER shiftline_migrator;
