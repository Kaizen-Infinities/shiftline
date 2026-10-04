import { decryptText } from "./crypto";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { prisma } from "../config/prisma";
import { logger } from "../lib/logger";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: SendMailOptions["attachments"];
}

export interface SmtpTransportInput {
  host: string;
  port: number;
  user: string;
  pass: string;
  encryption?: string;
}

/**
 * Transport options for the configured SMTP server. Port 465 (or encryption "SSL") is implicit
 * TLS; every other port, 587 included, starts plain and upgrades with STARTTLS. Certificates are
 * validated (nodemailer's default); there is no opt-out flag.
 */
export const buildSmtpTransportOptions = (input: SmtpTransportInput): SMTPTransport.Options => ({
  host: input.host,
  port: input.port,
  secure: input.port === 465 || input.encryption?.toUpperCase() === "SSL",
  auth: { user: input.user, pass: input.pass },
  connectionTimeout: 10000,
  socketTimeout: 10000,
});

export const sendEmail = async (options: SendEmailOptions) => {
  let smtpHost = process.env.SMTP_HOST || "";
  let smtpPort = Number(process.env.SMTP_PORT) || 587;
  let smtpUser = process.env.SMTP_USER || "";
  let smtpPass = process.env.SMTP_PASS || "";
  let fromEmail = process.env.SMTP_FROM || "";
  let fromName = process.env.FROM_NAME || "Shiftline";
  let encryption = process.env.SMTP_ENCRYPTION || "TLS";

  try {
    const config = await prisma.emailConfig.findFirst();

    if (config) {
      smtpHost = config.smtpHost || smtpHost;
      smtpPort = config.smtpPort || smtpPort;
      smtpUser = config.smtpUsername || smtpUser;
      smtpPass = config.smtpPassword ? decryptText(config.smtpPassword) : smtpPass;
      fromEmail = config.fromEmail || fromEmail;
      fromName = config.fromName || fromName;
      encryption = config.encryption || encryption;
    }

    if (!smtpHost || !smtpUser || !smtpPass) {
      throw new Error("SMTP configuration is incomplete. Please check database or .env file.");
    }

    const transporter = nodemailer.createTransport(
      buildSmtpTransportOptions({
        host: smtpHost,
        port: smtpPort,
        user: smtpUser,
        pass: smtpPass,
        encryption,
      })
    );

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });

    return info;
  } catch (error) {
    logger.error({ err: error }, "Error sending email:");
    throw error;
  }
};
