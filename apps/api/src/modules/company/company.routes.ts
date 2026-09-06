import { Router } from "express";
import companyController from "./company.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { uploadProductImage } from "../../middleware/upload.middleware";

const router = Router();

// Branding for the login screen (public): name, logo, favicon only.
router.get("/public", companyController.getPublicCompany);

// Protect all routes below
router.use(authMiddleware);

// Full company details
router.get("/", companyController.getCompany);

// Update company details
router.put("/:id", requirePermission("company-settings.edit"), uploadProductImage.fields([{ name: "logo", maxCount: 1 }, { name: "favicon", maxCount: 1 }]), companyController.updateCompany);

export default router;
