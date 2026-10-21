import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import {
  CreateProductionWastageInput,
  UpdateProductionWastageInput,
} from "./production-wastage.validation";
import { byCode } from "../../lib/prisma";
import { valuationService } from "../costing/valuation.service";

/** A named target wastage product must exist; checked here so the 400 names the field on every engine. */
const assertTargetWastageProduct = async (id: string | null | undefined) => {
  if (!id) return;
  const target = await prisma.rawMaterial.findUnique({ where: byCode("rawMaterialId", id) });
  if (!target) {
    throw new ApiError(400, `Invalid targetWastageProductId: no wastage product ${id} exists.`);
  }
};

class ProductionWastageService {
  private async enrichWithApprovedByUser(wastage: any) {
    if (!wastage || !wastage.approvedBy) return wastage;
    const user = await prisma.user.findUnique({
      where: { userId: wastage.approvedBy },
      select: { userId: true, fullName: true, username: true },
    });
    return { ...wastage, approvedByUser: user ?? null };
  }

  private async enrichManyWithApprovedByUser(wastages: any[]) {
    const userIds = [...new Set(wastages.map((w: any) => w.approvedBy).filter(Boolean))];
    if (userIds.length === 0) return wastages;
    const users = await prisma.user.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, fullName: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.userId, u]));
    return wastages.map((w: any) => ({
      ...w,
      approvedByUser: w.approvedBy ? (userMap.get(w.approvedBy) ?? null) : null,
    }));
  }

  private async generateWastageNo(): Promise<string> {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const prefix = `WST-${yyyy}${mm}${dd}`;

    // Find the last record created today
    const lastWastage = await prisma.productionWastage.findFirst({
      where: {
        wastageNo: {
          startsWith: prefix,
        },
      },
      orderBy: {
        wastageNo: "desc",
      },
    });

    let nextSeq = 1;
    if (lastWastage) {
      const lastSeqStr = lastWastage.wastageNo.split("-").pop();
      if (lastSeqStr) {
        nextSeq = parseInt(lastSeqStr, 10) + 1;
      }
    }

    const seqStr = String(nextSeq).padStart(4, "0");
    return `${prefix}-${seqStr}`;
  }

  async create(data: CreateProductionWastageInput, userId: string) {
    // A log is always born DRAFT. Approval runs the valuation and target-stock postings in
    // approve(); a row created as APPROVED would skip them.
    if (data.status && data.status !== "DRAFT") {
      throw new ApiError(400, "A wastage log is created as DRAFT and approved separately");
    }

    const [yyyy, mm, dd] = data.wastageDate.split("-").map(Number);
    const wDate = new Date(Date.UTC(yyyy, mm - 1, dd));

    // 1. Verify Production Order
    const po = await prisma.productionOrder.findUnique({
      where: byCode("productionOrderId", data.productionOrderId),
    });
    if (!po) {
      throw new ApiError(404, `Production Order with ID ${data.productionOrderId} not found`);
    }

    // 1b. Verify no duplicate wastage for this Production Order and Shift on this date
    const existingWastage = await prisma.productionWastage.findFirst({
      where: {
        productionOrderId: data.productionOrderId,
        shiftId: data.shiftId,
        wastageDate: wDate,
      },
    });
    if (existingWastage) {
      throw new ApiError(409, `A wastage log already exists for this shift on ${data.wastageDate}`);
    }

    // 2. Verify Machine
    const machine = await prisma.machine.findUnique({
      where: byCode("machineId", data.machineId),
    });
    if (!machine) {
      throw new ApiError(404, `Machine with ID ${data.machineId} not found`);
    }

    // 3. Verify Shift
    const shift = await prisma.shift.findUnique({
      where: byCode("shiftCode", data.shiftId),
    });
    if (!shift) {
      throw new ApiError(404, `Shift with Code ${data.shiftId} not found`);
    }

    // 4. Verify Product
    const product = await prisma.product.findUnique({
      where: { id: BigInt(data.productId) },
    });
    if (!product) {
      throw new ApiError(404, `Product with ID ${data.productId} not found`);
    }

    // 5. Verify Raw Material (Optional)
    if (data.rawMaterialId) {
      const rm = await prisma.rawMaterial.findUnique({
        where: byCode("rawMaterialId", data.rawMaterialId),
      });
      if (!rm) {
        throw new ApiError(404, `Raw Material with ID ${data.rawMaterialId} not found`);
      }
    }

    // 6. Verify target wastage product (optional)
    await assertTargetWastageProduct(data.targetWastageProductId);

    // Calculate Estimated Value if not provided
    let finalEstimatedValue = data.estimatedValue ?? null;
    if (finalEstimatedValue === null) {
      if (data.rawMaterialId) {
        const rm = await prisma.rawMaterial.findUnique({
          where: byCode("rawMaterialId", data.rawMaterialId),
        });
        if (rm?.rate) {
          finalEstimatedValue = Number(rm.rate) * data.quantity;
        }
      } else {
        if ((product as any)?.unitPrice) {
          finalEstimatedValue = Number((product as any).unitPrice) * data.quantity;
        }
      }
    }

    const wastageNo = await this.generateWastageNo();

    return prisma.productionWastage.create({
      data: {
        wastageNo,
        wastageDate: wDate,
        productionOrderId: data.productionOrderId,
        hourlyProductionId: data.hourlyProductionId ? BigInt(data.hourlyProductionId) : null,
        machineId: data.machineId,
        shiftId: data.shiftId,
        productId: BigInt(data.productId),
        rawMaterialId: data.rawMaterialId ?? null,
        targetWastageProductId: data.targetWastageProductId ?? null,
        storeId: data.storeId ?? null,
        wastageType: data.wastageType as any,
        quantity: data.quantity,
        uom: data.uom,
        estimatedValue: finalEstimatedValue,
        reason: data.reason ?? null,
        correctiveAction: data.correctiveAction ?? null,
        remarks: data.remarks ?? null,
        isRecyclable: data.isRecyclable ?? false,
        sentForRework: data.sentForRework ?? false,
        status: "DRAFT",
        createdBy: userId,
        categoryId: data.categoryId ?? null,
      },
      include: {
        productionOrder: true,
        machine: true,
        shift: true,
        product: { include: { category: true } },
        rawMaterial: { include: { category: true } },
        category: true,
      },
    });
  }

  async findAll(filters?: {
    page?: number;
    limit?: number;
    productionOrderId?: string;
    machineId?: string;
    shiftId?: string;
    productId?: string;
    status?: string;
  }) {
    const page = filters?.page;
    const limit = filters?.limit;

    const where: any = {};
    if (filters?.productionOrderId) where.productionOrderId = filters.productionOrderId;
    if (filters?.machineId) where.machineId = filters.machineId;
    if (filters?.shiftId) where.shiftId = filters.shiftId;
    if (filters?.productId) where.productId = BigInt(filters.productId);
    if (filters?.status) where.status = filters.status;

    const total = await prisma.productionWastage.count({ where });

    const findOptions: any = {
      where,
      include: {
        productionOrder: {
          include: {
            productItem: true,
          },
        },
        machine: true,
        shift: true,
        product: { include: { category: true } },
        rawMaterial: { include: { category: true } },
        category: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    };

    if (page !== undefined && limit !== undefined) {
      findOptions.skip = (page - 1) * limit;
      findOptions.take = limit;
    }

    const rawData = await prisma.productionWastage.findMany(findOptions);
    const data = await this.enrichManyWithApprovedByUser(rawData);

    if (page !== undefined && limit !== undefined) {
      return {
        data,
        total,
      };
    }

    return data;
  }

  async findById(id: bigint) {
    const record = await prisma.productionWastage.findUnique({
      where: { id },
      include: {
        productionOrder: {
          include: {
            productItem: true,
          },
        },
        machine: true,
        shift: true,
        product: { include: { category: true } },
        rawMaterial: { include: { category: true } },
        category: true,
      },
    });

    if (!record) {
      throw new ApiError(404, `Production Wastage record with ID ${id} not found`);
    }

    return this.enrichWithApprovedByUser(record);
  }

  async update(id: bigint, data: UpdateProductionWastageInput, userId: string) {
    const existing = await this.findById(id);

    if (existing.status !== "DRAFT") {
      throw new ApiError(400, "Cannot update a record that is already APPROVED or REJECTED");
    }

    const updatedData: any = {
      updatedBy: userId,
    };

    if (data.wastageDate) {
      const [yyyy, mm, dd] = data.wastageDate.split("-").map(Number);
      updatedData.wastageDate = new Date(Date.UTC(yyyy, mm - 1, dd));
    }
    if (data.productionOrderId) updatedData.productionOrderId = data.productionOrderId;
    if (data.hourlyProductionId !== undefined)
      updatedData.hourlyProductionId = data.hourlyProductionId
        ? BigInt(data.hourlyProductionId)
        : null;
    if (data.machineId) updatedData.machineId = data.machineId;
    if (data.shiftId) updatedData.shiftId = data.shiftId;
    if (data.productId) updatedData.productId = BigInt(data.productId);
    if (data.rawMaterialId !== undefined) updatedData.rawMaterialId = data.rawMaterialId ?? null;
    if (data.targetWastageProductId !== undefined)
      await assertTargetWastageProduct(data.targetWastageProductId);
    if (data.targetWastageProductId !== undefined)
      updatedData.targetWastageProductId = data.targetWastageProductId ?? null;
    if (data.storeId !== undefined) updatedData.storeId = data.storeId ?? null;
    if (data.wastageType) updatedData.wastageType = data.wastageType;
    if (data.quantity !== undefined) updatedData.quantity = data.quantity;
    if (data.uom) updatedData.uom = data.uom;
    if (data.estimatedValue !== undefined) updatedData.estimatedValue = data.estimatedValue;
    if (data.reason !== undefined) updatedData.reason = data.reason;
    if (data.correctiveAction !== undefined) updatedData.correctiveAction = data.correctiveAction;
    if (data.remarks !== undefined) updatedData.remarks = data.remarks;
    if (data.isRecyclable !== undefined) updatedData.isRecyclable = data.isRecyclable;
    if (data.sentForRework !== undefined) updatedData.sentForRework = data.sentForRework;
    if (data.categoryId !== undefined) updatedData.categoryId = data.categoryId ?? null;

    return prisma.productionWastage.update({
      where: { id },
      data: updatedData,
      include: {
        productionOrder: true,
        machine: true,
        shift: true,
        product: { include: { category: true } },
        rawMaterial: { include: { category: true } },
        category: true,
      },
    });
  }

  async delete(id: bigint) {
    const existing = await this.findById(id);

    if (existing.status !== "DRAFT") {
      throw new ApiError(400, "Cannot delete a record that is already APPROVED or REJECTED");
    }

    return prisma.productionWastage.delete({
      where: { id },
    });
  }

  async approve(id: bigint, userId: string) {
    const existing = await this.findById(id);

    if (existing.status !== "DRAFT") {
      throw new ApiError(400, "Only records in DRAFT status can be approved");
    }

    return prisma.$transaction(async (tx) => {
      // 1. Update status
      const updatedWastage = await tx.productionWastage.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedBy: userId,
          approvedAt: new Date(),
        },
        include: {
          productionOrder: true,
          machine: true,
          shift: true,
          product: { include: { category: true } },
          rawMaterial: { include: { category: true } },
          targetWastageProduct: true,
          category: true,
        },
      });

      // Values the material wasted as an outward movement at the running average — a wastage is
      // an issue that never comes back, not a receipt at a made-up rate (P2-04).
      if (existing.rawMaterialId) {
        await valuationService.record(
          {
            itemType: "RAW_MATERIAL",
            itemId: existing.rawMaterialId,
            storeId: existing.storeId ?? null,
            movedOn: existing.wastageDate,
            kind: "SCRAP",
            quantity: Number(existing.quantity),
            refDocType: "PRODUCTION_WASTAGE",
            refDocId: String(existing.id),
            narration: `Wastage ${existing.wastageNo}`,
          },
          { userId },
          tx
        );
      }

      // 2. Increase Stock for Target Wastage Product
      if (existing.targetWastageProductId) {
        const targetProduct = await tx.rawMaterial.findUnique({
          where: byCode("rawMaterialId", existing.targetWastageProductId),
        });

        if (targetProduct) {
          const qty = existing.quantity;

          await tx.rawMaterial.update({
            where: byCode("rawMaterialId", existing.targetWastageProductId),
            data: {
              onHandQty: { increment: qty },
              lastMovementAt: new Date(),
            },
          });

          // 3. Record Stock Ledger Transaction
          const wastageStoreId = existing.storeId || targetProduct.storeId || "STORE-001"; // Fallback if no store
          await tx.rawMaterialTransaction.create({
            data: {
              storeId: wastageStoreId,
              rawMaterialId: existing.targetWastageProductId,
              txnType: "WASTAGE_RECEIPT",
              qty: qty,
              remarks: `Received from Wastage Audit Log #${existing.wastageNo}`,
              productionOrderId: existing.productionOrderId,
            },
          });

          // No estimate on the log to receive it at? Fall back to what the recovered material is
          // actually worth: its own running weighted average, or — for a material that has never
          // been valued — its master rate. Either way the entry's narration says which one it
          // used, so "why is this rate what it is" never needs a trip back to the wastage log.
          let rate: number;
          let rateSource: string;
          if (existing.estimatedValue) {
            rate = Number(existing.estimatedValue) / Number(existing.quantity);
            rateSource = "the log's own estimate";
          } else {
            const hasValuation = await tx.stockValuationEntry.findFirst({
              where: {
                itemType: "RAW_MATERIAL",
                itemId: existing.targetWastageProductId,
                storeId: wastageStoreId,
              },
              select: { id: true },
            });
            if (hasValuation) {
              const balance = await valuationService.balanceAt(
                "RAW_MATERIAL",
                existing.targetWastageProductId,
                wastageStoreId,
                undefined,
                tx
              );
              rate = balance.avgRate;
              rateSource = "its current weighted average";
            } else {
              rate = Number(targetProduct.rate ?? 0);
              rateSource = "its master rate (never valued before)";
            }
          }

          await valuationService.record(
            {
              itemType: "RAW_MATERIAL",
              itemId: existing.targetWastageProductId,
              storeId: wastageStoreId,
              movedOn: existing.wastageDate,
              kind: "RECEIPT",
              quantity: Number(qty),
              rate,
              refDocType: "PRODUCTION_WASTAGE",
              refDocId: String(existing.id),
              narration: `Recovered from wastage ${existing.wastageNo}, received at ${rateSource}`,
            },
            { userId },
            tx
          );
        }
      }

      return this.enrichWithApprovedByUser(updatedWastage);
    });
  }

  async reject(id: bigint, userId: string) {
    const existing = await this.findById(id);

    if (existing.status !== "DRAFT") {
      throw new ApiError(400, "Only records in DRAFT status can be rejected");
    }

    const updated = await prisma.productionWastage.update({
      where: { id },
      data: {
        status: "REJECTED",
        approvedBy: userId,
        approvedAt: new Date(),
      },
      include: {
        productionOrder: true,
        machine: true,
        shift: true,
        product: { include: { category: true } },
        rawMaterial: { include: { category: true } },
        category: true,
      },
    });
    return this.enrichWithApprovedByUser(updated);
  }
}

export default new ProductionWastageService();
