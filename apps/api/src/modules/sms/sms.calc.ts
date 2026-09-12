/**
 * The rules an Indian SMS has to obey before anybody tries to send it (P1-22).
 *
 * Kept apart from the database because each one is a rule a telecom operator enforces silently:
 * a message that breaks one is not rejected, it is simply never delivered, and nobody finds out
 * until a customer says they never got the code.
 */

// ── Numbers ───────────────────────────────────────────────────────────────────
/** Indian mobile numbers are ten digits and begin with 6, 7, 8 or 9. */
const TEN_DIGITS = /^[6-9]\d{9}$/;

/**
 * Any of the forms a number is typed in, reduced to ten digits. Returns null rather than a
 * guess: sending to a wrong number is worse than not sending.
 */
export const normaliseMobile = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  // Drop everything that is not a digit, then the trunk and ISD prefixes people type: 0, 00,
  // 0091, +91. What is left has to be ten digits beginning 6-9 or it is not a mobile number.
  const digits = String(raw)
    .replace(/\D/g, "")
    .replace(/^0+/, "")
    .replace(/^91(?=\d{10}$)/, "");
  return TEN_DIGITS.test(digits) ? digits : null;
};

// ── Segments ──────────────────────────────────────────────────────────────────
/**
 * The GSM 03.38 basic set. A character outside it forces the whole message into UCS-2, which
 * more than halves what fits — one stray curly quote turns a one-part message into three.
 */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** These cost two GSM-7 characters each: they are sent as an escape plus the character. */
const GSM7_EXTENDED = "^{}\\[~]|€";

export const isGsm7 = (text: string): boolean =>
  [...text].every((ch) => GSM7.includes(ch) || GSM7_EXTENDED.includes(ch));

/** Characters as the operator counts them, not as JavaScript counts them. */
export const gsm7Length = (text: string): number =>
  [...text].reduce((n, ch) => n + (GSM7_EXTENDED.includes(ch) ? 2 : 1), 0);

export interface Segmentation {
  encoding: "GSM7" | "UCS2";
  characters: number;
  segments: number;
}

/**
 * What a message will actually cost. A single part holds 160 GSM-7 characters or 70 Unicode
 * ones; once it splits, each part loses room to the header and holds 153 or 67.
 */
export const segmentsFor = (text: string): Segmentation => {
  const gsm = isGsm7(text);
  const characters = gsm ? gsm7Length(text) : [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = characters === 0 ? 1 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { encoding: gsm ? "GSM7" : "UCS2", characters, segments };
};

// ── Templates ─────────────────────────────────────────────────────────────────
/** DLT's own placeholder form, and the `{{name}}` form a person can actually read. */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export const variablesIn = (body: string): string[] => {
  const found: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
};

export class TemplateError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * A URL or a line break inside a variable is how a registered template gets used to send
 * something it was never registered for, and operators drop messages for exactly this. The
 * refusal is deliberate: the alternative is a template that passes review and then carries
 * whatever the caller feels like.
 */
const FORBIDDEN_IN_VALUE = /(https?:\/\/|www\.|[\r\n])/i;

/** The body with its variables filled in, or an error naming what is wrong. */
export const renderTemplate = (body: string, values: Record<string, string | number>): string => {
  const needed = variablesIn(body);
  for (const name of needed) {
    const value = values[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new TemplateError("MISSING_VARIABLE", `The template needs a value for ${name}`);
    }
    if (FORBIDDEN_IN_VALUE.test(String(value))) {
      throw new TemplateError(
        "UNSAFE_VARIABLE",
        `${name} cannot contain a link or a line break; the operator will drop the message`
      );
    }
  }
  return body.replace(PLACEHOLDER, (_m, name: string) => String(values[name]));
};

// ── One-time passwords ────────────────────────────────────────────────────────
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Codes per number per purpose inside the window below, before a request is refused. */
export const OTP_MAX_PER_WINDOW = 3;
export const OTP_WINDOW_MINUTES = 15;

/** The last two digits only, for the log: enough to recognise, useless to an attacker. */
export const maskCode = (code: string): string =>
  `${"*".repeat(Math.max(code.length - 2, 0))}${code.slice(-2)}`;
