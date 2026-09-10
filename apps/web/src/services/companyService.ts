import apiClient from "../api/apiClient";
import config from "../api/config";
import type { Company, UpdateCompanyDto } from "../features/company/types";

export type CompanyBranding = Pick<Company, "companyName" | "logoUrl" | "faviconUrl"> & { shortName?: string | null; isOnboarded?: boolean };

export const companyService = {
  /** Public branding for the login screen (no auth). */
  getPublicCompany: async (): Promise<CompanyBranding> => {
    const response = await apiClient.get(`${config.company.base}/public`);
    return response.data?.data || response.data;
  },

  getCompany: async (): Promise<Company> => {
    const response = await apiClient.get(config.company.base);
    return response.data?.data || response.data;
  },

  updateCompany: async (id: string, data: UpdateCompanyDto): Promise<Company> => {
    const response = await apiClient.put(`${config.company.base}/${id}`, data);
    return response.data?.data || response.data;
  },
};

