import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/api/vitest.config.mts",
      "packages/shared/vitest.config.mts",
      "apps/web/vitest.config.mts",
    ],
    coverage: { provider: "v8", reporter: ["text", "lcov"], reportsDirectory: "coverage" },
  },
});
