import { Request, Response, NextFunction } from "express";
import { VoucherType } from "@prisma/client";
import { vouchersService } from "./vouchers.service";
import { createVoucherSchema, getVouchersQuerySchema } from "./vouchers.types";
import { msmeService } from "../msme/msme.service";
import { logger } from "../../lib/logger";

class VouchersController {
  async getVouchers(req: Request, res: Response, next: NextFunction) {
    try {
      const query = getVouchersQuerySchema.parse(req.query);
      const result = await vouchersService.getVouchers(query);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getVoucherById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const voucher = await vouchersService.getVoucherById(id);
      return res.status(200).json({
        success: true,
        data: voucher,
      });
    } catch (error) {
      next(error);
    }
  }

  async peekNextVoucherNo(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = String(req.query.type || "").toUpperCase();
      const validTypes = Object.values(VoucherType);
      if (!validTypes.includes(raw as VoucherType)) {
        return res.status(400).json({
          success: false,
          message: `Invalid or missing 'type'. Allowed: ${validTypes.join(", ")}`,
        });
      }
      const voucherNo = await vouchersService.peekNextVoucherNo(raw as VoucherType);
      return res.status(200).json({ success: true, data: { voucherNo } });
    } catch (error) {
      next(error);
    }
  }

  async createVoucher(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createVoucherSchema.parse(req.body);
      const createdBy = (req as any).user?.id || (req as any).user?.userId;
      const voucher = await vouchersService.createVoucher(input, createdBy);

      try {
        const { emitToTenant } = await import("../../lib/realtime.js");
        emitToTenant("voucher:created", voucher);
        emitToTenant("payment:created", voucher);
        emitToTenant("accountLedger:updated", { source: "voucher" });
      } catch (e) {}

      // P2-18: a PAYMENT voucher's payees are every debit-side ledger that carries a
      // supplierId — a batch run can pay several people in one voucher — and the MSME clock
      // warning merges across all of them; it rides along on the response, never blocking the
      // payment itself.
      let msmeWarning: unknown = null;
      if (input.type === "PAYMENT") {
        try {
          const payeeSupplierIds: number[] = (
            (voucher as any)?.items?.map((i: any) => i.debitLedger?.supplierId) ?? []
          ).filter((id: unknown): id is number => typeof id === "number");
          msmeWarning = await msmeService.paymentWarning(payeeSupplierIds);
        } catch (err) {
          logger.warn({ err }, "MSME payment warning could not be computed");
        }
      }

      return res.status(201).json({
        success: true,
        message: "Voucher created successfully",
        data: { ...voucher, msmeWarning },
      });
    } catch (error) {
      next(error);
    }
  }
  /** DELETE and POST /:id/cancel both cancel (P1-09): the voucher stays and is reversed. */
  async deleteVoucher(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(req.params.id as string, 10);
      const reason =
        typeof req.body?.reason === "string"
          ? req.body.reason
          : (req.query.reason as string | undefined);
      const actor = {
        userId: (req as any).user?.userId,
        isSuperAdmin: !!(req as any).user?.isSuperAdmin,
      };
      const result = await vouchersService.cancelVoucher(id, reason, actor);

      try {
        const { emitToTenant } = await import("../../lib/realtime.js");
        emitToTenant("voucher:deleted", { id });
        emitToTenant("accountLedger:updated", { source: "voucher" });
      } catch (e) {}

      return res.status(200).json({ success: true, message: "Voucher cancelled", data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const vouchersController = new VouchersController();
