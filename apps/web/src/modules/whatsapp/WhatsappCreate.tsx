import { Eraser, KeyRound, MessageCircle, Save, Send, Settings2 } from "lucide-react";
import { ActionPill, Chip, PageHeader, Tile } from "../../components/ui/v2";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "react-toastify";
import apiClient from "../../api/apiClient";
import TextInput from "../../components/form/TextInput/TextInput";
import IndiaPhoneInput from "../../components/ui/PhoneInput/PhoneInput";
import CommonLoader from "../../components/ui/Loader/CommonLoader";
import { usePermission } from "../../hooks/usePermission";
import { useDetailCache, invalidateDetailCache } from "../../hooks/useDetailCache";

interface WhatsappConfigForm {
  phoneNumberId: string;
  wabaId: string;
  businessPhone: string;
  accessToken: string;
  webhookVerifyToken: string;
}

const WhatsappCreatePage: React.FC = () => {
  const initialFormData: WhatsappConfigForm = {
    phoneNumberId: "",
    wabaId: "",
    businessPhone: "",
    accessToken: "",
    webhookVerifyToken: "",
  };

  const [formData, setFormData] = useState<WhatsappConfigForm>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { can } = usePermission();
  const canEditWhatsapp = can("whatsapp.edit");

  // Test message state
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Hello from Shiftline! This is a test message.");
  const [sending, setSending] = useState(false);

  // Fetch config with cache (survives navigation, instant on return)
  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const response = await apiClient.get("/whatsapp/config");
    if (response.data?.success && response.data.data) {
      return response.data.data;
    }
    return null;
  }, []);

  const { data: configData, loading } = useDetailCache<any>({
    cacheKey: "whatsapp:config",
    socketModule: "whatsapp",
    fetcher,
  });

  // Populate form when cached/fetched data arrives
  const populated = useRef(false);
  useEffect(() => {
    if (!configData || populated.current) return;
    populated.current = true;
    const { phoneNumberId, wabaId, businessPhone, hasAccessToken, webhookVerifyToken } = configData;
    setFormData({
      phoneNumberId: phoneNumberId || "",
      wabaId: wabaId || "",
      businessPhone: businessPhone || "",
      accessToken: hasAccessToken ? "••••••••••••••••••••" : "",
      webhookVerifyToken: webhookVerifyToken || "",
    });
    setIsEditing(true);
  }, [configData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleTokenFocus = () => {
    if (formData.accessToken === "••••••••••••••••••••") {
      setFormData((prev) => ({ ...prev, accessToken: "" }));
    }
  };

  const handleClear = () => {
    setFormData(initialFormData);
    setIsEditing(false);
    setErrors({});
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.phoneNumberId.trim()) {
      newErrors.phoneNumberId = "Phone Number ID is required";
    }
    if (!formData.wabaId.trim()) {
      newErrors.wabaId = "WABA ID is required";
    }
    if (!formData.accessToken.trim()) {
      newErrors.accessToken = "Access Token is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      toast.warn("Please fill in all required fields correctly.");
      return;
    }

    if (!canEditWhatsapp) {
      toast.error("You do not have permission to edit WhatsApp configuration.");
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.post("/whatsapp/config", {
        phoneNumberId: formData.phoneNumberId.trim(),
        wabaId: formData.wabaId.trim(),
        businessPhone: formData.businessPhone.trim(),
        accessToken: formData.accessToken.trim(),
        webhookVerifyToken: formData.webhookVerifyToken.trim(),
      });

      if (response.data && response.data.success) {
        toast.success(
          isEditing
            ? "WhatsApp configuration updated successfully!"
            : "WhatsApp configuration saved successfully!"
        );
        setFormData({
          phoneNumberId: formData.phoneNumberId.trim(),
          wabaId: formData.wabaId.trim(),
          businessPhone: formData.businessPhone.trim(),
          accessToken: "••••••••••••••••••••",
          webhookVerifyToken: formData.webhookVerifyToken.trim(),
        });
        setIsEditing(true);
        setErrors({});
        invalidateDetailCache("whatsapp:config");
      } else {
        toast.error(response.data?.message || "Failed to save configuration");
      }
    } catch (error: any) {
      console.error("[WhatsApp Config] Error saving:", error);
      const errMsg = error.response?.data?.message || "Error connecting to server";
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!testPhone.trim() || !testMessage.trim()) {
      toast.warn("Please enter a test phone number and message.");
      return;
    }

    setSending(true);
    try {
      const formattedPhone = testPhone.replace(/\D/g, "");
      const response = await apiClient.post("/whatsapp/send", {
        to: formattedPhone,
        message: testMessage,
      });

      if (response.data && response.data.success) {
        toast.success("Test message sent successfully!");
      } else {
        toast.error(response.data?.message || "Failed to send test message");
      }
    } catch (error: any) {
      console.error("[WhatsApp Config] Error sending test message:", error);
      const errMsg = error.response?.data?.message || "Error connecting to server";
      toast.error(errMsg);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <CommonLoader text="Loading ..." fullScreen={false} />;

  return (
    <div className="sl-page sl-page-form">
      <PageHeader
        title="WhatsApp"
        icon={<MessageCircle size={22} />}
        subtitle="The WhatsApp Business account invoices, payslips and reminders are shared through."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "WhatsApp" }]}
        meta={
          isEditing ? (
            <Chip tone="success" size="sm" dot>
              Connected
            </Chip>
          ) : (
            <Chip tone="muted" size="sm" dot>
              Not set up
            </Chip>
          )
        }
      />
      <form onSubmit={handleSubmit} noValidate>
        <div className="space-y-5">
          {/* Section: API Setup Credentials */}
          <Tile title="API Setup Credentials" icon={<Settings2 size={18} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput
                label="Phone Number ID"
                name="phoneNumberId"
                value={formData.phoneNumberId}
                placeholder="e.g. 109876543212345"
                required
                onChange={handleChange as any}
                error={errors.phoneNumberId}
              />
              <TextInput
                label="WABA ID"
                name="wabaId"
                value={formData.wabaId}
                placeholder="e.g. 987654321098765"
                required
                onChange={handleChange as any}
                error={errors.wabaId}
              />
              <IndiaPhoneInput
                label="Business Phone"
                name="businessPhone"
                value={formData.businessPhone}
                placeholder="e.g. 919876543210"
                required
                onChange={handleChange as any}
                error={errors.businessPhone}
              />
            </div>
          </Tile>

          {/* Section: Security & Credentials */}
          <Tile title="Security & Credentials" icon={<KeyRound size={18} />}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextInput
                label="Access Token"
                name="accessToken"
                value={formData.accessToken}
                placeholder="Paste your Access Token..."
                required
                onChange={handleChange as any}
                onFocus={handleTokenFocus}
                error={errors.accessToken}
              />
              <TextInput
                label="Webhook Token"
                name="webhookVerifyToken"
                value={formData.webhookVerifyToken}
                placeholder="e.g. my_secret_token_123"
                onChange={handleChange as any}
                error={errors.webhookVerifyToken}
              />
            </div>
          </Tile>

          {/* Section: Test Message (only when config exists) */}
          {isEditing && (
            <Tile title="Send a Test Message" icon={<Send size={18} />}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <IndiaPhoneInput
                  label="Recipient Phone"
                  name="testPhone"
                  value={testPhone}
                  placeholder="e.g. 919876543210"
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                <TextInput
                  label="Test Message"
                  name="testMessage"
                  value={testMessage}
                  placeholder="Enter your test message..."
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>
              <div className="mt-4 flex justify-end">
                <ActionPill
                  variant="secondary"
                  icon={<Send size={16} />}
                  onClick={handleSendTestMessage}
                  loading={sending}
                  disabled={sending || !testPhone.trim() || !testMessage.trim()}
                >
                  {sending ? "Sending..." : "Send Test Message"}
                </ActionPill>
              </div>
            </Tile>
          )}

          {/* Footer */}
          {canEditWhatsapp && (
            <div className="sl-tile sl-sticky-footer z-10 flex justify-end gap-2 px-4 py-3">
              <ActionPill variant="secondary" icon={<Eraser size={16} />} onClick={handleClear}>
                Clear
              </ActionPill>
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
        </div>
      </form>
    </div>
  );
};

export default WhatsappCreatePage;
