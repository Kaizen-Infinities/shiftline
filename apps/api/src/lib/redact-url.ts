/** Query parameters that act as capabilities (API-04); their values never reach logs or audit rows. */
const SENSITIVE_QUERY = /([?&](?:token|code|signature|sig|access_token|refresh_token)=)[^&#]*/gi;

export const redactUrl = (url: string | undefined): string | undefined =>
  url?.replace(SENSITIVE_QUERY, "$1[REDACTED]");
