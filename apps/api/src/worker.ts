import dotenv from "dotenv";

dotenv.config();

import "./lib/bigint-json";
import { prisma } from "./config/prisma";
import { startJobs, stopJobs } from "./lib/jobs";
import { registerSchedules, registerWorkers } from "./jobs";

/**
 * Background worker entrypoint (`npm run worker -w @shiftline/api`). Runs the
 * pg-boss handlers and cron schedules; the API process does the same when
 * EMBED_WORKER=true so a single-process local run needs no second terminal.
 */
const main = async (): Promise<void> => {
  await prisma.$connect();
  await startJobs();
  await registerWorkers();
  await registerSchedules();
  // eslint-disable-next-line no-console
  console.log("⚙️  Worker started (pg-boss)");

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n⚠️ ${signal} received. Stopping worker...`);
    try {
      await stopJobs();
      await prisma.$disconnect();
      process.exit(0);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("❌ Error during worker shutdown:", error);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("❌ Failed to start worker:", error);
  process.exit(1);
});
