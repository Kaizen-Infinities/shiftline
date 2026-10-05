import { useCallback, useRef } from "react";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import {
  fetchCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  customerDeleted,
} from "../features/customer/customerSlice";
import type { CreateCustomerDto, UpdateCustomerDto } from "../features/customer/types";
import { useSocketSync } from "./useSocketSync";

export const useCustomers = () => {
  const dispatch = useAppDispatch();
  // BUG-CUST-004 fix: expose pagination metadata from state
  const { customers, loading, error, total, page, totalPages } = useAppSelector(
    (state) => state.customers
  );

  // Realtime events carry no record (F04): refetch with the params of the last load.
  const lastParams = useRef<Parameters<typeof fetchCustomers>[0] | null>(null);
  useSocketSync("customer", { deleted: customerDeleted }, () => {
    if (lastParams.current) dispatch(fetchCustomers(lastParams.current));
  });

  // BUG-CUST-004 fix: accept page, limit, and status params for server-side pagination and filtering
  const loadCustomers = useCallback(
    (
      params?:
        | {
            search?: string;
            page?: number;
            limit?: number;
            status?: string;
            customerTypeId?: number;
            customerGradeId?: number;
          }
        | string
    ) => {
      lastParams.current = typeof params === "string" ? { search: params } : (params ?? {});
      if (typeof params === "string") {
        dispatch(fetchCustomers({ search: params }));
      } else {
        dispatch(fetchCustomers(params ?? {}));
      }
    },
    [dispatch]
  );

  const addCustomer = useCallback(
    async (data: CreateCustomerDto) => {
      return await dispatch(createCustomer(data)).unwrap();
    },
    [dispatch]
  );

  const editCustomer = useCallback(
    async (id: string, data: UpdateCustomerDto) => {
      return await dispatch(updateCustomer({ id, data })).unwrap();
    },
    [dispatch]
  );

  const removeCustomer = useCallback(
    async (id: string) => {
      return await dispatch(deleteCustomer(id)).unwrap();
    },
    [dispatch]
  );

  return {
    customers,
    loading,
    error,
    total,
    page,
    totalPages,
    loadCustomers,
    addCustomer,
    editCustomer,
    removeCustomer,
  };
};
