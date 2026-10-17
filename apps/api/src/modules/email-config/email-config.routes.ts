import express, { NextFunction, Request, Response } from "express";
import multer from "multer";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import {
  getEmailConfig,
  saveEmailConfig,
  sendEmailDirect,
  sendEmailWithAttachment,
} from "./email-config.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

/** One attachment in the `file` field. Multer errors become 4xx ApiErrors instead of 500s. */
const uploadAttachment = (req: Request, res: Response, next: NextFunction) =>
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(
        err.code === "LIMIT_FILE_SIZE"
          ? new ApiError(413, "Attachment is larger than 10 MB.")
          : new ApiError(400, "Attach one file in the `file` field.")
      );
    }
    next(err);
  });

const router = express.Router();

router.use(authMiddleware);

router.get("/", requirePermission("email-config.view"), getEmailConfig);
router.post("/", requirePermission("email-config.edit"), saveEmailConfig);
router.post("/send", requirePermission("email-config.edit"), sendEmailDirect);
router.post(
  "/send-with-attachment",
  requirePermission("email-config.edit"),
  uploadAttachment,
  sendEmailWithAttachment
);

export default router;
