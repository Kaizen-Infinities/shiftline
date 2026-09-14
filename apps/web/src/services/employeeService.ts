import apiClient from "../api/apiClient";
import config from "../api/config";
import type { Employee, CreateEmployeeDto, UpdateEmployeeDto } from "../features/employee/types";

/** A search result row (P2-15) — the light shape `GET /employees/search` returns, behind
 *  "employees.search" rather than "employees.view", for a picker that does not need every
 *  field a full employee record carries. */
export interface EmployeeSearchRow {
  id: string;
  empCode: string;
  fullName: string;
  department: string | null;
  businessPlace: { id: string; name: string } | null;
}

export const employeeService = {
  fetchAll: async (params?: {
    search?: string;
    departmentId?: string | number;
    roleId?: string | number;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<any> => {
    const response = await apiClient.get(config.employee.base, { params });
    return response.data?.data || response.data;
  },

  fetchById: async (id: string): Promise<Employee> => {
    const response = await apiClient.get(`${config.employee.base}/${id}`);
    return response.data?.data || response.data;
  },

  create: async (data: CreateEmployeeDto | FormData): Promise<any> => {
    const isForm = data instanceof FormData;
    const response = await apiClient.post(config.employee.base, data, {
      headers: isForm ? { "Content-Type": "multipart/form-data" } : {},
    });
    return response.data?.data || response.data;
  },

  update: async (id: string, data: UpdateEmployeeDto | FormData): Promise<any> => {
    const isForm = data instanceof FormData;
    const response = await apiClient.put(`${config.employee.base}/${id}`, data, {
      headers: isForm ? { "Content-Type": "multipart/form-data" } : {},
    });
    return response.data?.data || response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`${config.employee.base}/${id}`);
  },

  fetchNextCode: async (): Promise<string> => {
    const response = await apiClient.get(config.employee.nextCode);
    return response.data?.data?.nextCode || "";
  },

  search: async (q: string): Promise<EmployeeSearchRow[]> => {
    if (!q.trim()) return [];
    const response = await apiClient.get(config.employee.search, { params: { q } });
    return response.data?.data || [];
  },
};
