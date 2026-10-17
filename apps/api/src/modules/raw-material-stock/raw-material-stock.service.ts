import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  CreateRawMaterialStockInput,
  UpdateRawMaterialStockInput,
} from "./raw-material-stock.validation";
import { byCode } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";

class RawMaterialStockService {
  async create(data: CreateRawMaterialStockInput) {
    // Verify store exists
    const store = await prisma.store.findUnique({
      where: byCode("storeId", data.storeId),
    });
    if (!store) {
      throw new ApiError(404, `Store with ID ${data.storeId} not found`);
    }

    // Verify raw material exists
    const rawMaterial = await prisma.rawMaterial.findUnique({
      where: byCode("rawMaterialId", data.rawMaterialId),
    });
    if (!rawMaterial) {
      throw new ApiError(404, `Raw Material with ID ${data.rawMaterialId} not found`);
    }

    // In the updated schema, raw material stock is part of the RawMaterial model itself
    return prisma.rawMaterial.update({
      where: byCode("rawMaterialId", data.rawMaterialId),
      data: {
        storeId: data.storeId,
        locationId: data.locationId ?? rawMaterial.locationId,
        batchNo: data.batchNo ?? rawMaterial.batchNo,
        onHandQty: {
          increment: data.onHandQty ?? 0,
        },
        reservedQty: {
          increment: data.reservedQty ?? 0,
        },
        status: data.status ?? rawMaterial.status,
        narration: data.remarks ?? rawMaterial.narration,
        lastMovementAt: new Date(),
      },
      include: {
        store: true,
      },
    });
  }

  async findAll(query?: {
    search?: string;
    storeId?: string;
    storeCategory?: string;
    itemType?: string;
    categoryId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const whereClause: any = {};
    const andConditions: any[] = [];

    if (query?.storeId) {
      andConditions.push({ storeId: query.storeId });
    }
    if (query?.storeCategory) {
      andConditions.push({ store: { storeCategory: query.storeCategory } });
    }
    if (query?.itemType) {
      if (query.itemType === "RAW_MATERIAL") {
        andConditions.push({
          OR: [{ itemType: "RAW_MATERIAL" }, { itemType: null }],
        });
      } else {
        andConditions.push({ itemType: query.itemType });
      }
    }
    if (query?.categoryId) {
      andConditions.push({ categoryId: Number(query.categoryId) });
    }
    if (query?.status) {
      andConditions.push({ status: query.status });
    }
    if (query?.search) {
      andConditions.push({
        OR: [
          { materialName: { contains: query.search, mode: "insensitive" } },
          { rawMaterialId: { contains: query.search, mode: "insensitive" } },
          { batchNo: { contains: query.search, mode: "insensitive" } },
        ],
      });
    }

    if (andConditions.length > 0) {
      whereClause.AND = andConditions;
    }

    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;

    const [stockItems, total] = await Promise.all([
      prisma.rawMaterial.findMany({
        where: whereClause,
        include: {
          store: { include: { location: true } },
          category: true,
          storeLocation: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.rawMaterial.count({ where: whereClause }),
    ]);

    return {
      data: stockItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const stock = await prisma.rawMaterial.findUnique({
      where: byCode("rawMaterialId", id),
      include: {
        store: true,
        category: true,
      },
    });

    if (!stock) {
      throw new ApiError(404, `Raw Material with ID ${id} not found`);
    }

    return stock;
  }

  async update(id: string, data: UpdateRawMaterialStockInput) {
    // The update sets absolute quantities, so lock the row for the transaction: the values we merge
    // with are the committed ones and no concurrent movement lands between read and write.
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM raw_materials
        WHERE company_id = ${requireTenantId()}::uuid AND raw_material_id = ${id}
        FOR UPDATE`;
      const existing = await tx.rawMaterial.findUnique({
        where: byCode("rawMaterialId", id),
      });
      if (!existing) {
        throw new ApiError(404, `Raw Material with ID ${id} not found`);
      }

      return tx.rawMaterial.update({
        where: byCode("rawMaterialId", id),
        data: {
          onHandQty: data.onHandQty ?? existing.onHandQty,
          reservedQty: data.reservedQty ?? existing.reservedQty,
          locationId: data.locationId ?? existing.locationId,
          batchNo: data.batchNo ?? existing.batchNo,
          status: data.status ?? existing.status,
          narration: data.remarks ?? existing.narration,
          lastMovementAt: new Date(),
        },
        include: {
          store: true,
        },
      });
    });
  }

  async delete(id: string) {
    await this.findById(id);

    // Instead of deleting the raw material, we zero out its stock fields
    return prisma.rawMaterial.update({
      where: byCode("rawMaterialId", id),
      data: {
        onHandQty: 0,
        reservedQty: 0,
        lastMovementAt: new Date(),
      },
    });
  }
  async deductForPurchaseReturn(
    items: { rawMaterialId: string; quantity: number; storeId: string }[],
    refDocNo: string,
    txClient?: any
  ) {
    const db = txClient || prisma;
    for (const item of items) {
      // Atomic guard: the decrement only matches while enough stock is on hand.
      const res = await db.rawMaterial.updateMany({
        where: { rawMaterialId: item.rawMaterialId, onHandQty: { gte: item.quantity } },
        data: {
          onHandQty: { decrement: item.quantity },
          lastMovementAt: new Date(),
        },
      });

      if (res.count === 0) {
        const rawMaterial = await db.rawMaterial.findFirst({
          where: { rawMaterialId: item.rawMaterialId },
        });
        if (!rawMaterial) {
          throw new ApiError(404, `Raw material ${item.rawMaterialId} not found`);
        }
        throw new ApiError(
          400,
          `Insufficient stock for raw material ${item.rawMaterialId} (current on-hand: ${Number(rawMaterial.onHandQty || 0)}, attempted return: ${item.quantity})`
        );
      }

      // Log RawMaterialTransaction audit entry
      await db.rawMaterialTransaction.create({
        data: {
          storeId: item.storeId,
          rawMaterialId: item.rawMaterialId,
          txnType: "PURCHASE_RETURN_OUT",
          qty: item.quantity,
          txnDateTime: new Date(),
          remarks: `Deducted ${item.quantity} units for Purchase Return ${refDocNo}`,
        },
      });
    }
  }
}

export default new RawMaterialStockService();
