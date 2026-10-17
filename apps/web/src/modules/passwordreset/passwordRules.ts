/**
 * Client-side mirror of the API's `passwordSchema` (apps/api/src/modules/auth/auth.validation.ts).
 * Keep the two in step; the API remains the authority and its message is shown when it disagrees.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
const PASSWORD_CLASSES = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).*$/;

/** Returns the first rule the password breaks, or null when it is acceptable. */
export const validateNewPassword = (password: string): string | null => {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must not exceed ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (!PASSWORD_CLASSES.test(password)) {
    return "Password must contain at least one uppercase letter, one lowercase letter, and one digit";
  }
  return null;
};

/** Full form check: the rule above plus the confirmation match. Returns a message per field. */
export const validateResetForm = (
  password: string,
  confirm: string
): { password?: string; confirm?: string } => {
  const errors: { password?: string; confirm?: string } = {};
  const passwordError = validateNewPassword(password);
  if (passwordError) errors.password = passwordError;
  if (confirm !== password) errors.confirm = "Passwords do not match";
  return errors;
};
