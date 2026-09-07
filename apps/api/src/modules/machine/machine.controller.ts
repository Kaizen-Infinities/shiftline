import { Request, Response } from "express";
import machineService from "./machine.service";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { emitToTenant } from "../../lib/realtime";
import { logger } from "../../lib/logger";

class MachineController {
  create = asyncHandler(async (req: Request, res: Response) => {
    const machine = await machineService.create(req.body);

    try {
      emitToTenant("machine:created", machine);
    } catch (err) {
      logger.error({ err: err }, "Socket emit error:");
    }

    return res.status(201).json(new ApiResponse("Machine created successfully", machine));
  });

  findAll = asyncHandler(async (req: Request, res: Response) => {
    const { search, page, limit } = req.query;
    const machines = await machineService.findAll({
      search: search as string | undefined,
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 15,
    });

    return res.status(200).json(new ApiResponse("Machines fetched successfully", machines));
  });

  findById = asyncHandler(async (req: Request, res: Response) => {
    const machine = await machineService.findById(String(req.params.machineId));

    return res.status(200).json(new ApiResponse("Machine fetched successfully", machine));
  });

  update = asyncHandler(async (req: Request, res: Response) => {
    const machine = await machineService.update(String(req.params.machineId), req.body);

    try {
      emitToTenant("machine:updated", machine);
    } catch (err) {
      logger.error({ err: err }, "Socket emit error:");
    }

    return res.status(200).json(new ApiResponse("Machine updated successfully", machine));
  });

  delete = asyncHandler(async (req: Request, res: Response) => {
    await machineService.delete(String(req.params.machineId));

    try {
      emitToTenant("machine:deleted", {
        id: req.params.machineId,
        machineId: req.params.machineId,
      });
    } catch (err) {
      logger.error({ err: err }, "Socket emit error:");
    }

    return res.status(200).json(new ApiResponse("Machine deleted successfully"));
  });

  getNextId = asyncHandler(async (_req: Request, res: Response) => {
    const nextCode = await machineService.getNextMachineId();
    return res
      .status(200)
      .json(new ApiResponse("Next machine ID generated successfully", { nextId: nextCode }));
  });
}

export default new MachineController();
