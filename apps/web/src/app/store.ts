import { combineReducers, configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { sessionListener, sessionReset } from "./sessionReset";
import authReducer from "../features/auth/authSlice";
import { baseApi } from "../services/baseApi";
import roleReducer from "../features/roles/roleSlice";
import departmentReducer from "../features/departments/departmentSlice";
import uomReducer from "../features/uoms/uomSlice";
import userReducer from "../features/user/userSlice";
import employeeReducer from "../features/employee/employeeSlice";
import customerReducer from "../features/customer/customerSlice";
import productReducer from "../features/product/productSlice";
import permissionReducer from "../features/permissions/permissionSlice";
import supplierReducer from "../features/supplier/supplierSlice";
import shiftReducer from "../features/shifts/shiftSlice";
import storeReducer from "../features/stores/storeSlice";
import rawMaterialReducer from "../features/raw-materials/rawMaterialSlice";
import rawMaterialStockReducer from "../features/raw-materials/rawMaterialStockSlice";
import machineReducer from "../features/machines/machineSlice";
import weeklyProgramReducer from "../features/weekly-programs/weeklyProgramSlice";
import productionOrderReducer from "../features/production-orders/productionOrderSlice";
import hourlyProductionReducer from "../features/hourly-productions/hourlyProductionSlice";
import profileReducer from "../features/profiles/profileSlice";
import stockAdjustmentReducer from "../features/stock-adjustments/stockAdjustmentSlice";
import purchaseOrderReducer from "../features/purchaseOrder/purchaseOrderSlice";
import productionWastageReducer from "../features/production-wastage/productionWastageSlice";
import companyReducer from "../features/company/companySlice";
import finishedGoodsStockReducer from "../features/finished-goods-stock/finishedGoodsStockSlice";
import dailyPlanReducer from "../features/daily-plans/dailyPlanSlice";
import goodsDispatchReducer from "../features/goods-dispatch/goodsDispatchSlice";
import productShiftRecordReducer from "../features/product-shift-records/productShiftRecordSlice";
import productCapacityHistoryReducer from "../features/product-capacity-history/productCapacityHistorySlice";
import payrollSettingsReducer from "../features/payroll/payrollSettingsSlice";
import payrollRunReducer from "../features/payroll/payrollRunSlice";
import categoryReducer from "../features/categories/categorySlice";
import eodStockReducer from "../features/eod-stock/eodStockSlice";

const appReducer = combineReducers({
  auth: authReducer,
  roles: roleReducer,
  departments: departmentReducer,
  uoms: uomReducer,
  users: userReducer,
  employees: employeeReducer,
  customers: customerReducer,
  products: productReducer,
  permissions: permissionReducer,
  suppliers: supplierReducer,
  shifts: shiftReducer,
  profile: profileReducer,
  stores: storeReducer,
  rawMaterials: rawMaterialReducer,
  rawMaterialStocks: rawMaterialStockReducer,
  machines: machineReducer,
  weeklyPrograms: weeklyProgramReducer,
  productionOrders: productionOrderReducer,
  hourlyProductions: hourlyProductionReducer,
  stockAdjustments: stockAdjustmentReducer,
  [baseApi.reducerPath]: baseApi.reducer,
  purchaseOrder: purchaseOrderReducer,
  productionWastages: productionWastageReducer,
  company: companyReducer,
  finishedGoodsStocks: finishedGoodsStockReducer,
  dailyPlans: dailyPlanReducer,
  goodsDispatch: goodsDispatchReducer,
  productShiftRecords: productShiftRecordReducer,
  productCapacityHistory: productCapacityHistoryReducer,
  payrollSettings: payrollSettingsReducer,
  payrollRun: payrollRunReducer,
  categories: categoryReducer,
  eodStock: eodStockReducer,
});

/**
 * On `session/reset` every slice but `auth` goes back to its initial state, so data loaded
 * for one identity is never shown under another (see app/sessionReset.ts).
 */
const rootReducer = (state: ReturnType<typeof appReducer> | undefined, action: UnknownAction) =>
  appReducer(
    state && sessionReset.match(action)
      ? ({ auth: state.auth } as ReturnType<typeof appReducer>)
      : state,
    action
  );

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().prepend(sessionListener.middleware).concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
