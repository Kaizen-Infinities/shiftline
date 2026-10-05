/**
 * True when a field of a zod object schema rejects both a missing and a blank
 * value, i.e. the form must show its required marker. Lets forms derive the
 * marker from the same schema that validates them instead of repeating it.
 */
export const isRequiredField = (
  schema: { shape?: Record<string, { safeParse: (v: unknown) => { success: boolean } }> },
  name: string
): boolean => {
  const field = schema.shape?.[name];
  if (!field) return false;
  return !field.safeParse(undefined).success && !field.safeParse("").success;
};
