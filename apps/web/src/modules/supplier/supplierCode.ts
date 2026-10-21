/**
 * Fetches the next supplier code, retrying a failed request a few times.
 * Resolves to "" when every attempt fails, so the caller can let the user type a code.
 */
export async function fetchSupplierCodeWithRetry(
  fetchNext: () => Promise<string>,
  { attempts = 3, delayMs = 500 }: { attempts?: number; delayMs?: number } = {}
): Promise<string> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const code = await fetchNext();
      if (code) return code;
    } catch {
      // fall through to the next attempt
    }
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return "";
}
