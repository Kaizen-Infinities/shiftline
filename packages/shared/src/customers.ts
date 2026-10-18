/**
 * Largest `limit` the customer list endpoint (GET /api/customers) accepts; larger values are a 400.
 * The API validates against it and the web client clamps to it, so every customer picker stays inside the cap.
 */
export const CUSTOMER_LIST_MAX_LIMIT = 100;
