import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createGatewaySchema,
  listCyclesSchema,
  listSignalsSchema,
  machineTelemetryService,
  replaceSignalMapSchema,
  updateGatewaySchema,
} from "./machine-telemetry.service";

const idParam = z.string().uuid();
const actorOf = (req: Request) => ({ userId: req.user?.userId });

/** /api/machine-gateways (P2-01): gateway CRUD, test-connection, signal map. */
export const machineGatewayRoutes = Router();
machineGatewayRoutes.use(authMiddleware);

machineGatewayRoutes.get(
  "/",
  requirePermission("machine-telemetry.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Machine gateways", await machineTelemetryService.listGateways()));
  })
);
machineGatewayRoutes.post(
  "/",
  requirePermission("machine-telemetry.configure"),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await machineTelemetryService.createGateway(
      createGatewaySchema.parse(req.body),
      actorOf(req)
    );
    res.status(201).json(new ApiResponse("Gateway created", row));
  })
);
machineGatewayRoutes.get(
  "/:id",
  requirePermission("machine-telemetry.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Gateway",
        await machineTelemetryService.getGateway(idParam.parse(req.params.id))
      )
    );
  })
);
machineGatewayRoutes.put(
  "/:id",
  requirePermission("machine-telemetry.configure"),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await machineTelemetryService.updateGateway(
      idParam.parse(req.params.id),
      updateGatewaySchema.parse(req.body),
      actorOf(req)
    );
    res.json(new ApiResponse("Gateway updated", row));
  })
);
machineGatewayRoutes.delete(
  "/:id",
  requirePermission("machine-telemetry.configure"),
  asyncHandler(async (req: Request, res: Response) => {
    await machineTelemetryService.deleteGateway(idParam.parse(req.params.id));
    res.json(new ApiResponse("Gateway deleted"));
  })
);
machineGatewayRoutes.post(
  "/:id/test-connection",
  requirePermission("machine-telemetry.ingest"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Connection test",
        await machineTelemetryService.testConnection(idParam.parse(req.params.id))
      )
    );
  })
);
machineGatewayRoutes.get(
  "/:id/signal-map",
  requirePermission("machine-telemetry.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Signal map",
        await machineTelemetryService.listSignalMap(idParam.parse(req.params.id))
      )
    );
  })
);
machineGatewayRoutes.put(
  "/:id/signal-map",
  requirePermission("machine-telemetry.configure"),
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await machineTelemetryService.replaceSignalMap(
      idParam.parse(req.params.id),
      replaceSignalMapSchema.parse(req.body)
    );
    res.json(new ApiResponse("Signal map updated", rows));
  })
);

/** /api/machine-telemetry (P2-01): recent signals, cycles, gateway health, canonical signals. */
export const machineTelemetryRoutes = Router();
machineTelemetryRoutes.use(authMiddleware);

machineTelemetryRoutes.get(
  "/canonical-signals",
  requirePermission("machine-telemetry.view"),
  (_req, res) => {
    res.json(new ApiResponse("Canonical signals", machineTelemetryService.canonicalSignals()));
  }
);
machineTelemetryRoutes.get(
  "/signals",
  requirePermission("machine-telemetry.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Recent signals",
        await machineTelemetryService.recentSignals(listSignalsSchema.parse(req.query))
      )
    );
  })
);
machineTelemetryRoutes.get(
  "/cycles",
  requirePermission("machine-telemetry.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Cycles",
        await machineTelemetryService.listCycles(listCyclesSchema.parse(req.query))
      )
    );
  })
);
machineTelemetryRoutes.get(
  "/health",
  requirePermission("machine-telemetry.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Gateway health", await machineTelemetryService.gatewayHealth()));
  })
);
