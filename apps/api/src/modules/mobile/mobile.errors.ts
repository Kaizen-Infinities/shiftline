/**
 * What a device (and the stored sync record) may learn about a failed record.
 * ApiError messages are written for users and pass through with their code;
 * anything else is logged in full and replaced by a fixed sentence.
 */
import { logger } from "../../lib/logger";
import { getRequestId } from "../../lib/request-context";
import { ApiError } from "../../utils/ApiError";

export const GENERIC_RECORD_ERROR = "Could not save this record";

export function describeFailure(err: unknown, context: Record<string, unknown> = {}) {
  if (err instanceof ApiError && err.statusCode < 500) {
    return { message: err.message, code: err.code };
  }
  const requestId = getRequestId();
  logger.error({ err, ...context }, "mobile record failed");
  return {
    message: requestId ? `${GENERIC_RECORD_ERROR} (ref ${requestId})` : GENERIC_RECORD_ERROR,
    code: "RECORD_FAILED",
  };
}
