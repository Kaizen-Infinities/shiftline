import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** SMS, DLT templates and one-time passwords (P1-22). */
export interface SmsSettings {
  provider: string;
  enabled: boolean;
  senderId: string | null;
  principalEntityId: string | null;
  hasAuthKey: boolean;
  dailyCap: number;
  sentToday: number;
  lastVerifiedAt: string | null;
}

export interface SmsTemplateRow {
  id: string;
  code: string;
  name: string;
  category: "TRANSACTIONAL" | "SERVICE_IMPLICIT" | "SERVICE_EXPLICIT" | "PROMOTIONAL";
  dltTemplateId: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
}

export interface SmsMessageRow {
  id: string;
  toMobile: string;
  templateCode: string | null;
  body: string;
  segments: number;
  status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED";
  error: string | null;
  purpose: string | null;
  queuedAt: string;
  sentAt: string | null;
}

export interface SmsPreview {
  body: string;
  encoding: "GSM7" | "UCS2";
  characters: number;
  segments: number;
}

const p = API_PATHS.sms;

export const smsService = {
  settings: async (): Promise<SmsSettings> => (await apiClient.get(p.settings)).data.data,
  saveSettings: async (body: {
    provider: string;
    enabled: boolean;
    senderId?: string | null;
    principalEntityId?: string | null;
    authKey?: string | null;
    dailyCap: number;
  }): Promise<SmsSettings> => (await apiClient.put(p.settings, body)).data.data,
  verify: async (): Promise<{ ok: boolean; detail: string }> =>
    (await apiClient.post(`${p.settings}/verify`)).data.data,
  templates: async (all = false): Promise<SmsTemplateRow[]> =>
    (await apiClient.get(p.templates, { params: { all } })).data.data,
  saveTemplate: async (body: {
    code: string;
    name: string;
    category: string;
    dltTemplateId?: string | null;
    body: string;
    isActive: boolean;
  }): Promise<SmsTemplateRow> => (await apiClient.put(p.templates, body)).data.data,
  preview: async (body: string, values: Record<string, string>): Promise<SmsPreview> =>
    (await apiClient.post(p.preview, { body, values })).data.data,
  messages: async (params: { to?: string; status?: string } = {}): Promise<SmsMessageRow[]> =>
    (await apiClient.get(p.messages, { params })).data.data,
};
