# P1-21 — Payment links, gateway reconciliation and subscription billing

## Why

Two kinds of money move through a gateway and they are not the same thing. A tenant collects
from its own customers: an invoice goes out, a link goes with it, somebody pays on a phone and
the receipt has to land in the books without anybody typing it in. And the platform collects
from the tenant: the subscription that keeps the account alive. Both need the same plumbing —
a provider behind an interface, a webhook that can be replayed without paying twice, and a
posting rule — so both are built once, here.

## Scope

- **Gateway settings per tenant**: which provider, the key id, the key secret and the webhook
  secret encrypted at rest and never returned, the bank and fee ledgers the receipts post to,
  and an opaque webhook token so the callback URL carries no tenant id.
- **Payment links** raised against a sales invoice (or for a bare amount), with the balance
  checked at creation, an expiry, and cancellation.
- **Webhook ingestion**: HMAC-verified, stored before it is acted on, idempotent by the
  provider's event id, and replayable.
- **Posting**: a capture writes the invoice payment and the RECEIPT voucher through the same
  path a counter receipt uses; the gateway's fee is a separate journal, because the bank only
  ever received the net.
- **Subscription billing**: an invoice per tenant per period, moved to paid by the webhook, and
  the subscription's own status following it — active, past due, cancelled.
- **The provider seam**: `PaymentProvider` with a fixture adapter that behaves like a gateway —
  links that expire, partial payments, fees, signature failures, duplicate events.

## Out of scope

A live Razorpay adapter. The owner has not supplied an account, so there is nothing to certify
against and a sandbox-shaped guess would be worse than an honest gap: the interface and the
fixture are here, the adapter is one file when the credentials arrive.

Refunds, settlements reconciliation against the gateway's payout file (that is the bank
reconciliation of P1-20 once payouts exist), and card storage of any kind.

## Acceptance

- A link cannot be raised for more than the invoice's outstanding balance.
- A webhook with a bad signature is refused and recorded; the same event id twice posts once.
- A capture credits the customer ledger and debits the bank at gross; the fee is its own
  journal, so the bank moves by the net.
- A partly paid link says so, and the invoice is only PAID when the whole of it is.
- Cancelling a link that has already been paid is refused.
- The callback URL carries a token, not a company id, and resolves to exactly one tenant.
- Every query is tenant-scoped; a foreign company sees no links.
