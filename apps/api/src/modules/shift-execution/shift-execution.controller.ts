import { NextFunction, Request, Response } from "express";
import shiftExecutionService from "./shift-execution.service";

class ShiftExecutionController {
  supervisorOverride = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await shiftExecutionService.verifySupervisor(req.body, {
        userId: req.user!.userId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? undefined,
      });
      res.status(200).json({ success: true, message: "Supervisor mode unlocked", data });
    } catch (error) {
      next(error);
    }
  };
}

export default new ShiftExecutionController();
