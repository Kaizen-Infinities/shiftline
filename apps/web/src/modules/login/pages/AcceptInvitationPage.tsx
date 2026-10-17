import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiClient } from "../../../api/apiClient";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { setAccessToken, getCurrentUser } from "../../../features/auth/authSlice";
import AuthLayout from "../../../components/layout/AuthLayout";

interface InvitationPreview {
  email: string;
  fullName: string | null;
  companyName: string;
  roleName: string;
  expiresAt: string;
}

/**
 * Public page opened from an invitation email: shows who invited you and for
 * which company, takes a name, username and password, and signs you in.
 */
const AcceptInvitationPage: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(token)) {
      setError("This invitation link is not valid.");
      return;
    }
    apiClient
      .get(`/invitations/token/${token}`)
      .then((res) => {
        const data = res.data?.data as InvitationPreview;
        setPreview(data);
        setFullName(data.fullName ?? "");
        setUsername(
          data.email
            .split("@")[0]
            .toLowerCase()
            .replace(/[^a-z0-9._-]/g, "")
        );
      })
      .catch((err) => {
        const status = err?.response?.status;
        setError(
          status === 410
            ? "This invitation has expired or was already used. Ask your administrator for a new one."
            : "This invitation link is not valid."
        );
      });
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.post(`/invitations/token/${token}/accept`, {
        fullName,
        username,
        password,
      });
      const data = res.data?.data;
      dispatch(
        setAccessToken({
          accessToken: data.accessToken,
          accessTokenExpiresAt: data.accessTokenExpiresAt ?? null,
        })
      );
      await dispatch(getCurrentUser());
      navigate("/dashboard", { replace: true });
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "Could not accept the invitation.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      headline={
        <>
          You're invited to <strong>{preview?.companyName ?? "Shiftline"}</strong>
        </>
      }
      subline="Choose your own password; nobody else ever sees it. Your administrator already set up what you can open."
    >
      <div className="sl-tile w-full max-w-[440px] !rounded-[24px] p-7 sm:p-9">
        <h1 className="sl-h1">Join {preview?.companyName ?? "Shiftline"}</h1>
        {preview && (
          <p className="sl-muted mt-1.5 text-sm">
            You were invited as <strong>{preview.roleName}</strong> using{" "}
            <strong>{preview.email}</strong>.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="sl-chip-danger mt-5 rounded-[14px] px-4 py-3 text-sm font-medium"
          >
            {error}
          </div>
        )}

        {preview && (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <label className="block text-sm font-semibold text-ink-muted">
              Full name
              <input
                name="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                className="sl-input mt-1.5 h-12 text-base font-normal normal-case tracking-normal"
              />
            </label>
            <label className="block text-sm font-semibold text-ink-muted">
              Username
              <input
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                required
                minLength={3}
                pattern="[a-z0-9._-]+"
                className="sl-input mt-1.5 h-12 text-base font-normal normal-case tracking-normal"
              />
            </label>
            <label className="block text-sm font-semibold text-ink-muted">
              Password (10+ characters)
              <input
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                className="sl-input mt-1.5 h-12 text-base font-normal normal-case tracking-normal"
              />
            </label>
            <label className="block text-sm font-semibold text-ink-muted">
              Confirm password
              <input
                name="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="sl-input mt-1.5 h-12 text-base font-normal normal-case tracking-normal"
              />
            </label>
            <button type="submit" disabled={submitting} className="sl-cta sl-cta-lg !mt-7 w-full">
              {submitting ? "Creating your account…" : "Accept invitation"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <button
            type="button"
            className="rounded-sm font-semibold text-accent hover:underline"
            onClick={() => navigate("/login")}
          >
            Sign in
          </button>
        </p>
      </div>
    </AuthLayout>
  );
};

export default AcceptInvitationPage;
