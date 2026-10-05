import { useCallback, useRef } from "react";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import {
  fetchEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  employeeDeleted,
} from "../features/employee/employeeSlice";
import type { CreateEmployeeDto, UpdateEmployeeDto } from "../features/employee/types";
import { useSocketSync } from "./useSocketSync";

export const useEmployees = () => {
  const dispatch = useAppDispatch();
  const { employees, loading, error, total, page, totalPages } = useAppSelector(
    (state) => state.employees
  );

  // Realtime events carry no record (F04): refetch with the params of the last load.
  const lastParams = useRef<{ params: Parameters<typeof fetchEmployees>[0] } | null>(null);
  useSocketSync("employee", { deleted: employeeDeleted }, () => {
    if (lastParams.current) dispatch(fetchEmployees(lastParams.current.params));
  });

  const loadEmployees = useCallback(
    (params?: {
      search?: string;
      departmentId?: string | number;
      roleId?: string | number;
      status?: string;
      page?: number;
      limit?: number;
    }) => {
      lastParams.current = { params };
      dispatch(fetchEmployees(params));
    },
    [dispatch]
  );

  const addEmployee = useCallback(
    async (data: CreateEmployeeDto) => {
      return await dispatch(createEmployee(data)).unwrap();
    },
    [dispatch]
  );

  const editEmployee = useCallback(
    async (id: string, data: UpdateEmployeeDto) => {
      return await dispatch(updateEmployee({ id, data })).unwrap();
    },
    [dispatch]
  );

  const removeEmployee = useCallback(
    async (id: string) => {
      return await dispatch(deleteEmployee(id)).unwrap();
    },
    [dispatch]
  );

  return {
    employees,
    loading,
    error,
    total,
    page,
    totalPages,
    loadEmployees,
    addEmployee,
    editEmployee,
    removeEmployee,
  };
};
