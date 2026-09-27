# Dashboards — failures say so, dates are local

**Changelog:** When a dashboard can't load, it now says so and offers "Try again" instead of
showing "nothing here yet". The production dashboard's "today" and "this week" figures now follow
Indian time, including on Sundays.

## Before

- **`useListCache` gave up too early.** It set `loading` to false after the first failed attempt,
  while its retries were still pending. The hook had no error state, so a failed dashboard summary
  showed "Nothing planned for today" and "No sales orders yet". A failed money summary hid the
  Money section entirely. It also read `sessionStorage` without a guard, which throws when storage
  is blocked.
- **Production dates were wrong.**
  - It worked out "today" in UTC, so in India the day changed at 05:30.
  - On a Sunday, "this week" started on the following Monday, so the week total counted nothing.
  - A malformed `orderDate` threw a RangeError and took the page down.
  - A failed orders or machines load showed "0 PCS" and "No machines yet".
- **The OEE page misreported failures.** A failed load read "No machines to show", with a toast
  every 60 seconds. A slow reply for the previous day could overwrite the newly chosen day, and
  a cleared date field fetched with no date.

## Now

- **`useListCache`** returns `error`, which is set once every retry has failed and cleared by the
  next success. `loading` stays true while retries are pending, and the `sessionStorage` read is
  guarded. The file was first reformatted with prettier in its own commit, so the behaviour change
  reads as a small diff.
- **`LoadError`** in `DashboardPrimitives.tsx` is the shared failed-load state: `role="alert"`, a
  plain message, and a "Try again" button at least 40 px tall.
- **Executive dashboard:**
  - a banner with a retry when the summary fails;
  - a `LoadError` in the Money section when the accounts summary fails;
  - the Today tiles show `LoadError` instead of their empty states.
- **Production dashboard:**
  - local-day keys and a Monday-start week that also works on Sundays;
  - orders with invalid dates are skipped;
  - a banner with a retry when orders fail, and figures show "—" / "Not loaded";
  - the machine tiles show `LoadError` when machines fail.
- **OEE page:**
  - only the newest request may write state;
  - a date change starts from a clean slate, and a cleared date keeps the last figures;
  - the first failure shows `LoadError`; a failed refresh keeps the last figures with a
    "Couldn't refresh · showing figures from 18:42" note;
  - the toast is gone.

Checked on the running stack by making the dashboard, OEE, machines and production-order API calls
fail in Playwright (1440 px and 390 px), and again with a normal load.

## Not done

- `useListCache` has 46 callers. They all get `error` now, but only the dashboards show it; the
  list screens still fall back to their empty states when a load fails.
- The production slices' shared `error` field is also set by failed create, update and delete
  calls. The dashboard only treats it as a load failure when no rows are loaded.
- The OEE page still polls every minute while the tab is hidden.
