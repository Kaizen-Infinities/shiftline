import { encryptText } from "../../utils/crypto";
import { Request, Response } from "express";

import { ApiError } from "../../utils/ApiError";
import { prisma } from "../../config/prisma";
import { type SendEmailOptions, sendEmail } from "../../utils/mailer";
import { logger } from "../../lib/logger";

const SEND_FAILED_MESSAGE = "Could not send the email. Check the email settings and try again.";

/** The stored SMTP password never leaves the server; clients see a fixed mask instead. */
const maskEmailConfig = <T extends { smtpPassword: string | null }>(config: T) => ({
  ...config,
  smtpPassword: config.smtpPassword ? "********" : null,
});

/**
 * Sends through the configured SMTP server. The transport error (which may name the server or
 * user) is logged in full; the client gets a fixed 502 message.
 */
const deliver = async (context: string, options: SendEmailOptions) => {
  try {
    return await sendEmail(options);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error({ err: error }, `Error in ${context}:`);
    throw new ApiError(502, SEND_FAILED_MESSAGE);
  }
};

export const getEmailConfig = async (req: Request, res: Response) => {
  const config = await prisma.emailConfig.findFirst();

  res.status(200).json({
    success: true,
    data: config ? maskEmailConfig(config) : null,
  });
};

export const saveEmailConfig = async (req: Request, res: Response) => {
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
    data: maskEmailConfig(config),
  });
};

export const sendEmailDirect = async (req: Request, res: Response) => {
  const { recipientEmail, subject, message } = req.body;

  if (!recipientEmail || !subject || !message) {
    throw new ApiError(400, "Recipient email, subject, and message are required.");
  }

  const info = await deliver("sendEmailDirect", {
    to: recipientEmail,
    subject: subject,
    text: message,
  });

  res.status(200).json({
    success: true,
    message: "Email sent successfully",
    data: info,
  });
};

export const sendEmailWithAttachment = async (req: Request, res: Response) => {
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

  const info = await deliver("sendEmailWithAttachment", {
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
};
