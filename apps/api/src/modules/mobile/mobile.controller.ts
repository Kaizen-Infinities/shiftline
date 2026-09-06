import { Request, Response } from "express";

import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { getCurrentCompany } from "../../utils/companyContext";
import { receivableService } from "../accounts/receivable.service";
import { MAX_ATTACHMENT_BYTES, activeDriver, storeAttachment } from "./mobile.attachment.service";
import { mobileCollectionService } from "./mobile.collection.service";
import { mobileDeviceService } from "./mobile.device.service";
import { chequeOcrEnabled, readCheque } from "./mobile.ocr.service";
import { mobileOrderStatus } from "./mobile.order.service";
import { mobilePositionService } from "./mobile.position.service";
import { mobileSyncService } from "./mobile.sync.service";
import {
  AgentContext,
  PAYMENT_MODES,
  SyncWarning,
  createRouteSchema,
  listCollectionsQuerySchema,
  listDevicesQuerySchema,
  listVisitsQuerySchema,
  planVisitsSchema,
  positionsBodySchema,
  positionsQuerySchema,
  pullQuerySchema,
  pushBodySchema,
  setRouteAssignmentsSchema,
  setRouteCustomersSchema,
  uuidParamSchema,
} from "./mobile.types";
import { mobileVisitService } from "./mobile.visit.service";

/** Resolve the JWT user into the agent identity used for all mobile records. */
async function agentFromRequest(req: Request): Promise<AgentContext> {
  const jwtUser = req.user;
  if (!jwtUser?.userId) throw new ApiError(401, "Unauthorized");
  const isSuperAdmin = !!jwtUser.isSuperAdmin || jwtUser.userId.startsWith("admin_");

  if (isSuperAdmin) {
    const admin = await prisma.admin.findUnique({
      where: { id: BigInt(jwtUser.userId.replace("admin_", "")) },
      select: { fullName: true, email: true },
    });
    return {
      userId: jwtUser.userId,
      fullName: admin?.fullName || "Platform admin",
      email: admin?.email ?? jwtUser.email,
      employeeId: null,
      isSuperAdmin: true,
      permissions: jwtUser.permissions || [],
    };
  }

  const user = await prisma.user.findUnique({
    where: { userId: jwtUser.userId },
    select: { fullName: true, email: true, employeeId: true },
  });
  return {
    userId: jwtUser.userId,
    fullName: user?.fullName || jwtUser.email,
    email: user?.email ?? jwtUser.email,
    employeeId: user?.employeeId ?? null,
    isSuperAdmin: false,
    permissions: jwtUser.permissions || [],
  };
}

/**
 * Reads the device headers, registers/refreshes the device and refuses
 * revoked ones. `required` is true for writes (push, positions).
 */
async function deviceFromRequest(
  req: Request,
  agent: AgentContext,
  opts: { required: boolean; sync?: boolean }
) {
  const info = mobileDeviceService.fromRequest(req, opts.required);
  if (info) await mobileDeviceService.touch(agent, info, { sync: opts.sync });
  const warnings: SyncWarning[] = [];
  const skew = mobileDeviceService.clockSkewWarning(info);
  if (skew) warnings.push(skew);
  return { info, warnings };
}

class MobileController {
  /** Everything the app needs right after login. */
  bootstrap = asyncHandler(async (req: Request, res: Response) => {
    const agent = await agentFromRequest(req);
    const { info, warnings } = await deviceFromRequest(req, agent, { required: false });
    const company = await getCurrentCompany();
    res.json(
      new ApiResponse("Mobile bootstrap", {
        agent: {
          userId: agent.userId,
          fullName: agent.fullName,
          email: agent.email,
          employeeId: agent.employeeId ? agent.employeeId.toString() : null,
          isSuperAdmin: agent.isSuperAdmin,
          permissions: agent.permissions,
        },
        company: {
          id: company.id,
          companyName: company.companyName,
          shortName: company.shortName,
          logoUrl: company.logoUrl,
          currencyCode: company.currencyCode,
          phone: company.phone,
          email: company.email,
        },
        device: info ? { deviceId: info.deviceId } : null,
        settings: {
          orderStatusOnSubmit: await mobileOrderStatus(),
          paymentModes: PAYMENT_MODES,
          chequeOcrEnabled: chequeOcrEnabled(),
          attachmentStorage: activeDriver(),
          maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
          tombstoneDays: 30,
          deviceHeaders: [
            "x-device-id",
            "x-app-version",
            "x-device-platform",
            "x-device-model",
            "x-device-time",
          ],
        },
        warnings,
        serverTime: Date.now(),
      })
    );
  });

  pull = asyncHandler(async (req: Request, res: Response) => {
    const agent = await agentFromRequest(req);
    await deviceFromRequest(req, agent, { required: false, sync: true });
    const q = pullQuerySchema.parse(req.query);
    const result = await mobileSyncService.pull(agent, q.lastPulledAt, q.full);
    res.json(result);
  });

  push = asyncHandler(async (req: Request, res: Response) => {
    const agent = await agentFromRequest(req);
    const { info, warnings } = await deviceFromRequest(req, agent, { required: true, sync: true });
    const body = pushBodySchema.parse(req.body);
    const results = await mobileSyncService.push(agent, body, info, warnings);
    res.json({ success: true, results });
  });

  uploadAttachment = asyncHandler(async (req: Request, res: Response) => {
    const agent = await agentFromRequest(req);
    await deviceFromRequest(req, agent, { required: false });
    const file = req.file;
    if (!file) throw new ApiError(400, "No file uploaded (field name: file)");
    const kind = String(req.body?.kind || "OTHER").toUpperCase();
    const collectionId = String(req.body?.collectionId || "unfiled").replace(/[^a-zA-Z0-9-]/g, "");
    const stored = await storeAttachment(file, `collections/${collectionId}/${kind.toLowerCase()}`);
    res.status(201).json(new ApiResponse("Attachment stored", { kind, collectionId, ...stored }));
  });

  chequeOcr = asyncHandler(async (req: Request, res: Response) => {
    await agentFromRequest(req);
    const file = req.file;
    if (!file) throw new ApiError(400, "No image uploaded (field name: image)");
    const fields = await readCheque(
      file.buffer,
      file.mimetype,
      new Date().toISOString().slice(0, 10)
    );
    res.json(new ApiResponse("Cheque read", fields));
  });

  /** Online drill-down: full ledger view for one customer (invoices + receipts). */
  customerStatement = asyncHandler(async (req: Request, res: Response) => {
    await agentFromRequest(req);
    const { id } = uuidParamSchema.parse(req.params);
    const detail = await receivableService.getCustomerReceivableDetail(id);
    res.json(
      new ApiResponse("Customer statement", {
        customer: detail.customer,
        summary: detail.summary,
        invoices: detail.invoices,
        collectionHistory: detail.collectionHistory,
      })
    );
  });

  /** Position feed (A5): a batch of GPS points from one device. */
  positions = asyncHandler(async (req: Request, res: Response) => {
    const agent = await agentFromRequest(req);
    const { info, warnings } = await deviceFromRequest(req, agent, { required: true });
    const { positions } = positionsBodySchema.parse(req.body);
    const result = await mobilePositionService.record(agent, info!, positions);
    res.status(201).json({ success: true, ...result, warnings, serverTime: Date.now() });
  });

  // ─── Office / admin ────────────────────────────────────────────────────────

  latestPositions = asyncHandler(async (req: Request, res: Response) => {
    const q = positionsQuerySchema.parse(req.query);
    res.json(
      new ApiResponse("Field positions", await mobilePositionService.latest(q.withinMinutes))
    );
  });

  listDevices = asyncHandler(async (req: Request, res: Response) => {
    const q = listDevicesQuerySchema.parse(req.query);
    res.json(new ApiResponse("Devices", await mobileDeviceService.list(q)));
  });

  revokeDevice = asyncHandler(async (req: Request, res: Response) => {
    const { id } = uuidParamSchema.parse(req.params);
    res.json(
      new ApiResponse("Device revoked", await mobileDeviceService.revoke(id, req.user?.userId))
    );
  });

  restoreDevice = asyncHandler(async (req: Request, res: Response) => {
    const { id } = uuidParamSchema.parse(req.params);
    res.json(new ApiResponse("Device restored", await mobileDeviceService.restore(id)));
  });

  listAgents = asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Field agents", await mobileVisitService.listAgents()));
  });

  listRoutes = asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Routes", await mobileVisitService.listRoutes()));
  });

  createRoute = asyncHandler(async (req: Request, res: Response) => {
    const data = createRouteSchema.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Route created", await mobileVisitService.createRoute(data)));
  });

  setRouteCustomers = asyncHandler(async (req: Request, res: Response) => {
    const { id } = uuidParamSchema.parse(req.params);
    const { customers } = setRouteCustomersSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "Route customers updated",
        await mobileVisitService.setRouteCustomers(id, customers)
      )
    );
  });

  setRouteAssignments = asyncHandler(async (req: Request, res: Response) => {
    const { id } = uuidParamSchema.parse(req.params);
    const { assignments } = setRouteAssignmentsSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "Route assignments updated",
        await mobileVisitService.setRouteAssignments(id, assignments)
      )
    );
  });

  planVisits = asyncHandler(async (req: Request, res: Response) => {
    const input = planVisitsSchema.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Visits planned", await mobileVisitService.planVisits(input)));
  });

  listVisits = asyncHandler(async (req: Request, res: Response) => {
    const q = listVisitsQuerySchema.parse(req.query);
    res.json(new ApiResponse("Visits", await mobileVisitService.listVisits(q)));
  });

  listCollections = asyncHandler(async (req: Request, res: Response) => {
    const q = listCollectionsQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.agentUserId) where.agentUserId = q.agentUserId;
    if (q.customerId) where.customerId = q.customerId;
    if (q.status) where.status = q.status.toUpperCase();
    if (q.from || q.to) {
      where.collectedAt = {
        ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
        ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      prisma.mobileCollection.findMany({
        where,
        orderBy: { collectedAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { customer: { select: { id: true, customerCode: true, firmName: true } } },
      }),
      prisma.mobileCollection.count({ where }),
    ]);
    const agentIds = [...new Set(rows.map((r) => r.agentUserId))].filter(
      (id) => !id.startsWith("admin_")
    );
    const agents = agentIds.length
      ? await prisma.user.findMany({
          where: { userId: { in: agentIds } },
          select: { userId: true, fullName: true },
        })
      : [];
    const agentName = new Map(agents.map((a) => [a.userId, a.fullName]));
    res.json(
      new ApiResponse("Mobile collections", {
        data: rows.map((r) => ({
          ...r,
          agentName:
            agentName.get(r.agentUserId) ||
            (r.agentUserId.startsWith("admin_") ? "Platform admin" : r.agentUserId),
        })),
        total,
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.ceil(total / q.pageSize),
      })
    );
  });

  repostCollection = asyncHandler(async (req: Request, res: Response) => {
    const { id } = uuidParamSchema.parse(req.params);
    const posted = await mobileCollectionService.repost(id);
    res.json(new ApiResponse("Collection posted", posted));
  });
}

export const mobileController = new MobileController();
