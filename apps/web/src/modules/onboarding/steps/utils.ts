/** Helpers shared by the onboarding steps that are not React components. */

export const inputClass =
  "mt-1 w-full min-h-10 rounded-sm border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50";

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
