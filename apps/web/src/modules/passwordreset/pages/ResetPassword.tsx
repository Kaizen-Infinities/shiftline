import { useNavigate } from "react-router-dom";
import { FaLock } from "react-icons/fa";
import TextInput from "../../../components/form/TextInput/TextInput";
import Button from "../../../components/ui/Button/Button";

const ResetPassword = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4 sm:px-8">
      <div className="w-full max-w-[400px] bg-card border border-line rounded-sm p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-sm border border-line bg-card-2">
            <FaLock className="text-base text-accent" />
          </div>
          <h2 className="text-2xl font-bold leading-tight mb-2 text-ink">Reset password</h2>
          <p className="text-ink-muted text-sm leading-relaxed">Enter your new password below.</p>
        </div>

        {/* Form */}
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
          <TextInput
            label="New Password"
            name="password"
            type="password"
            value=""
            placeholder="Enter new password"
            required
            inputClassName="!bg-card !text-ink !border-line focus:!border-accent focus:!ring-accent/20 placeholder:!text-ink-subtle font-semibold"
            labelClassName="!text-ink-muted font-bold"
            onChange={() => {}}
          />

          <TextInput
            label="Confirm Password"
            name="confirmPassword"
            type="password"
            value=""
            placeholder="Confirm new password"
            required
            inputClassName="!bg-card !text-ink !border-line focus:!border-accent focus:!ring-accent/20 placeholder:!text-ink-subtle font-semibold"
            labelClassName="!text-ink-muted font-bold"
            onChange={() => {}}
          />

          <div className="pt-2">
            <Button
              text="Reset & sign in"
              type="button"
              size="lg"
              variant="primary"
              width="100%"
              onClick={() => navigate("/login")}
            />
          </div>
        </form>

        <div className="text-center mt-6">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="text-sm font-semibold text-ink-muted hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
