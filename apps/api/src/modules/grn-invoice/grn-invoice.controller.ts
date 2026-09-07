import { requireTenantId } from "../../lib/tenant-context";
import { Request, Response } from "express";
import grnInvoiceService from "./grn-invoice.service";
import { prisma } from "../../config/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import { emitToTenant } from "../../lib/realtime";

import { voucherPostingService } from "../accounts/voucherPosting.service";
import { logger } from "../../lib/logger";

class GrnInvoiceController {
  create = asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;

    if (!userId) {
      throw new ApiError(401, "Unauthorized: missing user context");
    }

    const company = await prisma.company.findFirst({ where: { id: requireTenantId() } });
    if (!company) {
      throw new ApiError(500, "Internal Server Error: No company found in the system");
    }

    const grnInvoice = await grnInvoiceService.createGrnInvoice(
      req.body,
      {
        userId,
        companyId: company.id,
      },
      req.file
    );

    // Auto-post purchase and payment vouchers immediately on creation
    try {
      await voucherPostingService.postPurchaseVoucher(grnInvoice.id);
    } catch (err) {
      logger.error({ err: err }, "[GRN Controller] Voucher posting failed:");
    }

    emitToTenant("grnInvoice:created", grnInvoice);
    try {
      emitToTenant("voucher:created", { source: "grnInvoice" });
      emitToTenant("payment:created", { source: "grnInvoice" });
      emitToTenant("accountLedger:updated", { source: "grnInvoice" });
    } catch (e) {}

    return res.status(201).json(new ApiResponse("GRN / Invoice created successfully", grnInvoice));
  });

  findAll = asyncHandler(async (req: Request, res: Response) => {
    const { page, pageSize, search, supplierId, storeId } = req.query;

    const result = await grnInvoiceService.getAllGrnInvoices({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search: search as string,
      supplierId: supplierId ? Number(supplierId) : undefined,
      storeId: storeId as string,
    });

    return res.status(200).json(new ApiResponse("GRN / Invoices fetched successfully", result));
  });

  findOne = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const grnInvoice = await grnInvoiceService.getGrnInvoiceById(id);

    return res.status(200).json(new ApiResponse("GRN / Invoice fetched successfully", grnInvoice));
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    const grnInvoice = await grnInvoiceService.updateGrnInvoice(id, req.body, req.file);

    // Auto-post purchase and payment vouchers immediately on update
    try {
      await voucherPostingService.postPurchaseVoucher(grnInvoice.id);
    } catch (err) {
      logger.error({ err: err }, "[GRN Controller] Voucher posting failed:");
    }

    emitToTenant("grnInvoice:updated", grnInvoice);
    try {
      emitToTenant("voucher:updated", { source: "grnInvoice" });
      emitToTenant("payment:updated", { source: "grnInvoice" });
      emitToTenant("accountLedger:updated", { source: "grnInvoice" });
    } catch (e) {}

    return res.status(200).json(new ApiResponse("GRN / Invoice updated successfully", grnInvoice));
  });

  getNextCode = asyncHandler(async (req: Request, res: Response) => {
    const nextCode = await grnInvoiceService.getNextGrnNumber();

    return res.status(200).json(new ApiResponse("Next GRN number fetched successfully", nextCode));
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    await grnInvoiceService.deleteGrnInvoice(id);

    emitToTenant("grnInvoice:deleted", { id });

    return res.status(200).json(new ApiResponse("GRN / Invoice deleted successfully"));
  });
}

export default new GrnInvoiceController();
