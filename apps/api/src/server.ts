import dotenv from "dotenv";

dotenv.config();

import http from "http";
import app from "./app";
import { prisma } from "./config/prisma";
import { bootstrapAdmin } from "./utils/bootstrapAdmin";
import { initSocket } from "./socket/socket";
import { env } from "./config/env";
import { startJobs, stopJobs } from "./lib/jobs";
import { registerSchedules, registerWorkers } from "./jobs";

const PORT = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  try {
    await prisma.$connect();

    console.log("✅ Database connected successfully");

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
      console.log("⚙️  Embedded worker started (EMBED_WORKER=true)");
    }

    server.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\n⚠️ ${signal} received. Shutting down server...`);

      server.close(async () => {
        try {
          await stopJobs();
          await prisma.$disconnect();

          console.log("✅ Database disconnected");
          console.log("✅ Server stopped successfully");

          process.exit(0);
        } catch (error) {
          console.error("❌ Error during shutdown:", error);
          process.exit(1);
        }
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
