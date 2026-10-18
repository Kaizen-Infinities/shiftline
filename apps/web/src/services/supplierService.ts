import apiClient from "../api/apiClient";
import config from "../api/config";
import type { Supplier, CreateSupplierDto, UpdateSupplierDto } from "../features/supplier/types";

/** Largest `limit` GET /api/suppliers accepts (supplier.validation.ts). Larger asks get a 400. */
export const SUPPLIER_LIST_MAX_LIMIT = 100;

export const supplierService = {
  fetchAll: async (params?: string | any): Promise<any> => {
    let queryParams = typeof params === "string" ? { search: params } : params;
    if (queryParams && queryParams.limit !== undefined) {
      queryParams = {
        ...queryParams,
        limit: Math.min(Number(queryParams.limit), SUPPLIER_LIST_MAX_LIMIT),
      };
    }
    const response = await apiClient.get(config.supplier.base, { params: queryParams });
    const resData = response.data?.data || response.data;
    if (resData && typeof resData === "object" && "suppliers" in resData) {
      if (queryParams && (queryParams.page !== undefined || queryParams.limit !== undefined)) {
        return resData;
      }
      return resData.suppliers;
    }
    return resData;
  },

  /**
   * Every supplier matching the filters, fetched page by page at the API cap. Use this for
   * lists and dropdowns that need the whole set; the API refuses one request above the cap.
   */
  fetchAllSuppliers: async (params: { search?: string; status?: string } = {}): Promise<any[]> => {
    const rows: any[] = [];
    for (let page = 1; ; page += 1) {
      const res = await supplierService.fetchAll({
        ...params,
        page,
        limit: SUPPLIER_LIST_MAX_LIMIT,
      });
      const batch: any[] = Array.isArray(res?.suppliers) ? res.suppliers : [];
      rows.push(...batch);
      const totalPages = Number(res?.pagination?.totalPages) || 1;
      if (batch.length === 0 || page >= totalPages) break;
    }
    return rows;
  },

  fetchById: async (id: string): Promise<Supplier> => {
    const response = await apiClient.get(`${config.supplier.base}/${id}`);
    return response.data?.data || response.data;
  },

  create: async (data: CreateSupplierDto): Promise<Supplier> => {
    const response = await apiClient.post(config.supplier.base, data);
    return response.data?.data || response.data;
  },

  update: async (id: string, data: UpdateSupplierDto): Promise<Supplier> => {
    const response = await apiClient.put(`${config.supplier.base}/${id}`, data);
    return response.data?.data || response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`${config.supplier.base}/${id}`);
  },

  fetchNextCode: async (): Promise<string> => {
    const response = await apiClient.get(config.supplier.base + "/next-code");
    return response?.data?.data || "";
  },


};
