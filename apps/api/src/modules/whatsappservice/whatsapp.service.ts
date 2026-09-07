import { requireTenantId } from "../../lib/tenant-context";
import { prisma } from "../../config/prisma";
import axios from "axios";
import { encryptText, decryptText } from "../../utils/crypto";
import { logger } from "../../lib/logger";

export class WhatsappService {
  /** Encrypts a stored credential (AES-256-GCM, DATA_ENCRYPTION_KEY). */
  public static encryptText(text: string): string {
    return encryptText(text);
  }

  /** Decrypts a stored credential; legacy plaintext values pass through. */
  public static decryptText(payload: string): string {
    return decryptText(payload);
  }

  /**
   * Sends a WhatsApp text message using the Meta Graph API.
   * @param to Phone number to send the message to (with country code, no '+')
   * @param message Text message content
   */
  static async sendTextMessage(to: string, message: string): Promise<any> {
    const company = await prisma.company.findFirst({ where: { id: requireTenantId() } });
    if (!company) {
      throw new Error("No company found.");
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { companyId: company.id },
    });

    if (!config || !config.accessToken || !config.phoneNumberId) {
      throw new Error("WhatsApp configuration is missing or incomplete.");
    }

    const accessToken = this.decryptText(config.accessToken);

    const url = `https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`;

    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: {
        preview_url: false,
        body: message,
      },
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error: any) {
      logger.error(
        { err: error?.response?.data || error.message },
        "Error sending WhatsApp message:"
      );
      throw new Error(
        `Failed to send WhatsApp message: ${error?.response?.data?.error?.message || error.message}`
      );
    }
  }

  /**
   * Sends a WhatsApp Template message using the Meta Graph API.
   * This is required to send a message directly without the user sending 'Hi' first.
   */
  static async sendTemplateMessage(
    to: string,
    templateName: string = "hello_world",
    languageCode: string = "en_US"
  ): Promise<any> {
    const company = await prisma.company.findFirst({ where: { id: requireTenantId() } });
    if (!company) {
      throw new Error("No company found.");
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { companyId: company.id },
    });

    if (!config || !config.accessToken || !config.phoneNumberId) {
      throw new Error("WhatsApp configuration is missing or incomplete.");
    }

    const accessToken = this.decryptText(config.accessToken);

    const url = `https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`;

    const data = {
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
      },
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error: any) {
      logger.error(
        { err: error?.response?.data || error.message },
        "Error sending WhatsApp Template message:"
      );
      throw new Error(
        `Failed to send WhatsApp Template message: ${
          error?.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Uploads media (e.g., PDF) to the Meta Graph API and returns the media ID.
   * @param fileBuffer The file content buffer
   * @param filename The name of the file (e.g., Quotation.pdf)
   * @param mimetype The MIME type of the file (e.g., application/pdf)
   */
  static async uploadMedia(
    fileBuffer: Buffer,
    filename: string,
    mimetype: string
  ): Promise<string> {
    const company = await prisma.company.findFirst({ where: { id: requireTenantId() } });
    if (!company) {
      throw new Error("No company found.");
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { companyId: company.id },
    });

    if (!config || !config.accessToken || !config.phoneNumberId) {
      throw new Error("WhatsApp configuration is missing or incomplete.");
    }

    const accessToken = this.decryptText(config.accessToken);

    const url = `https://graph.facebook.com/v20.0/${config.phoneNumberId}/media`;

    const FormData = require("form-data");
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", fileBuffer, {
      filename: filename,
      contentType: mimetype,
    });

    try {
      const response = await axios.post(url, form, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...form.getHeaders(),
        },
      });
      return response.data.id;
    } catch (error: any) {
      logger.error(
        { err: error?.response?.data || error.message },
        "Error uploading media to WhatsApp:"
      );
      throw new Error(
        `Failed to upload media to WhatsApp: ${
          error?.response?.data?.error?.message || error.message
        }`
      );
    }
  }

  /**
   * Sends a WhatsApp document message using a previously uploaded media ID.
   * @param to Phone number to send the message to (with country code, no '+')
   * @param mediaId The media ID returned from uploadMedia
   * @param filename Optional filename to display
   * @param caption Optional caption to include with the document
   */
  static async sendDocumentMessage(
    to: string,
    mediaId: string,
    filename?: string,
    caption?: string
  ): Promise<any> {
    const company = await prisma.company.findFirst({ where: { id: requireTenantId() } });
    if (!company) {
      throw new Error("No company found.");
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { companyId: company.id },
    });

    if (!config || !config.accessToken || !config.phoneNumberId) {
      throw new Error("WhatsApp configuration is missing or incomplete.");
    }

    const accessToken = this.decryptText(config.accessToken);

    const url = `https://graph.facebook.com/v20.0/${config.phoneNumberId}/messages`;

    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/^\+/, ""),
      type: "document",
      document: {
        id: mediaId,
        ...(caption && { caption }),
        ...(filename && { filename }),
      },
    };

    try {
      const response = await axios.post(url, data, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      return response.data;
    } catch (error: any) {
      logger.error(
        { err: error?.response?.data || error.message },
        "Error sending WhatsApp document message:"
      );
      throw new Error(
        `Failed to send WhatsApp document message: ${
          error?.response?.data?.error?.message || error.message
        }`
      );
    }
  }
}
