import dotenv from "dotenv";

dotenv.config();

import "./lib/bigint-json";
import { prisma } from "./config/prisma";
import { flushSentry, initSentry } from "./lib/sentry";
import { startJobs, stopJobs } from "./lib/jobs";
import { registerSchedules, registerWorkers } from "./jobs";
import { logger } from "./lib/logger";
import { closePdfBrowser } from "./utils/pdfGenerator";

/**
 * Background worker entrypoint (`npm run worker -w @shiftline/api`). Runs the
 * pg-boss handlers and cron schedules; the API process does the same when
 * EMBED_WORKER=true so a single-process local run needs no second terminal.
 */
const main = async (): Promise<void> => {
  initSentry("shiftline-worker");
  await prisma.$connect();
  await startJobs();
  await registerWorkers();
  await registerSchedules();
  logger.info("⚙️  Worker started (pg-boss)");

  const shutdown = async (signal: string) => {
    logger.info(`\n⚠️ ${signal} received. Stopping worker...`);
    try {
      await stopJobs();
      await closePdfBrowser();
      await prisma.$disconnect();
      await flushSentry();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "❌ Error during worker shutdown:");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

main().catch((error) => {
  logger.error({ err: error }, "❌ Failed to start worker:");
  process.exit(1);
});
