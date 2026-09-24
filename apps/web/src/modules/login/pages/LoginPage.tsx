import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FaEye, FaEyeSlash, FaEnvelope, FaLock } from "react-icons/fa";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { loginUser } from "../../../features/auth/authSlice";
import { companyService, type CompanyBranding } from "../../../services/companyService";
import TextInput from "../../../components/form/TextInput/TextInput";
import Button from "../../../components/ui/Button/Button";

const LoginPage = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();

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

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-page">
      {/* ── LEFT BRANDING PANEL ── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] min-h-screen flex-col justify-center relative bg-card-2 border-r border-line overflow-hidden">
        {/* A ledger-rule field: quiet horizontal hairlines, evenly spaced, no gradient or glow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, var(--color-line) 0, var(--color-line) 1px, transparent 1px, transparent 64px)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col h-full px-12 xl:px-16">
          <div className="flex-1 flex flex-col justify-center">
            <h1 className="text-4xl xl:text-5xl font-bold text-ink leading-[1.1] mb-5 tracking-tight">
              Welcome to
              <br />
              Shiftline
            </h1>

            <p className="text-ink-muted text-base leading-relaxed max-w-[540px]">
              Production, inventory, sales, purchasing, accounts and statutory compliance, on one
              ledger.
            </p>
          </div>

          {/* Copyright */}
          <p className="text-ink-subtle text-xs pb-10">
            © {new Date().getFullYear()} {company?.companyName || "Shiftline"}. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── RIGHT LOGIN PANEL ── */}
      <div className="flex-1 flex flex-col justify-center items-center min-h-screen bg-page px-6 sm:px-10 lg:px-12 xl:px-16">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 flex flex-col items-center">
          <img
            src={company?.logoUrl || "/favicon.svg"}
            alt={company?.companyName || "Shiftline"}
            className="h-12 object-contain"
          />
        </div>

        <div className="w-full max-w-[400px] bg-card border border-line rounded-sm p-8">
          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold leading-tight mb-2 text-ink">Sign in</h2>
            <p className="text-ink-muted text-sm leading-relaxed">
              Sign in to your account to continue managing operations.
            </p>
          </div>

          {/* General Server Error Message */}
          {serverError && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 px-4 py-3 bg-card-2 text-[color:var(--color-danger)] text-sm rounded-sm border border-[color:var(--color-danger)]/40 font-medium"
            >
              {serverError}
            </div>
          )}

          {/* ── FORM ── */}
          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            {/* Email Address */}
            <TextInput
              label="Email Address"
              name="email"
              type="email"
              value={email}
              placeholder="you@company.com"
              required
              icon={<FaEnvelope />}
              disabled={loading}
              autoComplete="username"
              error={validationErrors.email}
              inputClassName="login-input !bg-card !text-ink !border-line focus:!border-accent focus:!ring-accent/20 placeholder:!text-ink-subtle font-semibold"
              labelClassName="!text-ink-muted font-bold"
              onChange={(e) => {
                setEmail(e.target.value);
                setValidationErrors((prev) => ({ ...prev, email: "" }));
                setServerError("");
              }}
            />

            {/* Password */}
            <TextInput
              label="Password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              placeholder="Enter your password"
              required
              icon={<FaLock />}
              disabled={loading}
              autoComplete="current-password"
              error={validationErrors.password}
              inputClassName="login-input !bg-card !text-ink !border-line focus:!border-accent focus:!ring-accent/20 placeholder:!text-ink-subtle font-semibold"
              labelClassName="!text-ink-muted font-bold"
              onChange={(e) => {
                setPassword(e.target.value);
                setValidationErrors((prev) => ({ ...prev, password: "" }));
                setServerError("");
              }}
              trailingIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  disabled={loading}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="flex h-10 w-10 items-center justify-center rounded-sm text-ink-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 transition-colors"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
                </button>
              }
            />

            {/* Forgot password */}
            {/* <div className="flex justify-end pt-1">
                            <button
                                type="button"
                                onClick={() => navigate("/reset")}
                                disabled={loading}
                                className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors focus:outline-none"
                            >
                                Forgot password?{" "}
                                <span className="underline underline-offset-2">Click here</span>
                            </button>
                        </div> */}

            {/* Submit Button */}
            <div className="pt-2">
              <Button
                text={loading ? "Signing In..." : "Login Now"}
                type="submit"
                size="lg"
                variant="primary"
                width="100%"
                disabled={loading}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
