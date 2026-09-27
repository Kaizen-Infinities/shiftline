import { Mail, Save, Send, Server } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../../components/ui/v2";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "react-toastify";
import { emailConfigService } from "../../../services/emailConfigService";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import CommonLoader from "../../../components/ui/Loader/CommonLoader";
import { usePermission } from "../../../hooks/usePermission";
import { useDetailCache, invalidateDetailCache } from "../../../hooks/useDetailCache";

interface EmailConfigForm {
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  encryption: string;
}

interface EmailForm {
  recipientEmail: string;
  subject: string;
  message: string;
}

const encryptionOptions = [
  { value: "TLS", label: "TLS" },
  { value: "SSL", label: "SSL" },
  { value: "NONE", label: "NONE" },
];

const EmailConfigPage: React.FC = () => {
  const initialConfigData: EmailConfigForm = {
    smtpHost: "",
    smtpPort: "",
    smtpUsername: "",
    smtpPassword: "",
    fromEmail: "",
    fromName: "",
    encryption: "TLS",
  };

  const initialEmailData: EmailForm = {
    recipientEmail: "",
    subject: "Test Email",
    message: "This is an email from your application.",
  };

  const [configData, setConfigData] = useState<EmailConfigForm>(initialConfigData);
  const [emailData, setEmailData] = useState<EmailForm>(initialEmailData);

  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  const [configErrors, setConfigErrors] = useState<Record<string, string>>({});
  const [emailErrors, setEmailErrors] = useState<Record<string, string>>({});
  const { can } = usePermission();
  const canEditEmail = can("email-config.edit");

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    return await emailConfigService.getConfig();
  }, []);

  const { data: fetchedConfig, loading } = useDetailCache<any>({
    cacheKey: "emailConfig:smtp",
    socketModule: "emailConfig",
    fetcher,
  });

  const populated = useRef(false);
  useEffect(() => {
    if (!fetchedConfig || populated.current) return;
    populated.current = true;
    setConfigData({
      smtpHost: fetchedConfig.smtpHost || "",
      smtpPort: fetchedConfig.smtpPort ? String(fetchedConfig.smtpPort) : "",
      smtpUsername: fetchedConfig.smtpUsername || "",
      smtpPassword: fetchedConfig.smtpPassword ? "••••••••••••••••••••" : "",
      fromEmail: fetchedConfig.fromEmail || "",
      fromName: fetchedConfig.fromName || "",
      encryption: fetchedConfig.encryption || "TLS",
    });
  }, [fetchedConfig]);

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setConfigData((prev) => ({ ...prev, [name]: value }));
    if (configErrors[name]) {
      setConfigErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEmailData((prev) => ({ ...prev, [name]: value }));
    if (emailErrors[name]) {
      setEmailErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handlePasswordFocus = () => {
    if (configData.smtpPassword === "••••••••••••••••••••") {
      setConfigData((prev) => ({ ...prev, smtpPassword: "" }));
    }
  };

  const validateConfig = (): boolean => {
    const errors: Record<string, string> = {};
    if (!configData.smtpHost) errors.smtpHost = "SMTP Host is required";
    if (!configData.smtpPort) errors.smtpPort = "SMTP Port is required";
    if (!configData.smtpUsername) errors.smtpUsername = "SMTP Username is required";
    if (!configData.smtpPassword) errors.smtpPassword = "SMTP Password is required";
    if (!configData.fromEmail) errors.fromEmail = "From Email is required";
    if (!configData.fromName) errors.fromName = "From Name is required";

    setConfigErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const validateEmail = (): boolean => {
    const errors: Record<string, string> = {};
    if (!emailData.recipientEmail) errors.recipientEmail = "Recipient Email is required";
    if (!emailData.subject) errors.subject = "Subject is required";
    if (!emailData.message) errors.message = "Message is required";

    setEmailErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditEmail) {
      toast.error("You do not have permission to edit email configuration.");
      return;
    }
    if (!validateConfig()) {
      toast.warn("Please fill all required SMTP fields.");
      return;
    }

    setSaving(true);
    try {
      await emailConfigService.saveConfig(configData);
      toast.success("Email configuration saved successfully!");
      setConfigData((prev) => ({ ...prev, smtpPassword: "••••••••••••••••••••" }));
      invalidateDetailCache("emailConfig:smtp");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateEmail()) {
      toast.warn("Please fill all email fields.");
      return;
    }

    setSending(true);
    try {
      await emailConfigService.sendEmailDirect(emailData);
      toast.success("Email sent successfully!");
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to send email");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <CommonLoader text="Loading..." fullScreen={false} />;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Email Configuration"
        icon={<Mail size={22} />}
        subtitle="The mail server that invoices, reminders and invitations go out through. The password is stored encrypted and never shown again."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Email" }]}
      />
      <form onSubmit={handleSaveConfig} noValidate className="space-y-5">
        {/* Section 1: SMTP Settings */}
        <Tile title="SMTP Settings" icon={<Server size={18} />}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              label="SMTP Host"
              name="smtpHost"
              value={configData.smtpHost}
              placeholder="smtp.gmail.com"
              required
              onChange={handleConfigChange as any}
              error={configErrors.smtpHost}
            />
            <TextInput
              label="SMTP Port"
              name="smtpPort"
              type="number"
              value={configData.smtpPort}
              placeholder="587"
              required
              onChange={handleConfigChange as any}
              error={configErrors.smtpPort}
            />
            <SelectInput
              label="Encryption"
              name="encryption"
              value={configData.encryption}
              options={encryptionOptions}
              onChange={handleConfigChange}
              searchable={false}
            />
            <TextInput
              label="SMTP Username"
              name="smtpUsername"
              value={configData.smtpUsername}
              placeholder="user@example.com"
              required
              onChange={handleConfigChange as any}
              error={configErrors.smtpUsername}
            />
            <TextInput
              label="SMTP Password"
              name="smtpPassword"
              type="password"
              value={configData.smtpPassword}
              placeholder="••••••••"
              required
              onFocus={handlePasswordFocus}
              onChange={handleConfigChange as any}
              error={configErrors.smtpPassword}
            />
            <TextInput
              label="From Email"
              name="fromEmail"
              type="email"
              value={configData.fromEmail}
              placeholder="noreply@example.com"
              required
              onChange={handleConfigChange as any}
              error={configErrors.fromEmail}
            />
            <TextInput
              label="From Name"
              name="fromName"
              value={configData.fromName}
              placeholder="Company Name"
              required
              onChange={handleConfigChange as any}
              error={configErrors.fromName}
            />
          </div>

          {/* Save Config Button */}
          {canEditEmail && (
            <div className="mt-5 flex justify-end border-t border-line-soft pt-4">
              <ActionPill
                type="submit"
                icon={<Save size={17} />}
                loading={saving}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Configuration"}
              </ActionPill>
            </div>
          )}
        </Tile>

        {/* Section 2: Send Test Email */}
        <Tile
          title="Send Test Email"
          icon={<Send size={18} />}
          subtitle="Check the settings above by sending yourself a message."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              label="Recipient Email"
              name="recipientEmail"
              type="email"
              value={emailData.recipientEmail}
              placeholder="recipient@example.com"
              required
              onChange={handleEmailChange as any}
              error={emailErrors.recipientEmail}
            />
            <TextInput
              label="Subject"
              name="subject"
              value={emailData.subject}
              required
              onChange={handleEmailChange as any}
              error={emailErrors.subject}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 items-end gap-4 md:grid-cols-[1fr_auto]">
            <TextInput
              label="Message"
              name="message"
              value={emailData.message}
              placeholder="Write your email message here..."
              required
              onChange={handleEmailChange as any}
              error={emailErrors.message}
            />
            <ActionPill
              variant="secondary"
              icon={<Send size={16} />}
              onClick={handleSendEmail}
              disabled={sending || saving}
              loading={sending}
            >
              {sending ? "Sending..." : "Send Email"}
            </ActionPill>
          </div>
        </Tile>
      </form>
    </div>
  );
};

export default EmailConfigPage;
