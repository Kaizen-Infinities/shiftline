import { Router } from "express";
import { vouchersController } from "./vouchers.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/", requirePermission("vouchers.view"), (req, res, next) => vouchersController.getVouchers(req, res, next));
router.get("/next-no", requirePermission("vouchers.view"), (req, res, next) => vouchersController.peekNextVoucherNo(req, res, next));
router.post("/", requirePermission("vouchers.create"), (req, res, next) => vouchersController.createVoucher(req, res, next));
router.get("/:id", requirePermission("vouchers.view"), (req, res, next) => vouchersController.getVoucherById(req, res, next));
router.delete("/:id", requirePermission("vouchers.delete"), (req, res, next) => vouchersController.deleteVoucher(req, res, next));

export default router;
