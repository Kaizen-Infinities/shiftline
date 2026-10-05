import { useCallback, useRef } from "react";
import { useAppDispatch, useAppSelector } from "./reduxHooks";
import {
  fetchProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  productDeleted,
} from "../features/product/productSlice";
import type { CreateProductDto, UpdateProductDto } from "../features/product/types";
import { useSocketSync } from "./useSocketSync";

export const useProducts = () => {
  const dispatch = useAppDispatch();
  const { products, loading, error } = useAppSelector((state) => state.products);

  // Realtime events carry no record (F04): refetch with the args of the last load.
  const lastArgs = useRef<{
    args: string | { search?: string; categoryId?: string } | undefined;
  } | null>(null);
  useSocketSync("product", { deleted: productDeleted }, () => {
    if (lastArgs.current) dispatch(fetchProducts(lastArgs.current.args));
  });

  const loadProducts = useCallback(
    (args?: string | { search?: string; categoryId?: string }) => {
      lastArgs.current = { args };
      dispatch(fetchProducts(args));
    },
    [dispatch]
  );

  const addProduct = useCallback(
    async (data: CreateProductDto) => {
      return await dispatch(createProduct(data)).unwrap();
    },
    [dispatch]
  );

  const editProduct = useCallback(
    async (id: string, data: UpdateProductDto) => {
      return await dispatch(updateProduct({ id, data })).unwrap();
    },
    [dispatch]
  );

  const removeProduct = useCallback(
    async (id: string) => {
      return await dispatch(deleteProduct(id)).unwrap();
    },
    [dispatch]
  );

  return {
    products,
    loading,
    error,
    loadProducts,
    addProduct,
    editProduct,
    removeProduct,
  };
};
