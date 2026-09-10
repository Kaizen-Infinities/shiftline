import { ApiError } from "../../utils/ApiError";
import { Request, Response, NextFunction } from "express";
import { pettyCashService } from "./petty-cash.service";
import { createPettyCashSchema, getPettyCashQuerySchema } from "./petty-cash.types";

class PettyCashController {
  async getEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const query = getPettyCashQuerySchema.parse(req.query);
      const data = await pettyCashService.getEntries(query);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async createEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createPettyCashSchema.parse(req.body);
      const createdBy = (req as any).user?.id || (req as any).user?.userId;
      const data = await pettyCashService.createEntry(input, createdBy);
      return res.status(201).json({ success: true, message: "Petty cash entry created", data });
    } catch (error) {
      next(error);
    }
  }

  async cancelEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id)) throw new ApiError(400, "Invalid entry id");
      const reason =
        typeof req.body?.reason === "string"
          ? req.body.reason
          : (req.query.reason as string | undefined);
      const data = await pettyCashService.cancelEntry(
        id,
        { userId: (req as any).user?.userId, isSuperAdmin: !!(req as any).user?.isSuperAdmin },
        reason
      );
      return res.status(200).json({ success: true, message: "Petty cash entry cancelled", data });
    } catch (error) {
      next(error);
    }
  }
}

export const pettyCashController = new PettyCashController();
