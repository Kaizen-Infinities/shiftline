import { defineConfig } from "vitest/config";

// Component tests arrive with the first Tailwind screens; until then the project exists so
// `npm test` covers every workspace.
export default defineConfig({
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.spec.{ts,tsx}"],
    passWithNoTests: true,
  },
});
