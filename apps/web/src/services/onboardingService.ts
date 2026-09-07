import apiClient from "../api/apiClient";
import config from "../api/config";
import type {
  BankStepPayload,
  CompanyStepPayload,
  FinancialYearStepPayload,
  GstStepPayload,
  InvitationResult,
  OnboardingState,
  OnboardingStepKey,
  UsersStepPayload,
} from "../modules/onboarding/types";

const base = config.onboarding.base;
const unwrap = <T>(res: { data?: { data?: T } }) => res.data?.data as T;

/** Onboarding wizard API (P1-00). Every step answers with the next step to show. */
export const onboardingService = {
  getState: async (): Promise<OnboardingState> => unwrap(await apiClient.get(base)),

  saveCompany: async (body: CompanyStepPayload): Promise<{ step: OnboardingStepKey }> =>
    unwrap(await apiClient.put(`${base}/company`, body)),

  saveGst: async (body: GstStepPayload): Promise<{ step: OnboardingStepKey }> =>
    unwrap(await apiClient.put(`${base}/gst`, body)),

  saveFinancialYear: async (body: FinancialYearStepPayload): Promise<{ step: OnboardingStepKey }> =>
    unwrap(await apiClient.put(`${base}/financial-year`, body)),

  saveBank: async (body: BankStepPayload): Promise<{ step: OnboardingStepKey }> =>
    unwrap(await apiClient.put(`${base}/bank`, body)),

  saveUsers: async (
    body: UsersStepPayload
  ): Promise<{ step: OnboardingStepKey; results: InvitationResult[] }> =>
    unwrap(await apiClient.put(`${base}/users`, body)),

  acceptTos: async (version: string): Promise<{ version: string; acceptedAt: string }> =>
    unwrap(await apiClient.post(`${base}/accept-tos`, { version })),

  complete: async (): Promise<{ isOnboarded: boolean }> =>
    unwrap(await apiClient.post(`${base}/complete`, {})),
};
