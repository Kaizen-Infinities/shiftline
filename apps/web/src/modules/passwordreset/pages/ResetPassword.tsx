import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import AuthLayout from "../../../components/layout/AuthLayout";

const ResetPassword = () => {
  const navigate = useNavigate();

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
        <h2 className="sl-h1">Reset password</h2>
        <p className="sl-muted mt-1.5 text-sm">Enter your new password below.</p>

        <form className="mt-7 space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
          <div>
            <label
              htmlFor="reset-password"
              className="mb-1.5 block text-sm font-semibold text-ink-muted"
            >
              New Password
            </label>
            <input
              id="reset-password"
              name="password"
              type="password"
              placeholder="Enter new password"
              required
              autoComplete="new-password"
              className="sl-input h-12"
            />
          </div>
          <div>
            <label
              htmlFor="reset-confirm"
              className="mb-1.5 block text-sm font-semibold text-ink-muted"
            >
              Confirm Password
            </label>
            <input
              id="reset-confirm"
              name="confirmPassword"
              type="password"
              placeholder="Confirm new password"
              required
              autoComplete="new-password"
              className="sl-input h-12"
            />
          </div>
          <div className="pt-2">
            <button
              type="button"
              className="sl-cta sl-cta-lg w-full"
              onClick={() => navigate("/login")}
            >
              Reset &amp; sign in
            </button>
          </div>
        </form>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="rounded-sm text-sm font-semibold text-accent hover:underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </AuthLayout>
  );
};

export default ResetPassword;
