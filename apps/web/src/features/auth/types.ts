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
}
