// Shared ESLint flat-config fragments for Shiftline workspaces.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Rules every workspace gets. */
export const baseConfigs = [js.configs.recommended, ...tseslint.configs.recommended];

export const baseRules = {
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/no-require-imports": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  // Legacy-style findings in the imported code: warnings until the module is touched.
  "no-useless-assignment": "warn",
  "@typescript-eslint/ban-ts-comment": "warn",
  "@typescript-eslint/no-empty-object-type": "warn",
  "@typescript-eslint/no-unused-expressions": "warn",
  "no-case-declarations": "warn",
  "no-prototype-builtins": "warn",
  "prefer-const": "warn",
  "no-useless-escape": "warn",
  "no-constant-binary-expression": "warn",
  "preserve-caught-error": "warn",
};

/**
 * Architecture rules for the API. Some start as warnings because the codebase
 * still violates them; each is flipped to "error" by the package that fixes it
 * (P0-10 for realtime, P0-13 for logging).
 */
/** React Compiler lint rules: warnings in the imported UI until each screen is touched. */
export const webLegacyRules = {
  "react-refresh/only-export-components": "warn",
  "react-hooks/immutability": "warn",
  "react-hooks/refs": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/preserve-manual-memoization": "warn",
  "react-hooks/set-state-in-effect": "off",
};

export const apiArchitectureRules = {
  // Only lib/prisma.ts (config/prisma.ts until P0-07) may construct a client.
  "no-restricted-syntax": [
    "error",
    {
      selector: "NewExpression[callee.name='PrismaClient']",
      message: "Import { prisma } from the shared client instead of constructing PrismaClient.",
    },
    {
      selector: "TemplateElement[value.raw=/\\bSET\\s+(SESSION\\s+)?app\\./i]",
      message:
        "Never SET session-scoped app.* variables; use set_config(..., true) inside a transaction.",
    },
    {
      selector: "Literal[value=/\\bSET\\s+(SESSION\\s+)?app\\./i]",
      message:
        "Never SET session-scoped app.* variables; use set_config(..., true) inside a transaction.",
    },
  ],
  // Sockets emit per tenant through lib/realtime.ts; only it may touch the io server.
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: ["**/socket/socket", "**/socket/socket.js"],
          importNames: ["getIO"],
          message:
            "Use emitToTenant() from lib/realtime instead of getIO(); a bare emit broadcasts across tenants.",
        },
        {
          group: ["node-cron"],
          message: "Schedule work through pg-boss (lib/jobs.ts, src/jobs/), not in-process cron.",
        },
      ],
    },
  ],
  // Structured logging arrives in P0-13; until then console is a warning.
  "no-console": "warn",
};
