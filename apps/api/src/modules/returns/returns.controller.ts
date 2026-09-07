import { getCurrentCompanyId } from "../../utils/companyContext";
import { Request, Response, NextFunction } from "express";
import { returnsService } from "./returns.service";
import { createSalesReturnSchema, createPurchaseReturnSchema } from "./returns.types";
import { logger } from "../../lib/logger";

const actorOf = (req: Request) => ({
  userId: (req as any).user?.userId as string | undefined,
  isSuperAdmin: Boolean((req as any).user?.isSuperAdmin),
});
const reasonOf = (req: Request) =>
  typeof req.body?.reason === "string" ? req.body.reason : (req.query.reason as string | undefined);

class ReturnsController {
  async cancelSalesReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const data = await returnsService.cancelSalesReturn(id, actorOf(req), reasonOf(req));
      return res.status(200).json({ success: true, message: "Sales return cancelled", data });
    } catch (error) {
      next(error);
    }
  }

  async cancelPurchaseReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const data = await returnsService.cancelPurchaseReturn(id, actorOf(req), reasonOf(req));
      return res.status(200).json({ success: true, message: "Purchase return cancelled", data });
    } catch (error) {
      next(error);
    }
  }

  async getSalesReturns(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await getCurrentCompanyId();
      const data = await returnsService.getSalesReturns(companyId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createSalesReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createSalesReturnSchema.parse(req.body);
      const createdBy = (req as any).user?.id || (req as any).user?.userId;
      const data = await returnsService.createSalesReturn(input, createdBy);

      try {
        const { emitToTenant } = await import("../../lib/realtime.js");
        emitToTenant("salesReturn:created", data);
        emitToTenant("voucher:created", { source: "salesReturn" });
        emitToTenant("payment:created", { source: "salesReturn" });
        emitToTenant("accountLedger:updated", { source: "salesReturn" });
      } catch (sErr) {
        logger.error({ err: sErr }, "[Socket Emit Error] salesReturn:created");
      }

      return res.status(201).json({ success: true, message: "Sales return created", data });
    } catch (error) {
      next(error);
    }
  }

  async getSalesReturnById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const data = await returnsService.getSalesReturnById(id);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async updateSalesReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const input = createSalesReturnSchema.parse(req.body);
      const updatedBy = (req as any).user?.id || (req as any).user?.userId;
      const data = await returnsService.updateSalesReturn(id, input, updatedBy);

      try {
        const { emitToTenant } = await import("../../lib/realtime.js");
        emitToTenant("salesReturn:updated", data);
        emitToTenant("voucher:created", { source: "salesReturn" });
        emitToTenant("payment:created", { source: "salesReturn" });
        emitToTenant("accountLedger:updated", { source: "salesReturn" });
      } catch (sErr) {
        logger.error({ err: sErr }, "[Socket Emit Error] salesReturn:updated");
      }

      return res.status(200).json({ success: true, message: "Sales return updated", data });
    } catch (error) {
      next(error);
    }
  }

  async getPurchaseReturns(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await getCurrentCompanyId();
      const data = await returnsService.getPurchaseReturns(companyId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createPurchaseReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createPurchaseReturnSchema.parse(req.body);
      const createdBy = (req as any).user?.id || (req as any).user?.userId;
      const data = await returnsService.createPurchaseReturn(input, createdBy);

      try {
        const { emitToTenant } = await import("../../lib/realtime.js");
        emitToTenant("purchaseReturn:created", data);
        emitToTenant("rawMaterial:updated", { source: "purchaseReturn" });
        emitToTenant("voucher:created", { source: "purchaseReturn" });
        emitToTenant("payment:created", { source: "purchaseReturn" });
        emitToTenant("accountLedger:updated", { source: "purchaseReturn" });
      } catch (sErr) {
        logger.error({ err: sErr }, "[Socket Emit Error] purchaseReturn:created");
      }

      return res.status(201).json({ success: true, message: "Purchase return created", data });
    } catch (error) {
      next(error);
    }
  }
}

export const returnsController = new ReturnsController();
