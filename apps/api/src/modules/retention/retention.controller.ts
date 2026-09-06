import { Request, Response } from "express";
import { RetentionDataClass } from "@prisma/client";

import { retentionService } from "./retention.service";
import type { RunSweepInput, UpsertPolicyInput } from "./retention.validation";

export const retentionController = {
  listPolicies: async (_req: Request, res: Response) => {
    const data = await retentionService.listPolicies();
    res.status(200).json({ success: true, data });
  },

  upsertPolicy: async (req: Request, res: Response) => {
    const dataClass = req.params.dataClass as RetentionDataClass;
    const data = await retentionService.upsertPolicy(
      dataClass,
      req.body as UpsertPolicyInput,
      req.user?.userId
    );
    res.status(200).json({ success: true, data });
  },

  runSweep: async (req: Request, res: Response) => {
    const body = req.body as RunSweepInput;
    const data = await retentionService.runSweep({ ...body, triggeredBy: req.user?.userId });
    res.status(200).json({ success: true, data });
  },

  listSweeps: async (req: Request, res: Response) => {
    const { limit, dataClass } = req.query as unknown as {
      limit: number;
      dataClass?: RetentionDataClass;
    };
    const data = await retentionService.listSweeps(limit, dataClass);
    res.status(200).json({ success: true, data });
  },
};
