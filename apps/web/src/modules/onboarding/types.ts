export type OnboardingStepKey = "company" | "gst" | "financial-year" | "bank" | "users" | "review";

export interface OnboardingBusinessPlace {
  id?: string | null;
  code: string;
  name: string;
  type: "HEAD_OFFICE" | "BRANCH_OFFICE" | "FACTORY" | "WAREHOUSE" | "RETAIL_STORE";
  gstPlaceCode: string;
  phone?: string | null;
  email?: string | null;
  isHeadOffice: boolean;
  isActive?: boolean;
  addressLine1?: string | null;
  city?: string | null;
  zipcode?: string | null;
}

export interface OnboardingBankAccount {
  ledgerId?: number | null;
  code?: string;
  name: string;
  bankName: string;
  accountName?: string | null;
  accountNumber?: string | null;
  ifsc?: string | null;
  branch?: string | null;
  upiId?: string | null;
  openingBalance?: number;
  currentBalance?: number;
  hasOpeningBalance?: boolean;
  isDefault: boolean;
}

export interface OnboardingState {
  step: OnboardingStepKey | null;
  isOnboarded: boolean;
  steps: { key: OnboardingStepKey; label: string; done: boolean }[];
  tos: { version: string; acceptedAt: string | null; acceptedBy: string | null; accepted: boolean };
  company: {
    id: string;
    companyCode: string | null;
    slug: string | null;
    companyName: string;
    legalName: string | null;
    shortName: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
    country: string | null;
    gstin: string | null;
  };
  gst: {
    registrationType: "REGULAR" | "COMPOSITION" | "UNREGISTERED" | null;
    gstin: string | null;
    businessPlaces: OnboardingBusinessPlace[];
  };
  financialYear: {
    start: string;
    end: string;
    code: string;
    periodName: string;
    booksBeginOn: string;
  } | null;
  bankAccounts: OnboardingBankAccount[];
  users: {
    userId: string;
    fullName: string;
    email: string | null;
    status: string;
    roleCode: string | null;
    roleName: string | null;
  }[];
  invitations: {
    id: string;
    email: string;
    fullName: string | null;
    expiresAt: string;
    roleCode: string;
    roleName: string;
  }[];
  roles: { id: number; code: string; name: string; description: string | null }[];
}

export interface CompanyStepPayload {
  companyName: string;
  legalName?: string | null;
  shortName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  country?: string | null;
}

export interface GstStepPayload {
  registrationType: "REGULAR" | "COMPOSITION" | "UNREGISTERED";
  gstin?: string | null;
  businessPlaces: OnboardingBusinessPlace[];
}

export interface FinancialYearStepPayload {
  fyStart: string;
  booksBeginOn?: string | null;
}

export interface BankStepPayload {
  accounts: OnboardingBankAccount[];
}

export interface UsersStepPayload {
  invitations: { email: string; fullName?: string | null; roleCode: string }[];
}

export interface InvitationResult {
  email: string;
  status: "invited" | "exists" | "error";
  message?: string;
  acceptUrl?: string;
  emailed?: boolean;
}
