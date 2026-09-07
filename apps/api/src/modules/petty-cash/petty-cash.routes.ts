import { Router } from "express";
import { pettyCashController } from "./petty-cash.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/", requirePermission("petty-cash.view"), (req, res, next) =>
  pettyCashController.getEntries(req, res, next)
);
router.post("/", requirePermission("petty-cash.create"), (req, res, next) =>
  pettyCashController.createEntry(req, res, next)
);

export default router;
