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

export interface ProfileResponseDto {
  user: UserResponseDto;
  permissions: string[];
  isSuperAdmin?: boolean;
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
}
