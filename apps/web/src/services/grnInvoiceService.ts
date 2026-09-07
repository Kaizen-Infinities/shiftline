import apiClient from "../api/apiClient";
import config from "../api/config";

export const grnInvoiceService = {
  fetchAll: async (params?: any): Promise<any> => {
    const response = await apiClient.get(config.grnInvoice.base, { params });
    return response.data?.data || response.data;
  },

  fetchById: async (id: string): Promise<any> => {
    const response = await apiClient.get(`${config.grnInvoice.base}/${id}`);
    return response.data?.data || response.data;
  },

  create: async (data: any): Promise<any> => {
    const response = await apiClient.post(config.grnInvoice.base, data);
    return response.data?.data || response.data;
  },

  update: async (id: string, data: any): Promise<any> => {
    const response = await apiClient.put(`${config.grnInvoice.base}/${id}`, data);
    return response.data?.data || response.data;
  },

  /** Books are never deleted: cancel with a reason (P1-09/P1-10d). */
  cancel: async (id: string, reason: string): Promise<void> => {
    await apiClient.post(`${config.grnInvoice.base}/${id}/cancel`, { reason });
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`${config.grnInvoice.base}/${id}`);
  },

  fetchNextCode: async (): Promise<string> => {
    const response = await apiClient.get(config.grnInvoice.nextCode);
    return response.data?.data || "";
  },
};
