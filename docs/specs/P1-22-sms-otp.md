# P1-22 — SMS and one-time passwords

## Why

A field agent standing in a customer's yard does not have a laptop, and half the people this
product sends messages to will not open an email. SMS is the channel that reaches them. In India
it is also the channel with the most rules: every transactional message must match a template
registered on a DLT platform, sent from a registered sender id, or the operator drops it
silently. A send that quietly goes nowhere is worse than a failure, so the template is a record
in the database, not a string in the code.

## Scope

- **Settings per tenant**: provider, the DLT principal entity id, the sender id, and the
  provider's auth key encrypted at rest and never returned.
- **Templates** as rows: code, DLT template id, category, the body with its placeholders, and the
  variables in order. A transactional send without a DLT id is refused before it is attempted.
- **Rendering** that refuses a missing variable rather than sending `{#var#}` to a customer, and
  refuses a variable carrying a URL or a newline — both of which make the operator drop the
  message against a registered template.
- **Segment counting** on the real rules: 160 characters of GSM-7, 70 of UCS-2, and 153/67 once a
  message splits — so the screen can say what a send will cost before it is made.
- **A message log**: what was sent, to whom, against which template, and what the provider said.
- **One-time passwords**: a six-digit code, stored only as a hash, that expires, counts its
  attempts, and is rate-limited per number.
- **The provider seam**: `SmsProvider` with a fixture adapter that behaves like a gateway —
  refuses an unregistered template, reports delivery, and fails a number on the DND registry.

## Out of scope

A live MSG91 adapter. No account was supplied.

OTP login. Wiring one-time passwords into authentication changes how sessions are created, which
is an auth change and needs the named approver; the challenge service is built and tested so that
change is small, but it is not made here.

## Acceptance

- A transactional template without a DLT id cannot be used.
- A render with a missing variable is refused; so is one whose value carries a URL or a newline.
- Segment counts follow GSM-7 and UCS-2 rules, including the split-message sizes.
- An Indian mobile number is normalised to ten digits from any of the usual forms, and anything
  that is not one is refused.
- A code is never stored in the clear and never returned by any endpoint.
- A wrong code counts an attempt; the sixth attempt is refused whatever the code.
- An expired code fails even when correct, and a consumed one cannot be used twice.
- Asking for a fourth code inside the window is refused.
- Every query is tenant-scoped.
