// Helper to convert any Date to IST date parts or string. Needed because server/browser timezone may not be IST.
export const getISTDateParts = (d: Date = new Date()) => {
  const istString = d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  return {
    year: istDate.getFullYear(),
    month: istDate.getMonth(), // 0-indexed
    day: istDate.getDate(),
    hours: istDate.getHours(),
    minutes: istDate.getMinutes(),
  };
};

// Helper to get IST date string in YYYY-MM-DD format. Needed because server/browser timezone may not be IST.
export const getISTDateString = (d: Date = new Date()) => {
  const parts = getISTDateParts(d);
  const month = String(parts.month + 1).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
};

/**
 * The real UTC instant of IST midnight for the IST calendar day `d` falls on. Not the same as
 * `new Date(Date.UTC(y, m, day))` built from `getISTDateParts` — that lands on UTC midnight of
 * the IST day's own date, which is ~5.5 hours (the IST offset) after true IST midnight. Use this
 * whenever a "since the start of today (IST)" boundary must line up with real timestamps (e.g.
 * filtering transactions by `txnDateTime`); use `getISTDateParts`/`getISTDateString` instead when
 * you only need a calendar-day identity to compare against another date built the same way.
 */
export const getISTDayStartUtc = (d: Date = new Date()): Date =>
  new Date(`${getISTDateString(d)}T00:00:00+05:30`);
