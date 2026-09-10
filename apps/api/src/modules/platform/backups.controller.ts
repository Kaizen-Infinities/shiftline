import { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { QUEUES, getBoss, isJobsStarted } from "../../lib/jobs";
import { runBackup } from "../../jobs/backup.job";
import { ApiResponse } from "../../utils/ApiResponse";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

/** Platform admins: backup history and an on-demand run. */
export const backupsController = {
  list: async (req: Request, res: Response) => {
    const { limit } = listQuery.parse(req.query);
    const runs = await prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
    res.json(
      new ApiResponse("Backups", {
        settings: { dir: env.BACKUP_DIR, keepDays: env.BACKUP_KEEP_DAYS },
        runs,
      })
    );
  },

  /** Enqueues the job when a worker is embedded, otherwise runs inline. */
  run: async (req: Request, res: Response) => {
    const triggeredBy = req.user?.userId ?? "admin";
    if (isJobsStarted()) {
      const jobId = await getBoss().send(
        QUEUES.BACKUP_DAILY,
        { triggeredBy },
        {
          singletonKey: "manual",
          singletonSeconds: 60,
        }
      );
      return res.status(202).json(new ApiResponse("Backup queued", { jobId }));
    }
    const result = await runBackup({ triggeredBy });
    res
      .status(201)
      .json(new ApiResponse("Backup completed", { ...result, runId: result.runId.toString() }));
  },
};
