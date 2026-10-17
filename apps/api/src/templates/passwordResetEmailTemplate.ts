import { safeUrl } from "../utils/escapeHtml";

export const generatePasswordResetEmail = (
  resetUrl: string
): { subject: string; html: string; text: string } => {
  const href = safeUrl(resetUrl, { allowLocalHttp: true }) || "#";
  return {
    subject: "Reset your Shiftline password",
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
<h2 style="margin:0 0 12px">Reset your password</h2>
<p>We received a request to reset the password for your Shiftline account. This link expires soon and works once.</p>
<p><a href="${href}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none">Choose a new password</a></p>
<p style="font-size:13px;color:#6b7280">If you did not ask for this, you can ignore this email.</p>
</div>`,
    text: `Reset your Shiftline password: ${resetUrl}\n\nIf you did not ask for this, you can ignore this email.`,
  };
};
