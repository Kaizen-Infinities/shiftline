import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["test/**/*.spec.ts"],
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each worker gets its own database cloned from a template (see test/setup.ts).
    pool: "forks",
    maxWorkers: 4,
    sequence: { groupOrder: 1 },
  },
});
