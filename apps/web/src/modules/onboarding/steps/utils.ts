/** Helpers shared by the onboarding steps that are not React components. */

export const inputClass =
  "sl-input mt-1.5 min-h-11 text-sm font-normal placeholder:text-ink-subtle disabled:opacity-50";

/** Message from an axios error body (`message`, plus the first field error when present). */
export const apiMessage = (err: unknown): string => {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data) return (err as Error)?.message || "Something went wrong";
  const message = typeof data.message === "string" ? data.message : "Request failed";
  const errors = data.errors;
  if (Array.isArray(errors) && errors.length) {
    const first = errors[0] as { path?: unknown; message?: string };
    const path =
      typeof first.path === "string"
        ? first.path
        : Array.isArray(first.path)
          ? first.path.join(".")
          : "";
    if (first.message)
      return path ? `${message}: ${path} — ${first.message}` : `${message}: ${first.message}`;
  }
  return message;
};
