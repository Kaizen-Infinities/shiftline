import { Router } from "express";
import { whatsappController } from "./whatsapp.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();

// Meta webhook endpoints are public by design (verified by Meta's token).
router.get("/webhook", whatsappController.verifyWebhook);
router.post("/webhook", whatsappController.handleWebhookEvent);

router.use(authMiddleware);

// GET /config (Fetch WhatsApp configuration)
router.get("/config", requirePermission("whatsapp.view"), whatsappController.getConfig);

// POST /config (Save/update WhatsApp configuration)
router.post("/config", requirePermission("whatsapp.edit"), whatsappController.saveConfig);

// POST /send (Send a WhatsApp message)
router.post("/send", requirePermission("whatsapp.edit"), whatsappController.sendMessage);

export default router;
