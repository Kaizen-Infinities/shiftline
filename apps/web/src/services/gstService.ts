import apiClient from "../api/apiClient";
import config from "../api/config";

export interface GstState {
  code: string;
  name: string;
  alpha: string;
}

export interface GstSlab {
  id: string;
  name: string;
  rate: string | number;
  cessRate: string | number;
  isActive: boolean;
}

export interface HsnCode {
  id: string;
  code: string;
  type: "HSN" | "SAC";
  description: string;
  gstRate: string | number;
  cessRate: string | number;
  isActive: boolean;
  _count?: { products: number; rawMaterials: number };
}

export interface HsnInput {
  code: string;
  type: "HSN" | "SAC";
  description: string;
  gstRate: number;
  cessRate?: number;
  isActive?: boolean;
}

export interface GstinCheck {
  gstin: string;
  valid: boolean;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  entityType: string | null;
}

const base = config.gst.base;
const data = <T>(res: { data?: { data?: T } }) => res.data?.data as T;

/** GST masters (P1-08): slabs, HSN/SAC codes, state table and GSTIN validation. */
export const gstService = {
  states: async (): Promise<GstState[]> => data(await apiClient.get(`${base}/states`)) ?? [],

  validateGstin: async (gstin: string): Promise<GstinCheck> =>
    data(await apiClient.post(`${base}/validate-gstin`, { gstin })),

  listRates: async (includeInactive = false): Promise<GstSlab[]> =>
    data(await apiClient.get(`${base}/rates`, { params: { includeInactive } })) ?? [],
  createRate: async (input: { name: string; rate: number; cessRate?: number }): Promise<GstSlab> =>
    data(await apiClient.post(`${base}/rates`, input)),
  updateRate: async (
    id: string,
    input: Partial<{ name: string; rate: number; cessRate: number; isActive: boolean }>
  ): Promise<GstSlab> => data(await apiClient.put(`${base}/rates/${id}`, input)),
  deactivateRate: async (id: string): Promise<GstSlab> =>
    data(await apiClient.delete(`${base}/rates/${id}`)),

  listHsn: async (params: {
    search?: string;
    type?: "HSN" | "SAC";
    includeInactive?: boolean;
    limit?: number;
  }): Promise<HsnCode[]> => data(await apiClient.get(`${base}/hsn`, { params })) ?? [],
  lookupHsn: async (code: string): Promise<HsnCode | null> => {
    try {
      return data(await apiClient.get(`${base}/hsn/lookup/${code}`));
    } catch {
      return null;
    }
  },
  createHsn: async (input: HsnInput): Promise<HsnCode> =>
    data(await apiClient.post(`${base}/hsn`, input)),
  updateHsn: async (id: string, input: Partial<HsnInput>): Promise<HsnCode> =>
    data(await apiClient.put(`${base}/hsn/${id}`, input)),
  removeHsn: async (id: string): Promise<HsnCode> =>
    data(await apiClient.delete(`${base}/hsn/${id}`)),
};
