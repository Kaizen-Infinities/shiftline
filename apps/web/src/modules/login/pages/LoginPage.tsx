import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FaEye, FaEyeSlash, FaEnvelope, FaLock } from "react-icons/fa";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { loginUser } from "../../../features/auth/authSlice";
import { companyService, type CompanyBranding } from "../../../services/companyService";
import TextInput from "../../../components/form/TextInput/TextInput";
import Button from "../../../components/ui/Button/Button";
import PublicShell from "../../../components/public/PublicShell";

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

        const locationState = location.state as { from?: any } | null;
        const fromPath = "/dashboard";

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
    <PublicShell
      eyebrow="Secure workspace"
      title="Welcome back"
      description="Sign in to manage today’s production, inventory, finance, and compliance work."
      companyName={company?.companyName}
      logoUrl={company?.logoUrl}
    >
      {serverError && (
        <div
          role="alert"
          aria-live="polite"
          className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-600"
        >
          {serverError}
        </div>
      )}
      <form onSubmit={handleLogin} className="space-y-5" noValidate>
        <TextInput
          label="Email address"
          name="email"
          type="email"
          value={email}
          placeholder="you@company.com"
          required
          icon={<FaEnvelope aria-hidden="true" />}
          disabled={loading}
          autoComplete="username"
          error={validationErrors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            setValidationErrors((previous) => ({ ...previous, email: "" }));
            setServerError("");
          }}
        />
        <TextInput
          label="Password"
          name="password"
          type={showPassword ? "text" : "password"}
          value={password}
          placeholder="Enter your password"
          required
          icon={<FaLock aria-hidden="true" />}
          disabled={loading}
          autoComplete="current-password"
          error={validationErrors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            setValidationErrors((previous) => ({ ...previous, password: "" }));
            setServerError("");
          }}
          trailingIcon={
            <button
              type="button"
              onClick={() => setShowPassword((previous) => !previous)}
              disabled={loading}
              className="flex size-10 items-center justify-center rounded-lg text-ink-muted transition hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
            >
              {showPassword ? <FaEyeSlash aria-hidden="true" /> : <FaEye aria-hidden="true" />}
            </button>
          }
        />
        <Button
          text={loading ? "Signing in…" : "Sign in"}
          type="submit"
          size="lg"
          variant="primary"
          width="100%"
          disabled={loading}
        />
      </form>
      <p className="mt-6 text-center text-xs leading-5 text-ink-muted">
        Access is protected by your organisation’s permissions and session policy.
      </p>
    </PublicShell>
  );
};

export default LoginPage;
