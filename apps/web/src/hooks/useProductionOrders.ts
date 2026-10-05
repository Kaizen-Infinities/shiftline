import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import {
  fetchProductionOrders,
  createProductionOrder,
  updateProductionOrder,
  deleteProductionOrder,
  productionOrderDeleted,
} from "../features/production-orders/productionOrderSlice";
import { useSocketSync } from "./useSocketSync";

export const useProductionOrders = () => {
  const dispatch = useAppDispatch();
  const { data, loading, error } = useAppSelector(
    (state) => state.productionOrders || { data: [], loading: false, error: null }
  );

  // Realtime events carry no record (F04): refetch.
  useSocketSync("productionOrder", { deleted: productionOrderDeleted }, () => {
    dispatch(fetchProductionOrders());
  });

  const loadProductionOrders = useCallback(() => {
    dispatch(fetchProductionOrders());
  }, [dispatch]);

  const addProductionOrder = useCallback(
    async (orderData: any) => {
      return await dispatch(createProductionOrder(orderData)).unwrap();
    },
    [dispatch]
  );

  const editProductionOrder = useCallback(
    async (id: number, orderData: any) => {
      return await dispatch(updateProductionOrder({ id, data: orderData })).unwrap();
    },
    [dispatch]
  );

  const removeProductionOrder = useCallback(
    async (id: number) => {
      return await dispatch(deleteProductionOrder(id)).unwrap();
    },
    [dispatch]
  );

  return {
    productionOrders: data,
    loading,
    error,
    loadProductionOrders,
    addProductionOrder,
    editProductionOrder,
    removeProductionOrder,
  };
};
