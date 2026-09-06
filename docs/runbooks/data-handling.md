# Data handling

## What never enters the repository

- Customer, supplier or employee records of any real company (names, phones, GSTINs,
  PANs, balances). The only data in git is the anonymised seed in `apps/api/prisma/seed.ts`.
- Production or staging database dumps.
- `.env` files, keys, GSP or gateway credentials.

## Where real data lives

- The BUSY export used for Sun Sea's migration and any future tenant imports: a vault or
  access-controlled bucket owned by Kaizen, with a named access list. Not on laptops.
- Database backups: `backups/` volume locally (P0-13 job), object storage later.

## Support copies

`scripts/anonymise-dump.sql` scrubs a restored dump in place: party names, contact
details, GSTINs, PANs, bank details and free text are replaced with synthetic values,
amounts and dates are kept. Run it on a scratch database only, never on production.

## Retention

Statutory books, filings and payroll: 8 years (PC8 policy). Logs, sessions, login
attempts and mobile tombstones: per `RetentionPolicy`. Photos on devices: 90 days.
