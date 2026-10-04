# Shiftline: as-built reference

4 October 2026 · Kaizen Infinities

Shiftline is a hosted, multi-tenant ERP for Indian manufacturers, built around GST and statutory
compliance, production planning and payroll. It has 12 hubs and about 146 screens. This page
records only what was seen running on 4 October 2026.

> **Deployed version vs `main`.** The live app runs `a8c7fca2`, the merge of PR #36. `main` is
> ahead of it by PR #37 (TN features beta: Tamil UI, process routes, OEM ASN, MSME claims, job
> costing) and PR #38 (TN-08 buyer audit readiness, TN-10 subsidy tracker). Those features are in
> the code but have not been checked live. See [`STATUS.md`](STATUS.md).

## Sources and ground rules

This page uses two sources:

- a read-only walk through the live app at <https://shiftline.apps.kaizeninfinities.com> on
  4 October 2026, signed in as the demo owner;
- the hosting note, which says it was checked against the running system.

Nothing is taken from the repository's older documents, specs or hand-off notes (now in
[`archive/`](archive/README.md)), because they had gone out of date.

- "Seen" means the screen's text was read. A screen may do more than its text shows.
- Nothing was saved, filed, posted or submitted.
- Figures come from the demo tenant, not from real business data.

## Hosting

Shiftline runs on one Proxmox host. It is a private, single-node Kubernetes cluster (kind) inside
one Docker container, behind Caddy with automatic TLS. Operating details are in
[`runbooks/hosting.md`](runbooks/hosting.md).

| Item             | Value                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Public URL       | https://shiftline.apps.kaizeninfinities.com                                                                              |
| Host             | Single Proxmox VE host, shared with other apps                                                                           |
| Edge             | Caddy on ports 80 and 443, reverse proxy to 127.0.0.1:8090                                                               |
| Cluster          | kind cluster `shiftline`, namespace `shiftline`, capped at 3 GB RAM and 2 CPUs                                           |
| Services         | nginx gateway, api, worker (exactly one), web, Postgres 16 (StatefulSet), migrate job, on-demand demo-seed job           |
| Source           | github.com/Kaizen-Infinities/shiftline, branch `main`                                                                    |
| Deployed version | `a8c7fca2` (merge of PR #36)                                                                                             |
| Control          | `/root/shiftline/shiftline` script (status, update, rebuild, restart, logs, backup, restore)                             |
| Images           | Built locally, no registry                                                                                               |
| Database roles   | `postgres` (backup only), `shiftline_migrator` (used by api, worker and migrations), `shiftline_app` (reserved, unused)  |
| Backups          | Automatic before each update, manual on demand, and the app's own scheduled dump kept 30 days. All are on the same disk. |

### Known gaps from the hosting note

- Port 8090 can also be reached over plain HTTP from the internet. Binding it to 127.0.0.1 would
  close this.
- `COOKIE_SECURE=false` is still set. It should become `true` once the plain-HTTP port is closed.
- The in-cluster gateway overwrites Caddy's forwarded protocol with `http`.
- SMTP is not configured, so outgoing mail is only logged.
- There are no off-host backups and no monitoring beyond Kubernetes probes.
- There is one node and one replica of everything, so there is no high availability.
- The `DATA_ENCRYPTION_KEY` needs an offline copy. Without one, stored integration credentials
  cannot be decrypted.

## The app at a glance

After sign-in, the owner lands on a dashboard marked DEMO. The sidebar shows "Shiftline" with "by
Applied Softwares" beneath it. The login page carries the tags "GST ready" and "Made for Indian
factories". Navigation is grouped into 12 hubs, and each hub page lists its screens with a
one-line description.

| Group   | Hub                | What it covers                                                                    |
| ------- | ------------------ | --------------------------------------------------------------------------------- |
| Home    | Dashboard          | Money tiles, alerts, stock, workforce, field map                                  |
| Operate | Sales              | Quotations to invoices, returns, advances, dispatch, delivery schedules           |
| Operate | Purchases          | Purchase orders, goods receipt, suppliers, returns, expenses                      |
| Operate | Inventory          | Raw materials, finished goods, wastage, stock adjustments, masters                |
| Operate | Production         | Machine planning, shift console, hourly reports, order milestones, job work, OEE  |
| Operate | Exports            | Export incentives, forex, currency rates                                          |
| Money   | Accounts           | Vouchers, books, receivables and payables, costing, year-end, Tally export        |
| Money   | Banking & Payments | Bank and cash books, reconciliation, petty cash, payment links                    |
| Money   | GST & Compliance   | GST returns, e-invoice, e-way bill, TDS, calendar, filing approvals               |
| Money   | Reports            | Financial statements, audit trail, sales, purchase, inventory, production reports |
| People  | People             | Employees, departments, attendance, leave                                         |
| People  | Payroll            | Payroll run, statutory dues, registers, fines, reports                            |
| Admin   | Settings           | Company, users, roles, imports, integrations                                      |

Four hub pages state their own screen count: Production 16, GST & Compliance 9, Payroll 10 and
Exports 3. All 146 screens linked from the 12 hubs were opened once. Some loaded slowly (see the
last two sections).

## Operate hubs

**Sales.** Quotations, sales orders, sales invoices (with a create form), returns, advances
received, customers, goods dispatch and delivery schedules. Delivery schedules have Schedules,
Due this week and Adherence tabs, with on-time-in-full columns "the way the OEM rates it". The
dashboard says "No sales orders yet", and the delivery-schedules screen says "No delivery
schedules yet".

**Purchases.** Purchase orders, receive goods and the GRN list, suppliers, returns and expenses.

**Inventory.** Raw-material stock, finished-goods stock, wastage, day-end stock, stock adjustments,
raw materials, production products, sales products, categories, units of measure, storage stores
and wastage stores. Most have a create form.

**Production** (16 screens, as the hub states)

- Plan: production orders, weekly schedules, daily machine planning, order T&A (time-and-action
  milestones per buyer) and order history.
- Shop floor: shift execution board, hourly work reports, production wastage, daily production
  report, and job work (ITC-04 challans and job workers).
- Machines: machines, machine assignments and shifts.
- Insight: production dashboard, OEE dashboard, and a full-screen TV display with dark and light
  modes.
- The shift console asks the operator to choose a machine and shift, enter a name and press
  "Initialize Operator Board".
- The demo has four machines:
  - IMM 250T #1 (M001), injection moulding
  - IMM 350T #2 (M002), injection moulding
  - Blow Moulder 5L (M003)
  - Film Extruder 1200 (M004)

  All four showed Active and Idle, with no operator, no plan and no readings.

- Production orders showed a list of orders. The TV board reports 14 orders past due.

**Exports.** Three screens:

- Export incentives: RoDTEP, RoSCTL and drawback claims per shipping bill, plus EPCG and Advance
  Authorisation obligations.
- Foreign exchange: exposure, restatement and imports.
- Currency rates: a table of about 36 rows.

The demo has no claims, no authorisations, and nothing outstanding in a foreign currency.

## Money hubs

**GST & Compliance** (9 screens, as the hub states)

- **GST returns** are computed from the books for a chosen month, under the line "Nothing is filed
  until it is approved".
  - Tabs: GSTR-1, GSTR-3B, GSTR-2B, IMS, GSTR-9 and ITC-04.
  - Actions: a button to register GSTR-1 for approval, and a download of the portal JSON.
  - The demo company is "Shiftline Demo Industries Private Limited", GSTIN 33AAAAA0000A1Z9.
  - For September 2026 it showed 21 invoices, 0 credit notes, taxable value ₹22,09,182.20 and tax
    ₹3,97,652.80.
- **E-invoice register:** statuses Pending, IRN generated, Failed and Cancelled. It is empty, with a
  note to raise one from a B2B invoice once e-invoicing is enabled.
- **E-way bills:** statuses include Expiring under 12h, Active, Expired and Failed, with trip sheets
  for live bills on one vehicle. Empty.
- **TDS and TCS:** deductions, challans, quarterly return, and sections and rates by financial year
  and quarter. Nothing has been deducted this quarter.
- **Filing approvals:** a queue in which every GST, TDS and payroll filing must be approved by
  someone other than the person who prepared it. None are registered yet. Filing types listed:
  - GST: GSTR-1, GSTR-1A, GSTR-3B, IMS actions, GSTR-9, ITC-04
  - TDS: Forms 26Q, 27Q and 24Q; TDS challan (ITNS 281)
  - Payroll and other: MSME Form 1, EPFO ECR, ESIC monthly, professional tax return, payroll run
- Compliance calendar, GST and HSN rates master, transporters, and e-invoicing setup.

**Accounts**

- Vouchers: journal, payment, receipt and contra, each with an add form and a list. Also the day
  book (157 rows in the demo), ledger and merged ledger, and chart of accounts.
- Receivables, payables and MSME dues. The MSME screen explains the 15- and 45-day clock and
  section 43B(h), and lists unpaid bills from micro and small suppliers (none in the demo).
- Costing: month selector, post stock movement, backfill valuation, and tabs for closing stock,
  valuation ledger, cost centres, budgets and cost sheets.
- Year-end closing: books-frozen-up-to date, closing journal preview, "prepared by one person,
  approved by another". The demo shows the books not frozen, no income or expense in FY 2025-26,
  and no year closed.
- Tally export: produces an XML file for the accountant to import into Tally, with handovers, name
  mapping, and an automatic monthly export that is off by default.
- Fixed assets is listed in the hub, but the page was still loading when read.

**Banking & Payments.** Bank reconciliation (statement lines, reconciliation, cheques, statement
import), bank book, cash book, petty cash, payment links (Links and Gateway tabs; none raised) and
bank accounts.

**Reports.**

- Financial: profit and loss in many layouts including Schedule III, balance sheet, trial balance,
  cash flow.
- Audit trail: filters by entity, action, user, date and request id; "recorded by the database and
  never editable".
- Sales, purchase, inventory and production reports.

## People and payroll

**People hub.**

- Screens: add employee, employee list, departments, attendance, leave requests, "my leave", and
  leave and entitlements.
- Entitlements has tabs for leave, gratuity ("building since the fifth year"), bonus, settlements
  and holidays, with a financial-year selector and a "close the leave year" action.
- The demo has two staff, none marked present today. The dashboard shows Shift B (14:00 to 22:00)
  and Shift C (22:00 to 06:00).

**Payroll hub** (10 screens, as the hub states)

- **Run payroll:** a five-step wizard: select period, review attendance, calculate and preview,
  approve, lock and disburse.
  - The period can be monthly or weekly.
  - Employee categories: All Employees (2), Fixed Monthly Admin (2), and PF Workers, Cash Monthly,
    Daily Wage Weekly and Weekly Salary (0 each).
  - The wizard took about ten seconds to show its first step.
- **Statutory payroll:** PF, ESI, PT, LWF and TDS dues, challan files and the payroll journal. The
  demo says "No payroll run yet".
- **Registers:** muster roll, wages, overtime, fines, deductions and advances for the labour
  inspector, with CSV and PDF export. The demo shows one employee, E001 Demo Operator One.
- **Fines and deductions:** under sections 8 and 10 of the Payment of Wages Act, with show-cause,
  approval, and recovery in the payroll run. None recorded.
- Salary advances, weekly and monthly payroll reports, payroll settings (salary components, rules,
  pay calendar) and a payroll overview.

## Settings, integrations and live status

Settings holds:

- company profile and settings, and invoice settings;
- invite people and roles;
- a role-permission matrix: choose a role such as Auditor and switch each screen's actions on or
  off; "changes take effect immediately";
- a permissions list;
- data imports (customers, suppliers, products and more). Every file is checked first, and nothing
  is written until the report is clean;
- account export: the full company data as JSON lines plus uploaded files, downloadable for 24
  hours. None requested yet.

| Integration              | Status seen                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-invoicing (GST portal) | Provider set to "Fixture (no portal; for trials)". Until a GST Suvidha Provider is connected, the built-in fixture mimics the portal. Fields exist for base URL, client id and secret, API user and password. |
| E-way bill               | Register and transporter master exist; no bills raised. Depends on the same provider setup.                                                                                                                   |
| WhatsApp Business        | "Not set up"; credential fields empty.                                                                                                                                                                        |
| SMS and OTP              | Templates, Sent and Account tabs for DLT-registered templates; content was still loading when read.                                                                                                           |
| Email                    | Screen was still loading when read. The hosting note says SMTP is not configured, so mail is only logged.                                                                                                     |
| Payment links            | Links and Gateway tabs; none raised.                                                                                                                                                                          |
| Field sales app          | Live map on the dashboard shows "0 live, 0 seen today"; no agent positions.                                                                                                                                   |
| Devices                  | Listed under settings; still loading when read.                                                                                                                                                               |
| Tally                    | XML export exists (see Money hubs).                                                                                                                                                                           |

## Demo data seen, and what looks wrong

Demo tenant on 4 October 2026 (dashboard, "this year"):

| Measure            | Value                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Total sales        | ₹74,99,314 (64 vouchers)                                                                                                     |
| Total purchase     | ₹79,42,518 (27 vouchers)                                                                                                     |
| Receivable         | ₹74,99,314 (12 customers)                                                                                                    |
| Payable            | ₹27,88,878 (4 suppliers: Polymer Source, RPD Polymers, Chemtrade, Colour Masters)                                            |
| Cash in hand       | ₹14,54,640 (2 accounts)                                                                                                      |
| Bank balance       | ₹63,64,360 (1 account)                                                                                                       |
| Raw-material stock | 74,975 KG across 5 materials (masterbatch, LDPE film, HDPE blow and PP copolymer grades)                                     |
| Finished goods     | 0 PCS across 5 products (bucket, carry bag, crate, jerry can, storage box), each flagged critical against a minimum of 1,500 |
| Production today   | Nothing planned; no field-team positions; 0 of 2 staff marked present                                                        |

The demo data is plastics-flavoured. Customers include Dune Plastics Mart and Sri Murugan Plastics
Traders, and the machines cover injection moulding, blow moulding and film extrusion.

### Inconsistencies and defects seen

1. **TV board cash.** It shows "Cash + bank ₹-78.19L". The dashboard shows cash ₹14.55L and bank
   ₹63.64L, which add to +₹78.19L. Same size, opposite sign.
2. **TV board inventory.** It says "Inventory 100% healthy", while the dashboard lists five
   finished goods at zero stock as critical.
3. **Collections.** Receivable equals total sales to the rupee (₹74,99,314), so no receipt appears
   to have been posted against any invoice.
4. **Negative balances.** The dashboard alerts "3 bank/cash accounts show negative balance", yet
   its tiles show 2 cash accounts and 1 bank account with positive totals.
5. **Bank reconciliation** says "No bank account yet", while the dashboard shows one bank account
   with ₹63.64L.
6. **Customer names.** Some end in "(DEMO)" and others do not, for example Andhra Kitchenware Mart
   and Coastal Fisheries Exports.
7. **Slow screens.** Year-end, fixed assets, devices, email settings, SMS templates and the payroll
   run sat on "Loading" for several seconds on first read. The payroll run took about ten.
8. **Overdue orders.** The TV board reports 14 production orders past due, while the dashboard
   says nothing is planned for today.

## What was not seen or not verified

- **Absent from the app as seen:** live machine data (OEE showed all four machines idle with no
  readings), and any quality, maintenance, andon or energy screens. None appear in any hub.
- **Never exercised:** no return was filed, no e-invoice or e-way bill raised, no payroll run, no
  voucher posted, no data imported, no SMS or WhatsApp message sent, and no record created. Whether
  these work, and whether their numbers are correct, is untested.
- **Only one login:** the demo owner was the only role used. Not seen:
  - other roles, and how the permission matrix applies in practice
  - the platform admin console
  - the invitation and onboarding flows
  - any plan limits
- **Not seen at all:**
  - plan names and prices
  - any language switch or Tamil interface (not deployed; see the note at the top)
  - the native field-sales app
  - printouts and PDFs
  - realtime updates
  - the TV board's behaviour over time
- **Pages that did not render when read:** fixed assets, devices and email settings were stuck on
  "Loading", and SMS templates was loading. They are listed in the hubs, but their content is
  unknown.
- **Depth limit:** for most screens only the first part of the page text was read, so a screen may
  do more than is listed here.
- **Hosting facts** come from the hosting note. They were not checked independently beyond the app
  answering at its public address.
