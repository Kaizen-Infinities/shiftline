import { Router } from "express";

import authRoutes from "../modules/auth/auth.routes";
import userRoutes from "../modules/users/user.routes";
import roleRoutes from "../modules/role/role.routes";
import permissionRoutes from "../modules/permissions/permission.routes";
import rolePermissionRoutes from "../modules/role-permissions/role-permission.routes";
import employeeRoutes from "../modules/employee/employee.routes";
import departmentRoutes from "../modules/department/department.routes";
import customerRoutes from "../modules/customer/customer.routes";
import customerTypeRoutes from "../modules/customer-type/customer-type.routes";
import customerGradeRoutes from "../modules/customer-grade/customer-grade.routes";
import supplierRoutes from "../modules/supplier/supplier.routes";
import uomRoutes from "../modules/uom/uom.routes";
import productImageRoutes from "../modules/product-image/product-image.routes";
import productRoutes from "../modules/product/product.routes";
import companyRoutes from "../modules/company/company.routes";
import shiftRoutes from "../modules/shift/shift.routes";
import shiftExecutionRoutes from "../modules/shift-execution/shift-execution.routes";
import storeRoutes from "../modules/store/store.routes";
import rawMaterialRoutes from "../modules/raw-material/raw-material.routes";
import rawMaterialStockRoutes from "../modules/raw-material-stock/raw-material-stock.routes";
import finishedGoodsStockRoutes from "../modules/finished-goods-stock/finished-goods-stock.routes";
import finishedGoodsTransactionRoutes from "../modules/finished-goods-transaction/finished-goods-transaction.routes";
import machineRoutes from "../modules/machine/machine.routes";
import productionOrderRoutes from "../modules/production-order/production-order.routes";
import hourlyProductionRoutes from "../modules/hourly-production/hourly-production.routes";
import rawMaterialTransactionRoutes from "../modules/raw-material-transaction/raw-material-transaction.routes";
import weeklyProgramRoutes from "../modules/weekly-machine-program/weekly-program.routes";
import dailyScheduleRoutes from "../modules/daily-schedule/daily-schedule.routes";
import dailyPlanRoutes from "../modules/daily-production-plan/daily-plan.routes";
import reportsRoutes from "../modules/reports/reports.routes";
import salesOrderRoutes from "../modules/sales-order/sales-order.routes";
import billOfMaterialRoutes from "../modules/bill-of-material/billOfMaterial.routes";
import salesProductRoutes from "../modules/sales-product/salesProduct.routes";
import stockAdjustmentRoutes from "../modules/stock-adjustment/stock-adjustment.routes";
import purchaseOrderRoutes from "../modules/purchase-order/purchase-order.routes";
import supplierMaterialPriceRoutes from "../modules/supplier-material-price/supplier-material-price.routes";
import productionWastageRoutes from "../modules/production-wastage/production-wastage.routes";
import whatsappRoutes from "../modules/whatsappservice/whatsapp.routes";
import invoiceSettingsRoutes from "../modules/invoice-settings/invoice-settings.routes";
import expenseRoutes from "../modules/expense/expense.routes";
import grnInvoiceRoutes from "../modules/grn-invoice/grn-invoice.routes";
import salesInvoiceRoutes from "../modules/sales-invoice/sales-invoice.routes";
import oeeRoutes from "../modules/oee/oee.routes";
import goodsDispatchRoutes from "../modules/goods-dispatch/goods-dispatch.routes";
import inventoryRoutes from "../modules/inventory/inventory.routes";
import machineOperationAssignmentRoutes from "../modules/machine-operation-assignment/machine-operation-assignment.routes";
import productShiftRecordRoutes from "../modules/product-shift-record/product-shift-record.routes";
import productCapacityHistoryRoutes from "../modules/product-capacity-history/product-capacity-history.routes";
import emailConfigRoutes from "../modules/email-config/email-config.routes";
import accountsRoutes from "../modules/accounts/accounts.routes";
import voucherRoutes from "../modules/vouchers/vouchers.routes";
import returnRoutes from "../modules/returns/returns.routes";
import pettyCashRoutes from "../modules/petty-cash/petty-cash.routes";
import advancesRoutes, { currencyRouter } from "../modules/advances/advances.routes";
import jobWorkRoutes from "../modules/job-work/job-work.routes";
import tdsRoutes from "../modules/tds/tds.routes";
import tallyRoutes from "../modules/tally/tally.routes";
import msmeRoutes from "../modules/msme/msme.routes";
import assetRoutes from "../modules/assets/asset.routes";
import fxRoutes from "../modules/currency/fx.routes";
import costingRoutes from "../modules/costing/costing.routes";
import bankingRoutes from "../modules/banking/banking.routes";
import statutoryPayrollRoutes from "../modules/payroll/statutory.routes";
import labourRoutes from "../modules/payroll/labour.routes";
import leaveRoutes from "../modules/leave/leave.routes";
import orderTnaRoutes from "../modules/order-tna/order-tna.routes";
import projectJobsRoutes from "../modules/project-jobs/project-jobs.routes";
import buyerAuditsRoutes from "../modules/buyer-audits/buyer-audits.routes";
import msmeClaimsRoutes from "../modules/msme-claims/msme-claims.routes";
import subsidySchemesRoutes from "../modules/subsidy-schemes/subsidy-schemes.routes";

import processRoutesRoutes, {
  lotsRouter as processLotsRoutes,
} from "../modules/process-routes/process-routes.routes";
import deliveryScheduleRoutes from "../modules/delivery-schedules/delivery-schedules.routes";
import asnRoutes from "../modules/asn/asn.routes";
import exportIncentivesRoutes from "../modules/export-incentives/export-incentives.routes";
import smsRoutes from "../modules/sms/sms.routes";
import paymentsRoutes, {
  paymentWebhookRouter,
  platformBillingRouter,
} from "../modules/payments/payments.routes";
import payrollRoutes from "../modules/payroll/payroll.routes";
import registersRoutes from "../modules/registers/registers.routes";
import finesRoutes from "../modules/fines/fines.routes";
import dashboardRoutes from "../modules/dashboard/dashboard.routes";
import categoryRoutes from "../modules/category/category.routes";
import retentionRoutes from "../modules/retention/retention.routes";
import mobileRoutes from "../modules/mobile/mobile.routes";
import platformBackupsRoutes from "../modules/platform/backups.routes";
import platformTenantsRoutes from "../modules/platform/tenants.routes";
import invitationRoutes from "../modules/users/invitation.routes";
import onboardingRoutes from "../modules/onboarding/onboarding.routes";
import importsRoutes from "../modules/imports/imports.routes";
import notificationsRoutes from "../modules/notifications/notifications.routes";
import entitlementsRoutes from "../modules/entitlements/entitlements.routes";
import platformPlansRoutes from "../modules/platform/plans.routes";
import platformImpersonationRoutes from "../modules/platform/impersonation.routes";
import platformConsoleRoutes from "../modules/platform/console.routes";
import accountExportRoutes from "../modules/account-export/account-export.routes";
import filingsRoutes from "../modules/filings/filings.routes";
import insightsRoutes from "../modules/insights/insights.routes";
import eInvoiceRoutes from "../modules/e-invoice/e-invoice.routes";
import ewayBillRoutes from "../modules/eway-bill/eway-bill.routes";
import transporterRoutes from "../modules/eway-bill/transporter.routes";
import {
  machineGatewayRoutes,
  machineTelemetryRoutes,
} from "../modules/machine-telemetry/machine-telemetry.routes";
import gstReturnsRoutes from "../modules/gst-returns/gst-returns.routes";
import gstRoutes from "../modules/gst/gst.routes";
import documentsRoutes from "../modules/documents/documents.routes";
import auditTrailRoutes from "../modules/audit-trail/audit-trail.routes";
import yearEndRoutes from "../modules/year-end/year-end.routes";

const router = Router();

/**
 * Every API module and the path it is mounted on. Exported so tests can walk the
 * route table (Express 5 no longer exposes mount paths on router layers).
 */
export const API_MOUNTS: { path: string; router: Router }[] = [
  { path: "/auth", router: authRoutes },
  { path: "/users", router: userRoutes },
  { path: "/roles", router: roleRoutes },
  { path: "/permissions", router: permissionRoutes },
  { path: "/role-permissions", router: rolePermissionRoutes },
  { path: "/departments", router: departmentRoutes },
  { path: "/shifts", router: shiftRoutes },
  { path: "/shift-execution", router: shiftExecutionRoutes },
  { path: "/employees", router: employeeRoutes },
  { path: "/customers", router: customerRoutes },
  { path: "/customer-types", router: customerTypeRoutes },
  { path: "/customer-grades", router: customerGradeRoutes },
  { path: "/suppliers", router: supplierRoutes },
  { path: "/purchase-orders", router: purchaseOrderRoutes },
  { path: "/supplier-material-prices", router: supplierMaterialPriceRoutes },
  { path: "/product/uoms", router: uomRoutes },
  { path: "/uom", router: uomRoutes },
  { path: "/product-images", router: productImageRoutes },
  { path: "/products", router: productRoutes },
  { path: "/companies", router: companyRoutes },
  { path: "/stores", router: storeRoutes },
  { path: "/raw-materials", router: rawMaterialRoutes },
  { path: "/raw-material-stocks", router: rawMaterialStockRoutes },
  { path: "/finished-goods-stocks", router: finishedGoodsStockRoutes },
  { path: "/finished-goods-transactions", router: finishedGoodsTransactionRoutes },
  { path: "/machines", router: machineRoutes },
  { path: "/production-orders", router: productionOrderRoutes },
  { path: "/hourly-productions", router: hourlyProductionRoutes },
  { path: "/raw-material-transactions", router: rawMaterialTransactionRoutes },
  { path: "/weekly-machine-programs", router: weeklyProgramRoutes },
  { path: "/daily-schedule", router: dailyScheduleRoutes },
  { path: "/daily-production-plans", router: dailyPlanRoutes },
  { path: "/reports", router: reportsRoutes },
  { path: "/bill-of-materials", router: billOfMaterialRoutes },
  { path: "/sales-products", router: salesProductRoutes },
  { path: "/sales-orders", router: salesOrderRoutes },
  { path: "/stock-adjustments", router: stockAdjustmentRoutes },
  { path: "/production-wastages", router: productionWastageRoutes },
  { path: "/whatsapp", router: whatsappRoutes },
  { path: "/invoice-settings", router: invoiceSettingsRoutes },
  { path: "/expenses", router: expenseRoutes },
  { path: "/grn-invoices", router: grnInvoiceRoutes },
  { path: "/sales-invoices", router: salesInvoiceRoutes },
  { path: "/oee", router: oeeRoutes },
  { path: "/goods-dispatches", router: goodsDispatchRoutes },
  { path: "/delivery-schedules", router: deliveryScheduleRoutes },
  { path: "/asn", router: asnRoutes },
  { path: "/inventory", router: inventoryRoutes },
  { path: "/machine-operation-assignments", router: machineOperationAssignmentRoutes },
  { path: "/product-shift-records", router: productShiftRecordRoutes },
  { path: "/product-capacity-history", router: productCapacityHistoryRoutes },
  { path: "/email-config", router: emailConfigRoutes },
  { path: "/accounts", router: accountsRoutes },
  { path: "/vouchers", router: voucherRoutes },
  { path: "/returns", router: returnRoutes },
  { path: "/petty-cash", router: pettyCashRoutes },
  { path: "/advances", router: advancesRoutes },
  { path: "/currencies", router: currencyRouter },
  { path: "/job-work", router: jobWorkRoutes },
  { path: "/tds", router: tdsRoutes },
  { path: "/tally", router: tallyRoutes },
  // TN-05: mounted before /msme so the payable router never sees these paths.
  { path: "/msme/receivable-claims", router: msmeClaimsRoutes },
  { path: "/msme", router: msmeRoutes },
  { path: "/subsidy-schemes", router: subsidySchemesRoutes },
  { path: "/assets", router: assetRoutes },
  { path: "/fx", router: fxRoutes },
  { path: "/costing", router: costingRoutes },
  { path: "/banking", router: bankingRoutes },
  { path: "/payroll-statutory", router: statutoryPayrollRoutes },
  { path: "/labour", router: labourRoutes },
  { path: "/leave", router: leaveRoutes },
  { path: "/order-tna", router: orderTnaRoutes },
  { path: "/project-jobs", router: projectJobsRoutes },
  { path: "/buyer-audits", router: buyerAuditsRoutes },
  { path: "/process-routes", router: processRoutesRoutes },
  { path: "/process-lots", router: processLotsRoutes },
  { path: "/export-incentives", router: exportIncentivesRoutes },
  // The callback router must be mounted before /payments so a gateway's POST never meets
  // authMiddleware; it is authenticated by the signature on its body instead.
  { path: "/payments/webhook", router: paymentWebhookRouter },
  { path: "/payments", router: paymentsRoutes },
  { path: "/platform/billing", router: platformBillingRouter },
  { path: "/sms", router: smsRoutes },
  { path: "/payroll", router: payrollRoutes },
  { path: "/registers", router: registersRoutes },
  { path: "/fines", router: finesRoutes },
  { path: "/dashboard", router: dashboardRoutes },
  { path: "/categories", router: categoryRoutes },
  { path: "/retention", router: retentionRoutes },
  { path: "/mobile", router: mobileRoutes },
  { path: "/platform/backups", router: platformBackupsRoutes },
  { path: "/platform/tenants", router: platformTenantsRoutes },
  { path: "/invitations", router: invitationRoutes },
  { path: "/onboarding", router: onboardingRoutes },
  { path: "/imports", router: importsRoutes },
  { path: "/notifications", router: notificationsRoutes },
  { path: "/entitlements", router: entitlementsRoutes },
  { path: "/platform/plans", router: platformPlansRoutes },
  { path: "/platform/impersonations", router: platformImpersonationRoutes },
  { path: "/platform", router: platformConsoleRoutes },
  { path: "/account-export", router: accountExportRoutes },
  { path: "/filings", router: filingsRoutes },
  { path: "/v1/insights", router: insightsRoutes },
  { path: "/e-invoice", router: eInvoiceRoutes },
  { path: "/eway-bills", router: ewayBillRoutes },
  { path: "/machine-gateways", router: machineGatewayRoutes },
  { path: "/machine-telemetry", router: machineTelemetryRoutes },
  { path: "/transporters", router: transporterRoutes },
  { path: "/gst-returns", router: gstReturnsRoutes },
  { path: "/gst", router: gstRoutes },
  { path: "/documents", router: documentsRoutes },
  { path: "/audit-trail", router: auditTrailRoutes },
  { path: "/year-end", router: yearEndRoutes },
];

for (const { path, router: moduleRouter } of API_MOUNTS) {
  router.use(path, moduleRouter);
}

router.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shiftline API",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

export default router;
