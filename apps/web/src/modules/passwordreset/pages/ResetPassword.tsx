import { useId, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound } from "lucide-react";
import AuthLayout from "../../../components/layout/AuthLayout";
import authService from "../../../services/authService";
import { getServerErrorMessage } from "../../../utils/serverErrors";
import { validateResetForm } from "../passwordRules";

const GENERIC_REQUEST_MESSAGE =
  "If an account exists for this email, you will receive a reset link";

/** Asks for the account email and sends the reset link. Reached from /reset with no token. */
const RequestResetForm = () => {
  const ids = useId();
  const emailId = `${ids}-email`;
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [serverError, setServerError] = useState("");
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Enter a valid email address");
      return;
    }
    setEmailError("");
    try {
      setSubmitting(true);
      const body = await authService.requestPasswordReset(trimmed);
      setSentMessage(body?.message || GENERIC_REQUEST_MESSAGE);
    } catch (err) {
      setServerError(getServerErrorMessage(err, "Could not send the reset link. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <h2 className="sl-h1">Reset password</h2>
      <p className="sl-muted mt-1.5 text-sm leading-relaxed">
        Enter your email and we will send you a link to choose a new password.
      </p>

      {serverError && (
        <div
          role="alert"
          className="sl-chip-danger mt-6 rounded-[14px] px-4 py-3 text-sm font-medium"
        >
          {serverError}
        </div>
      )}

      {sentMessage ? (
        <div
          role="status"
          className="sl-chip-success mt-6 rounded-[14px] px-4 py-3 text-sm font-medium"
        >
          {sentMessage}
        </div>
      ) : (
        <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor={emailId} className="mb-1.5 block text-sm font-semibold text-ink-muted">
              Email
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              value={email}
              placeholder="name@company.com"
              required
              disabled={submitting}
              autoComplete="username"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? `${emailId}-error` : undefined}
              className="sl-input h-12"
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError("");
              }}
            />
            {emailError && (
              <p
                id={`${emailId}-error`}
                className="mt-1.5 text-sm text-[color:var(--color-danger)]"
              >
                {emailError}
              </p>
            )}
          </div>
          <div className="pt-2">
            <button type="submit" disabled={submitting} className="sl-cta sl-cta-lg w-full">
              {submitting ? "Sending..." : "Send reset link"}
            </button>
          </div>
        </form>
      )}
    </>
  );
};

/** Sets the new password from the emailed token. Reached from /reset?token=... */
const SetPasswordForm = ({ token }: { token: string }) => {
  const navigate = useNavigate();
  const ids = useId();
  const passwordId = `${ids}-password`;
  const confirmId = `${ids}-confirm`;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [serverError, setServerError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");
    const errors = validateResetForm(password, confirm);
    setFieldErrors(errors);
    if (errors.password || errors.confirm) return;

    try {
      setSubmitting(true);
      await authService.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setServerError(getServerErrorMessage(err, "Could not reset the password. Try again."));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <>
        <h2 className="sl-h1">Password updated</h2>
        <p
          role="status"
          className="sl-chip-success mt-6 block rounded-[14px] px-4 py-3 text-sm font-medium"
        >
          Your password has been reset. Sign in with the new password.
        </p>
        <div className="pt-6">
          <button
            type="button"
            className="sl-cta sl-cta-lg w-full"
            onClick={() => navigate("/login")}
          >
            Go to sign in
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className="sl-h1">Choose a new password</h2>
      <p className="sl-muted mt-1.5 text-sm leading-relaxed">
        Use at least 8 characters with an uppercase letter, a lowercase letter and a digit.
      </p>

      {serverError && (
        <div
          role="alert"
          className="sl-chip-danger mt-6 rounded-[14px] px-4 py-3 text-sm font-medium"
        >
          {serverError}
        </div>
      )}

      <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor={passwordId} className="mb-1.5 block text-sm font-semibold text-ink-muted">
            New password
          </label>
          <input
            id={passwordId}
            name="password"
            type="password"
            value={password}
            placeholder="Enter new password"
            required
            disabled={submitting}
            autoComplete="new-password"
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? `${passwordId}-error` : undefined}
            className="sl-input h-12"
            onChange={(e) => {
              setPassword(e.target.value);
              setFieldErrors((prev) => ({ ...prev, password: undefined }));
            }}
          />
          {fieldErrors.password && (
            <p
              id={`${passwordId}-error`}
              className="mt-1.5 text-sm text-[color:var(--color-danger)]"
            >
              {fieldErrors.password}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={confirmId} className="mb-1.5 block text-sm font-semibold text-ink-muted">
            Confirm password
          </label>
          <input
            id={confirmId}
            name="confirmPassword"
            type="password"
            value={confirm}
            placeholder="Confirm new password"
            required
            disabled={submitting}
            autoComplete="new-password"
            aria-invalid={!!fieldErrors.confirm}
            aria-describedby={fieldErrors.confirm ? `${confirmId}-error` : undefined}
            className="sl-input h-12"
            onChange={(e) => {
              setConfirm(e.target.value);
              setFieldErrors((prev) => ({ ...prev, confirm: undefined }));
            }}
          />
          {fieldErrors.confirm && (
            <p
              id={`${confirmId}-error`}
              className="mt-1.5 text-sm text-[color:var(--color-danger)]"
            >
              {fieldErrors.confirm}
            </p>
          )}
        </div>
        <div className="pt-2">
          <button type="submit" disabled={submitting} className="sl-cta sl-cta-lg w-full">
            {submitting ? "Saving..." : "Reset password"}
          </button>
        </div>
      </form>
    </>
  );
};

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  return (
    <AuthLayout
      headline={
        <>
          A fresh <strong>start</strong>
        </>
      }
      subline="Pick a new password you have not used on Shiftline before."
    >
      <div className="sl-tile w-full max-w-[420px] !rounded-[24px] p-7 sm:p-9">
        <span className="sl-icon-tile mb-5">
          <KeyRound size={20} aria-hidden />
        </span>
        {token ? <SetPasswordForm token={token} /> : <RequestResetForm />}

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="rounded-sm text-sm font-semibold text-accent hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
};

export default ResetPassword;
