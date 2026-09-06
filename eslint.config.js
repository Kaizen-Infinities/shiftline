import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import {
  baseConfigs,
  baseRules,
  webLegacyRules,
  apiArchitectureRules,
} from "./packages/config/eslint.base.js";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/node_modules/**",
    "**/coverage/**",
    "apps/api/scripts/legacy/**",
  ]),
  // API and shared packages: Node
  {
    files: ["apps/api/**/*.ts", "packages/**/*.ts"],
    extends: baseConfigs,
    languageOptions: { globals: globals.node },
    rules: { ...baseRules },
  },
  {
    files: ["apps/api/src/**/*.ts"],
    ignores: [
      "apps/api/src/config/prisma.ts",
      "apps/api/src/lib/prisma.ts",
      "apps/api/src/lib/realtime.ts",
    ],
    rules: { ...apiArchitectureRules },
  },
  // Web: browser + React
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [...baseConfigs, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: { ...baseRules, ...webLegacyRules },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.node } },
    rules: { ...tseslint.configs.disableTypeChecked.rules },
  },
]);
