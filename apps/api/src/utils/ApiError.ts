/**
 * Application error with an HTTP status, an optional machine-readable `code`
 * (for example FEATURE_NOT_IN_PLAN) and optional details for the client.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly success: boolean;
  public readonly code?: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.success = false;
    this.code = code;
    this.details = details;

    // Preserve original stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}
