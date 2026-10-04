import { api } from "./app";
import { getPrisma } from "./db";
import { asDemoTenant, createProduct, createRawMaterial } from "../factories";

/** The demo tenant's active shifts, earliest first (seeded; at least two exist). */
export const activeShifts = async () => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.shift.findMany({ where: { isActive: true }, orderBy: { startTime: "asc" } })
  );
};

/** A machine of its own, so planning tests never collide on a (machine, shift, day) slot. */
export const createMachine = async (machineId: string, over: Record<string, unknown> = {}) => {
  const prisma = await getPrisma();
  return asDemoTenant(() =>
    prisma.machine.create({
      data: { machineId, machineName: `Machine ${machineId}`, ...over },
    })
  );
};

/**
 * A production order created through the API (so it passes the same checks as in the app) and
 * ready for weekly scheduling: its raw material is in stock, so it lands on READY_FOR_PLANNING.
 */
export const createPlannableOrder = async (
  auth: Record<string, string>,
  productionOrderId: string,
  targetQty = 1000
) => {
  const product = await createProduct();
  const rm = await createRawMaterial();
  const res = await (
    await api()
  )
    .post("/api/production-orders")
    .set(auth)
    .send({
      productionOrderId,
      orderDate: "2026-09-01T00:00:00.000Z",
      dueDate: "2026-12-01T00:00:00.000Z",
      targetQty,
      uom: "PCS",
      productItemId: product.id.toString(),
      rawMaterials: [
        { rawMaterialId: rm.rawMaterialId, requiredQty: 10, uom: "KG", storeId: "ST-RM" },
      ],
    });
  if (res.status !== 201) {
    throw new Error(`production order setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { product, rm, order: res.body.data as { productionOrderId: string; status: string } };
};

/** Assigns one active operator to a machine/shift for a date range, as the assignment screen does. */
export const assignOperator = async (opts: {
  machineId: string;
  shiftCode: string;
  employeeId: bigint;
  weekStartDate: string;
  weekEndDate: string;
}) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { code: "PRODUCTION" } });
    return prisma.machineOperationAssignment.create({
      data: {
        machineId: opts.machineId,
        shiftId: opts.shiftCode,
        weekStartDate: new Date(opts.weekStartDate),
        weekEndDate: new Date(opts.weekEndDate),
        isActive: true,
        operators: { create: [{ roleId: role.id, employeeId: opts.employeeId }] },
      },
    });
  });
};
