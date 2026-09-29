import type { Locale } from "@shiftline/shared";
import { UserStatus } from "./auth.types";

export interface UserResponse {
  userId: string;
  fullName: string;
  email: string | null;
  username: string;
  roleId: string;
  status: UserStatus;
  /** UI language (TN-04). */
  locale: Locale;
  lastLoginAt?: Date | null;
  createdOn: Date;
}
