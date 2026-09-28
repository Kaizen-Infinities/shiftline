import type { Locale } from "@shiftline/shared";

export type UserStatus = "active" | "suspended" | "locked";

export interface LoginDto {
  email: string;
  password: string;
}

export interface UserResponseDto {
  userId: string;
  fullName: string;
  email: string | null;
  username: string;
  roleId: string | null; // ROLE_ADMIN, etc.
  status: UserStatus;
  isSuperAdmin?: boolean;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  /** UI language (TN-04); absent from older sessions, which read as English. */
  locale?: Locale;
  avatarUrl?: string | null;
  profilePicture?: string | null;
  photoUrl?: string | null;
}

export interface Entitlements {
  plan: { code: string; name: string } | null;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "NONE";
  features: string[];
  seatLimit: number | null;
  seatsUsed: number;
  apiLimit: number | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  readOnly: boolean;
  pastDue: boolean;
}

export interface ProfileResponseDto {
  user: UserResponseDto;
  permissions: string[];
  isSuperAdmin?: boolean;
  /** Plan features, seats and status of the tenant (P1-01); absent for platform admins. */
  entitlements?: Entitlements;
}

export interface AuthState {
  user: UserResponseDto | null;
  permissions: string[];
  /** In memory only; renewed from the httpOnly refresh cookie (P0-13). */
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  /** Null until the profile loads; platform admins keep it null. */
  entitlements: Entitlements | null;
  /** Set while a platform admin acts as a tenant user (P1-02); read from the token. */
  impersonation: { id: string; impersonatedBy: string; expiresAt: string; reason: string } | null;
  /**
   * Whose data the client may hold: "userId|companyId|impersonationId" from the access token,
   * null when signed out. A change resets every tenant-scoped cache (app/sessionReset.ts).
   */
  identity: string | null;
  /**
   * The path being switched to while one session is swapped for another (impersonation start
   * or stop), else null. Protected routes render a loader until the router shows that path,
   * so no screen of either identity mounts, and fetches, mid-swap. The router commits
   * navigation as a transition, after ordinary state updates, which is why clearing a flag
   * right after `navigate()` is not enough.
   */
  sessionSwitchTarget: string | null;
}
