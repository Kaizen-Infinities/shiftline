import { useState, useEffect, useId } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MAKER } from "../../../components/brand/BrandMark";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { loginUser } from "../../../features/auth/authSlice";
import { companyService, type CompanyBranding } from "../../../services/companyService";
import AuthLayout from "../../../components/layout/AuthLayout";

const LoginPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const ids = useId();

  const { isLoading: reduxLoading } = useAppSelector((state) => state.auth);
  const [company, setCompany] = useState<CompanyBranding | null>(null);

  useEffect(() => {
    companyService
      .getPublicCompany()
      .then(setCompany)
      .catch(() => setCompany(null));
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);

  // Field-specific validation errors
  const [validationErrors, setValidationErrors] = useState({
    email: "",
    password: "",
  });

  // Server/General error
  const [serverError, setServerError] = useState("");

  const loading = localLoading || reduxLoading;

  const validateForm = () => {
    let isValid = true;
    const errors = { email: "", password: "" };

    if (!email.trim()) {
      errors.email = "Email Address is required";
      isValid = false;
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.email = "Please enter a valid email address";
        isValid = false;
      }
    }

    if (!password) {
      errors.password = "Password is required";
      isValid = false;
    } else if (password.length < 4) {
      errors.password = "Password must be at least 4 characters";
      isValid = false;
    }

    setValidationErrors(errors);
    return isValid;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");

    if (!validateForm()) {
      return;
    }

    try {
      setLocalLoading(true);

      const resultAction = await dispatch(loginUser({ email: email.trim(), password }));

      if (loginUser.fulfilled.match(resultAction)) {
        const user = resultAction.payload;
        toast.success(`Welcome back, ${user?.fullName || "User"}`);

        const locationState = location.state as {
          from?: { pathname?: string; search?: string; hash?: string };
        } | null;
        const requestedPath = locationState?.from;
        const fromPath =
          requestedPath?.pathname?.startsWith("/") &&
          !requestedPath.pathname.startsWith("//") &&
          requestedPath.pathname !== "/login"
            ? `${requestedPath.pathname}${requestedPath.search ?? ""}${requestedPath.hash ?? ""}`
            : "/dashboard";

        navigate(fromPath, { replace: true });
      } else {
        const message = (resultAction.payload as string) || "Invalid email or password";
        setServerError(message);
        toast.error(message);
      }
    } catch (err: any) {
      const message = err?.message || "An unexpected error occurred";
      setServerError(message);
      toast.error(message);
    } finally {
      setLocalLoading(false);
    }
  };

  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;
  const companyName = company?.companyName || "Shiftline";

  return (
    <AuthLayout
      logoUrl={company?.logoUrl}
      logoAlt={companyName}
      headline={
        <>
          Welcome to <strong>Shiftline</strong>
        </>
      }
      subline="Production, inventory, sales, purchasing, accounts and statutory compliance, on one ledger."
      footer={`© ${new Date().getFullYear()} Shiftline Beta · ${MAKER.full}`}
    >
      <div className="sl-tile w-full max-w-[420px] !rounded-[24px] p-7 sm:p-9">
        <h2 className="sl-h1">Sign in</h2>
        <p className="sl-muted mt-1.5 text-sm leading-relaxed">
          Sign in to your account to continue managing operations.
        </p>

        {serverError && (
          <div
            role="alert"
            aria-live="polite"
            className="sl-chip-danger mt-6 rounded-[14px] px-4 py-3 text-sm font-medium"
          >
            {serverError}
          </div>
        )}

        <form onSubmit={handleLogin} className="mt-7 space-y-5" noValidate>
          <div>
            <label htmlFor={emailId} className="mb-1.5 block text-sm font-semibold text-ink-muted">
              Email address
            </label>
            <div className="relative">
              <Mail
                size={18}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                id={emailId}
                name="email"
                type="email"
                value={email}
                placeholder="you@company.com"
                required
                disabled={loading}
                autoComplete="username"
                aria-invalid={!!validationErrors.email}
                aria-describedby={validationErrors.email ? `${emailId}-error` : undefined}
                className="login-input sl-input h-12 !pl-11"
                onChange={(e) => {
                  setEmail(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, email: "" }));
                  setServerError("");
                }}
              />
            </div>
            {validationErrors.email && (
              <p
                id={`${emailId}-error`}
                className="mt-1.5 text-sm text-[color:var(--color-danger)]"
              >
                {validationErrors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={passwordId}
              className="mb-1.5 block text-sm font-semibold text-ink-muted"
            >
              Password
            </label>
            <div className="relative">
              <LockKeyhole
                size={18}
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                id={passwordId}
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                placeholder="Enter your password"
                required
                disabled={loading}
                autoComplete="current-password"
                aria-invalid={!!validationErrors.password}
                aria-describedby={validationErrors.password ? `${passwordId}-error` : undefined}
                className="login-input sl-input h-12 !pl-11 !pr-12"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setValidationErrors((prev) => ({ ...prev, password: "" }));
                  setServerError("");
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide password" : "Show password"}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-ink-subtle hover:bg-nav-hover hover:text-ink"
              >
                {showPassword ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
            {validationErrors.password && (
              <p
                id={`${passwordId}-error`}
                className="mt-1.5 text-sm text-[color:var(--color-danger)]"
              >
                {validationErrors.password}
              </p>
            )}
          </div>

          <div className="pt-2">
            <button type="submit" disabled={loading} className="sl-cta sl-cta-lg w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

        <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-line-soft pt-5 text-xs text-ink-subtle">
          <span className="sl-chip sl-chip-muted !text-xs">GST ready</span>
          <span className="sl-chip sl-chip-muted !text-xs">Made for Indian factories</span>
        </div>
      </div>
    </AuthLayout>
  );
};

export default LoginPage;
