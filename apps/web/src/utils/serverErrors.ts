/**
 * Maps the API validation error shape ({ message, errors: [{ path, message }] })
 * onto form fields. Works with react-hook-form's `setError` or any setter, so every
 * form can surface server-side field errors the same way.
 */
export type ServerFieldError = { path: string; message: string };

type ErrorLike = {
  message?: unknown;
  errors?: unknown;
  response?: { data?: { message?: unknown; errors?: unknown } };
};

const isFieldError = (e: unknown): e is ServerFieldError =>
  !!e &&
  typeof (e as ServerFieldError).message === "string" &&
  (e as ServerFieldError).message !== "";

/** Field errors from a thunk rejection, axios error or plain API body. Strips the `body.` prefix. */
export const getServerFieldErrors = (err: unknown): ServerFieldError[] => {
  const e = (err ?? {}) as ErrorLike;
  const raw = e.errors ?? e.response?.data?.errors;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFieldError).map((item) => ({
    path: String(item.path ?? "").replace(/^(body|query|params)\./, ""),
    message: item.message,
  }));
};

/**
 * Text for a toast: the first field message when the API sent field errors,
 * otherwise the error's own message, otherwise `fallback`.
 */
export const getServerErrorMessage = (err: unknown, fallback: string): string => {
  const first = getServerFieldErrors(err)[0];
  if (first) return first.message;
  if (typeof err === "string" && err) return err;
  const e = (err ?? {}) as ErrorLike;
  const msg = e.response?.data?.message ?? e.message;
  return typeof msg === "string" && msg ? msg : fallback;
};

/**
 * Puts each server field error on its field (`setError(path, { type: "server", message })`).
 * `aliases` renames API paths to form field names. Returns the toast text.
 */
export const applyServerErrors = (
  err: unknown,
  setError: (name: any, error: { type: string; message: string }) => void,
  fallback: string,
  aliases: Record<string, string> = {}
): string => {
  for (const { path, message } of getServerFieldErrors(err)) {
    if (!path) continue;
    setError(aliases[path] ?? path, { type: "server", message });
  }
  return getServerErrorMessage(err, fallback);
};
