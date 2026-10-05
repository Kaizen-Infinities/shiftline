import { useCallback, useRef } from "react";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import {
  fetchSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  supplierDeleted,
} from "../features/supplier/supplierSlice";
import type { CreateSupplierDto, UpdateSupplierDto } from "../features/supplier/types";
import { useSocketSync } from "./useSocketSync";

export const useSuppliers = () => {
  const dispatch = useAppDispatch();
  const { suppliers, loading, error, total, page, totalPages } = useAppSelector(
    (state) => state.suppliers
  );

  // We are removing useSocketSync from here to avoid conflicts, and will use it in SupplierList.tsx for refetching
  // Wait, I will keep useSocketSync here for Redux appending, as we decided to match CustomerList exactly.
  // Actually, CustomerList had useSocketSync here, and then I added it to CustomerListPage.
  // To strictly match CustomerList:
  // Realtime events carry no record (F04): refetch with the params of the last load.
  const lastParams = useRef<Parameters<typeof fetchSuppliers>[0] | null>(null);
  useSocketSync("supplier", { deleted: supplierDeleted }, () => {
    if (lastParams.current) dispatch(fetchSuppliers(lastParams.current));
  });

  const loadSuppliers = useCallback(
    (params?: { search?: string; page?: number; limit?: number } | string) => {
      lastParams.current = typeof params === "string" ? { search: params } : (params ?? {});
      if (typeof params === "string") {
        dispatch(fetchSuppliers({ search: params }));
      } else {
        dispatch(fetchSuppliers(params ?? {}));
      }
    },
    [dispatch]
  );

  const addSupplier = useCallback(
    async (data: CreateSupplierDto) => {
      return await dispatch(createSupplier(data)).unwrap();
    },
    [dispatch]
  );

  const editSupplier = useCallback(
    async (id: string, data: UpdateSupplierDto) => {
      return await dispatch(updateSupplier({ id, data })).unwrap();
    },
    [dispatch]
  );

  const removeSupplier = useCallback(
    async (id: string) => {
      return await dispatch(deleteSupplier(id)).unwrap();
    },
    [dispatch]
  );

  return {
    suppliers,
    loading,
    error,
    total,
    page,
    totalPages,
    loadSuppliers,
    addSupplier,
    editSupplier,
    removeSupplier,
  };
};
