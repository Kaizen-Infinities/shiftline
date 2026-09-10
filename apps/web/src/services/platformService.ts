import apiClient from "../api/apiClient";
import type { AuditEntry } from "./auditTrailService";

/** Platform console (P1-02): super-admin views of the fleet and of one tenant. */
export interface TenantRow {
  id: string;
  companyCode: string | null;
  companyName: string;
  slug: string | null;
  gstin: string | null;
  isActive: boolean;
  isOnboarded: boolean;
  onboardingStep: string | null;
  tosAcceptedAt: string | null;
  createdAt: string;
  plan: { code: string; name: string } | null;
  subscriptionStatus: string | null;
  users: number;
  pendingInvitations: number;
}

export interface PlatformOverview {
  tenants: { total: number; active: number; suspended: number; onboarded: number };
  activeUsers: number;
  activeDevices: number;
  subscriptionsByStatus: Record<string, number>;
  subscriptionsByPlan: {
    plan: { id: string; code: string | null; name: string | null };
    count: number;
  }[];
  activeImpersonations: ImpersonationRow[];
}

export interface ImpersonationRow {
  id: string;
  admin: { fullName: string | null; username: string | null };
  adminId: string;
  company: { id: string; companyName: string | null };
  user: { userId: string; fullName: string | null; username: string | null };
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: string | null;
  active: boolean;
}

export interface TenantDetail {
  company: {
    id: string;
    companyCode: string | null;
    companyName: string;
    legalName: string | null;
    slug: string | null;
    gstin: string | null;
    email: string | null;
    phone: string | null;
    isActive: boolean;
    isOnboarded: boolean;
    createdAt: string;
  };
  subscription: {
    status: string;
    seats: number | null;
    apiLimit: number | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    notes: string | null;
    plan: { code: string; name: string };
  } | null;
  overrides: OverrideRow[];
  entitlements: { features: string[]; seatLimit: number | null; seatsUsed: number; status: string };
  usage: {
    users: number;
    activeUsers: number;
    pendingInvitations: number;
    activeDevices: number;
    last30Days: { salesInvoices: number; vouchers: number; grns: number };
    lastLoginAt: string | null;
  };
  owners: {
    userId: string;
    fullName: string;
    username: string;
    email: string | null;
    status: string;
  }[];
}

export interface OverrideRow {
  id: string;
  feature: string;
  enabled: boolean;
  reason: string | null;
  expiresAt: string | null;
}

export interface TenantUser {
  userId: string;
  fullName: string;
  username: string;
  email: string | null;
  status: string;
  lastLoginAt: string | null;
  role: { code: string; name: string } | null;
}

export interface DeviceRow {
  id: string;
  deviceId: string;
  userId: string;
  agentName: string;
  agentUsername: string | null;
  platform: string | null;
  appVersion: string | null;
  model: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  revokedAt: string | null;
}

export interface Plan {
  code: string;
  name: string;
  description: string | null;
  features: string[];
  seatLimit: number | null;
  apiLimit: number | null;
  priceInrMonthly: string | number | null;
  isActive: boolean;
}

export interface ProvisionInput {
  companyCode: string;
  companyName: string;
  legalName?: string;
  slug: string;
  email?: string;
  phone?: string;
  gstin?: string;
  planCode?: string;
  subscriptionStatus?: "TRIALING" | "ACTIVE";
  owner: { email: string; fullName: string };
}

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const platformService = {
  overview: () => data<PlatformOverview>(apiClient.get("/platform/overview")),
  tenants: () => data<TenantRow[]>(apiClient.get("/platform/tenants")),
  provision: (input: ProvisionInput) =>
    data<{
      company: { id: string };
      ownerInvitation: { email: string; acceptUrl?: string; emailed: boolean };
    }>(apiClient.post("/platform/tenants", input)),
  tenant: (id: string) => data<TenantDetail>(apiClient.get(`/platform/tenants/${id}`)),
  updateTenant: (
    id: string,
    body: {
      isActive?: boolean;
      suspendReason?: string;
      companyName?: string;
      email?: string | null;
      phone?: string | null;
    }
  ) => data<TenantDetail["company"]>(apiClient.put(`/platform/tenants/${id}`, body)),
  updateSubscription: (
    id: string,
    body: {
      planCode?: string;
      status?: string;
      seats?: number | null;
      apiLimit?: number | null;
      notes?: string | null;
    }
  ) => data<unknown>(apiClient.put(`/platform/tenants/${id}/subscription`, body)),
  setOverride: (id: string, feature: string, body: { enabled: boolean; reason?: string | null }) =>
    data<unknown>(apiClient.put(`/platform/tenants/${id}/overrides/${feature}`, body)),
  removeOverride: (id: string, feature: string) =>
    data<unknown>(apiClient.delete(`/platform/tenants/${id}/overrides/${feature}`)),
  users: (id: string) => data<TenantUser[]>(apiClient.get(`/platform/tenants/${id}/users`)),
  audit: (id: string, params: Record<string, string | number>) =>
    data<{ data: AuditEntry[]; total: number; page: number; pages: number }>(
      apiClient.get(`/platform/tenants/${id}/audit`, { params })
    ),
  devices: (id: string) => data<DeviceRow[]>(apiClient.get(`/platform/tenants/${id}/devices`)),
  revokeDevice: (id: string, deviceId: string) =>
    data<DeviceRow>(apiClient.post(`/platform/tenants/${id}/devices/${deviceId}/revoke`)),
  impersonate: (id: string, body: { userId?: string; reason: string }) =>
    data<{
      accessToken: string;
      accessTokenExpiresAt: string;
      impersonation: { id: string; expiresAt: string; reason: string };
      user: { fullName: string; username: string };
      company: { companyName: string };
    }>(apiClient.post(`/platform/tenants/${id}/impersonate`, body)),
  impersonations: (
    params: { companyId?: string; active?: "true" | "false"; limit?: number } = {}
  ) => data<ImpersonationRow[]>(apiClient.get("/platform/impersonations", { params })),
  endImpersonation: (id: string) =>
    data<unknown>(apiClient.post(`/platform/impersonations/${id}/end`)),
  plans: () => data<{ plans: Plan[] } | Plan[]>(apiClient.get("/platform/plans")),
};
