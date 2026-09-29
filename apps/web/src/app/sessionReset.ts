import { createAction, createListenerMiddleware } from "@reduxjs/toolkit";

import { clearAllDetailCaches } from "../hooks/useDetailCache";
import { clearAllListCaches } from "../hooks/useListCache";
import { baseApi } from "../services/baseApi";

/**
 * Tenant isolation on the client. Every cache here is keyed by screen, not by tenant, so it is
 * only safe while one identity is signed in. When the identity changes (sign in, sign out, a
 * failed refresh, impersonation start or stop) everything tenant-scoped is dropped:
 *
 * - the list and detail caches, in memory and in sessionStorage;
 * - every Redux slice except `auth` (see `sessionReset` in app/store.ts);
 * - the RTK Query cache.
 *
 * The identity also goes to sessionStorage, so a reload whose refresh cookie belongs to someone
 * else (signed in from another tab) cannot reuse this tab's cached rows either.
 */

/** Resets every Redux slice except `auth` to its initial state. */
export const sessionReset = createAction("session/reset");

const IDENTITY_KEY = "shiftline:identity";

const readStoredIdentity = (): string | null => {
  try {
    return sessionStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
};

const storeIdentity = (identity: string | null) => {
  try {
    if (identity) sessionStorage.setItem(IDENTITY_KEY, identity);
    else sessionStorage.removeItem(IDENTITY_KEY);
  } catch {
    // storage blocked: the in-memory reset below still happens
  }
};

type WithIdentity = { auth: { identity: string | null } };

export const sessionListener = createListenerMiddleware();

sessionListener.startListening({
  predicate: (_action, current, previous) =>
    (current as WithIdentity).auth.identity !== (previous as WithIdentity).auth.identity,
  effect: (_action, api) => {
    const identity = (api.getState() as WithIdentity).auth.identity;
    // Same identity as the rows this tab already cached (a reload, or a token refresh after
    // a sign-out-less restart): keep them, that is what the cache is for.
    if (identity && identity === readStoredIdentity()) return;
    clearAllListCaches();
    clearAllDetailCaches();
    api.dispatch(sessionReset());
    api.dispatch(baseApi.util.resetApiState());
    storeIdentity(identity);
  },
});
