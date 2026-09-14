import apiClient from "../api/apiClient";
import config from "../api/config";

const getBaseUrl = () => {
  return (config as any).salesInvoice?.base || "/sales-invoices";
};

export const salesInvoiceService = {
  fetchAll: async (params?: any): Promise<any> => {
    const response = await apiClient.get(getBaseUrl(), { params });
    return response.data?.data || response.data;
  },

  fetchById: async (id: string): Promise<any> => {
    const response = await apiClient.get(`${getBaseUrl()}/${id}`);
    return response.data?.data || response.data;
  },

  create: async (data: any): Promise<any> => {
    const response = await apiClient.post(getBaseUrl(), data);
    return response.data?.data || response.data;
  },

  update: async (id: string, data: any): Promise<any> => {
    const response = await apiClient.put(`${getBaseUrl()}/${id}`, data);
    return response.data?.data || response.data;
  },

  /** Books are never deleted: cancel with a reason (P1-09/P1-10d). */
  cancel: async (id: string, reason: string): Promise<void> => {
    await apiClient.post(`${getBaseUrl()}/${id}/cancel`, { reason });
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`${getBaseUrl()}/${id}`);
  },

  emailInvoice: async (
    id: string,
    recipientEmail: string,
    subject: string,
    message: string
  ): Promise<any> => {
    const response = await apiClient.post(`${getBaseUrl()}/${id}/email-invoice`, {
      recipientEmail,
      subject,
      message,
    });
    return response.data?.data || response.data;
  },

  whatsappInvoice: async (id: string, to: string, message: string): Promise<any> => {
    const response = await apiClient.post(`${getBaseUrl()}/${id}/whatsapp-invoice`, {
      to,
      message,
    });
    return response.data?.data || response.data;
  },

  /** P2-12: record a receipt (cash/bank/cheque) against a sales invoice by hand. */
  recordReceipt: async (id: string, data: any): Promise<any> => {
    const response = await apiClient.post(`${getBaseUrl()}/${id}/receipts`, data);
    return response.data?.data || response.data;
  },

  /** P2-12: the receipts recorded on this invoice, each joined with its cheque status. */
  fetchReceipts: async (id: string): Promise<any[]> => {
    const response = await apiClient.get(`${getBaseUrl()}/${id}/receipts`);
    return response.data?.data || response.data || [];
  },
};
export default salesInvoiceService;
