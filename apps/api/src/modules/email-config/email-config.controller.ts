import { encryptText } from "../../utils/crypto";
import { Request, Response } from "express";

import { ApiError } from "../../utils/ApiError";
import { prisma } from "../../config/prisma";
import { sendEmail } from "../../utils/mailer";
import { logger } from "../../lib/logger";

export const getEmailConfig = async (req: Request, res: Response) => {
  try {
    const config = await prisma.emailConfig.findFirst();

    res.status(200).json({
      success: true,
      data: config ? { ...config, smtpPassword: config.smtpPassword ? "********" : null } : null,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
    } else {
      logger.error({ err: error }, "Error in getEmailConfig:");
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

export const saveEmailConfig = async (req: Request, res: Response) => {
  try {
    const { smtpHost, smtpPort, smtpUsername, fromEmail, fromName, encryption } = req.body;
    const existing = await prisma.emailConfig.findFirst();
    const rawPassword = req.body.smtpPassword as string | undefined;
    const smtpPassword =
      rawPassword && rawPassword !== "********" ? encryptText(rawPassword) : existing?.smtpPassword;

    if (!smtpHost || !smtpPort || !smtpUsername || !smtpPassword || !fromEmail || !fromName) {
      throw new ApiError(400, "All SMTP fields are required");
    }

    let config = await prisma.emailConfig.findFirst();

    if (config) {
      config = await prisma.emailConfig.update({
        where: { id: config.id },
        data: {
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpUsername,
          smtpPassword,
          fromEmail,
          fromName,
          encryption: encryption || "TLS",
        },
      });
    } else {
      config = await prisma.emailConfig.create({
        data: {
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpUsername,
          smtpPassword,
          fromEmail,
          fromName,
          encryption: encryption || "TLS",
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Email configuration saved successfully",
      data: config,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
    } else {
      logger.error({ err: error }, "Error in saveEmailConfig:");
      res.status(500).json({ success: false, message: "Internal server error" });
    }
  }
};

export const sendEmailDirect = async (req: Request, res: Response) => {
  try {
    const { recipientEmail, subject, message } = req.body;

    if (!recipientEmail || !subject || !message) {
      throw new ApiError(400, "Recipient email, subject, and message are required.");
    }

    const info = await sendEmail({
      to: recipientEmail,
      subject: subject,
      text: message,
    });

    res.status(200).json({
      success: true,
      message: "Email sent successfully",
      data: info,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Error in sendEmailDirect:");
    res.status(500).json({
      success: false,
      message: error.message || "Failed to send email. Please check your configuration.",
    });
  }
};

export const sendEmailWithAttachment = async (req: Request, res: Response) => {
  try {
    const { recipientEmail, subject, message } = req.body;
    const file = req.file;

    if (!recipientEmail || !subject || !message) {
      throw new ApiError(400, "Recipient email, subject, and message are required.");
    }

    if (!file) {
      throw new ApiError(400, "Attachment file is required.");
    }

    const attachments = [
      {
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      },
    ];

    const info = await sendEmail({
      to: recipientEmail,
      subject: subject,
      text: message,
      attachments,
    });

    res.status(200).json({
      success: true,
      message: "Email with attachment sent successfully",
      data: info,
    });
  } catch (error: any) {
    logger.error({ err: error }, "Error in sendEmailWithAttachment:");
    res.status(500).json({
      success: false,
      message: error.message || "Failed to send email. Please check your configuration.",
    });
  }
};
