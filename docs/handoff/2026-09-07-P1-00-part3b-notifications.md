# P1-00 part 3b — notification centre

## Shipped

- `Notification` model (RLS, per-recipient rows), `NOTIFICATIONS` retention class, personal socket
  rooms and `emitToUser()`.
- `notify()` producer helper with user, permission and everyone audiences; first producers:
  invitation accepted, onboarding completed, import committed, retention sweep, EOD snapshot failure.
- `/api/notifications` reader API; header bell with live updates and a `/notifications` page.
- Migration `20260907020000_notifications`; 126 API tests (notifications.spec.ts adds 5); smoke suite
  covers the page (14 screens).

## Half-done / known gaps

- No email or WhatsApp delivery yet; notifications are in-app only. Delivery preferences per user
  arrive with the compliance calendar (P1-13) which is the first producer that needs reminders.
- Platform admins have no notifications (they have no tenant user row); the admin console (P1-02)
  gets its own feed from `emitToPlatform`.
- Producers for documents (invoice approved, payment received) are added as those flows are touched
  in P1-08 onward; the helper is ready.

## Next

- Part 3c: surrogate uuid keys for the seven code-keyed models, Prisma 8 evaluation, retire the
  legacy password-by-email user creation, then P1-00 close-out.

## Blocked on you

- Unchanged: branch protection and approver handle; pentest vendor; Anthropic API key decision;
  the terms-of-service document.
