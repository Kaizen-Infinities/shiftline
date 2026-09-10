import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { setAccessToken, getCurrentUser } from "../../../features/auth/authSlice";

interface InvitationPreview {
  email: string;
  fullName: string | null;
  companyName: string;
  roleName: string;
  expiresAt: string;
}

const API = import.meta.env.VITE_API_URL;

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
    axios
      .get(`${API}/invitations/token/${token}`)
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
      const res = await axios.post(
        `${API}/invitations/token/${token}/accept`,
        { fullName, username, password },
        { withCredentials: true }
      );
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
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md bg-card border border-line-soft rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-bold text-ink">Join {preview?.companyName ?? "Shiftline"}</h1>
        {preview && (
          <p className="text-sm text-ink-muted mt-1">
            You were invited as <strong>{preview.roleName}</strong> using{" "}
            <strong>{preview.email}</strong>.
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
            {error}
          </div>
        )}

        {preview && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted">
              Full name
              <input
                name="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                minLength={2}
                className="mt-1 w-full rounded-lg border border-line-soft bg-card-2 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted">
              Username
              <input
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                required
                minLength={3}
                pattern="[a-z0-9._-]+"
                className="mt-1 w-full rounded-lg border border-line-soft bg-card-2 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted">
              Password (10+ characters)
              <input
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
                className="mt-1 w-full rounded-lg border border-line-soft bg-card-2 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted">
              Confirm password
              <input
                name="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-line-soft bg-card-2 px-3 py-2 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-bold py-2.5 text-sm"
            >
              {submitting ? "Creating your account…" : "Accept invitation"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-ink-muted">
          Already have an account?{" "}
          <button type="button" className="underline" onClick={() => navigate("/login")}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
};

export default AcceptInvitationPage;
