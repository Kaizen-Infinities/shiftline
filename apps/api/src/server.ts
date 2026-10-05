import dotenv from "dotenv";

dotenv.config();

import http from "http";
import app from "./app";
import { prisma } from "./config/prisma";
import { flushSentry, initSentry } from "./lib/sentry";
import { bootstrapAdmin } from "./utils/bootstrapAdmin";
import { initSocket } from "./socket/socket";
import { env } from "./config/env";
import { startJobs, stopJobs } from "./lib/jobs";
import { registerSchedules, registerWorkers } from "./jobs";
import { logger } from "./lib/logger";
import { closePdfBrowser } from "./utils/pdfGenerator";

const PORT = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  try {
    initSentry("shiftline-api");
    await prisma.$connect();

    logger.info("✅ Database connected successfully");

    // Automatically create admin user from .env variables.
    // Returns true only on a fresh install (DB was empty).
    await bootstrapAdmin(prisma);

    const server = http.createServer(app);

    initSocket(server);

    // Background jobs normally run in the worker process (src/worker.ts);
    // EMBED_WORKER=true runs them here for single-process local runs.
    if (env.EMBED_WORKER) {
      await startJobs();
      await registerWorkers();
      await registerSchedules();
      logger.info("⚙️  Embedded worker started (EMBED_WORKER=true)");
    }

    server.listen(PORT, () => {
      logger.info(`🚀 Server is running on http://localhost:${PORT}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`\n⚠️ ${signal} received. Shutting down server...`);

      server.close(async () => {
        try {
          await stopJobs();
          await closePdfBrowser();
          await prisma.$disconnect();
          await flushSentry();

          logger.info("✅ Database disconnected");
          logger.info("✅ Server stopped successfully");

          process.exit(0);
        } catch (error) {
          logger.error({ err: error }, "❌ Error during shutdown:");
          process.exit(1);
        }
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error({ err: error }, "❌ Failed to start server:");
    process.exit(1);
  }
};

startServer();
