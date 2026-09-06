import { Router } from "express";
import { returnsController } from "./returns.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/sales", requirePermission("sales-returns.view"), (req, res, next) => returnsController.getSalesReturns(req, res, next));
router.post("/sales", requirePermission("sales-returns.create"), (req, res, next) => returnsController.createSalesReturn(req, res, next));
router.get("/sales/:id", requirePermission("sales-returns.view"), (req, res, next) => returnsController.getSalesReturnById(req, res, next));
router.put("/sales/:id", requirePermission("sales-returns.edit"), (req, res, next) => returnsController.updateSalesReturn(req, res, next));
router.get("/purchase", requirePermission("purchase-returns.view"), (req, res, next) => returnsController.getPurchaseReturns(req, res, next));
router.post("/purchase", requirePermission("purchase-returns.create"), (req, res, next) => returnsController.createPurchaseReturn(req, res, next));

export default router;
