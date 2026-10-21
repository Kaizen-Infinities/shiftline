export interface PhoneListEntry {
  label: string;
  number: string;
}

/**
 * Converts a stored mobile value into the `{ label, number }` entries that PhoneInput expects.
 * Seeded and older records keep mobiles as plain strings (`["9000000001"]` or `"9000000001"`).
 */
export const toPhoneEntries = (value: unknown): PhoneListEntry[] => {
  if (typeof value === "string") {
    return value.trim() ? [{ label: "Primary Mobile Number", number: value.trim() }] : [];
  }
  if (!Array.isArray(value)) return [];

  const entries: PhoneListEntry[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const number = item.trim();
      if (!number) continue;
      entries.push({
        label: entries.length === 0 ? "Primary Mobile Number" : "Alternative Number",
        number,
      });
    } else if (
      item &&
      typeof item === "object" &&
      typeof (item as PhoneListEntry).number === "string"
    ) {
      const { label, number } = item as PhoneListEntry;
      entries.push({ label: label || "Alternative Number", number });
    }
  }
  return entries;
};
