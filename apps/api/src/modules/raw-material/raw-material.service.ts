import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { executeDeleteWithValidation } from "../../utils/deleteValidation";
import { CreateRawMaterialInput, UpdateRawMaterialInput } from "./raw-material.validation";
import { byCode } from "../../lib/prisma";

class RawMaterialService {
  /**
   * 400 unless the category, storage location and HSN code belong to this tenant. The foreign
   * keys only check that the id exists somewhere; the tenant-scoped client returns null for a
   * foreign id. HSN codes are tenant-scoped too (HsnCode.companyId).
   */
  private async assertTenantRefs(data: {
    categoryId?: number | null;
    locationId?: string | null;
    hsnCodeId?: string | null;
  }) {
    const [category, location, hsn] = await Promise.all([
      data.categoryId == null
        ? true
        : prisma.category.findFirst({ where: { id: data.categoryId }, select: { id: true } }),
      data.locationId == null
        ? true
        : prisma.storeLocation.findFirst({ where: { id: data.locationId }, select: { id: true } }),
      data.hsnCodeId == null
        ? true
        : prisma.hsnCode.findFirst({ where: { id: data.hsnCodeId }, select: { id: true } }),
    ]);
    if (!category) throw new ApiError(400, "Unknown category");
    if (!location) throw new ApiError(400, "Unknown location");
    if (!hsn) throw new ApiError(400, "Unknown HSN code");
  }

  async create(data: CreateRawMaterialInput, userId?: string) {
    const existingId = await prisma.rawMaterial.findUnique({
      where: byCode("rawMaterialId", data.rawMaterialId),
    });

    if (existingId) {
      throw new ApiError(409, `Raw Material with ID ${data.rawMaterialId} already exists`);
    }

    await this.assertTenantRefs(data);

    return prisma.$transaction(async (tx) => {
      const rawMaterial = await tx.rawMaterial.create({
        data: {
          rawMaterialId: data.rawMaterialId,
          materialName: data.materialName,
          // Scalar foreign keys, not `connect`: the tenant extension adds `companyId` to
          // `data`, which Prisma only accepts alongside scalar (unchecked) relation fields.
          categoryId: data.categoryId ?? null,
          hsnCodeId: data.hsnCodeId ?? null,
          gstRate: data.gstRate ?? null,
          minimumStock: data.minimumStock,
          baseUom: data.baseUom,
          reorderLevel: data.reorderLevel,
          rate: data.rate,
          storeId: data.storeId ?? null,
          isActive: data.isActive ?? true,
          createdBy: userId,
          locationId: data.locationId ?? null,
          batchNo: data.batchNo ?? null,
          onHandQty: data.onHandQty ?? 0,
          reservedQty: data.reservedQty ?? 0,
          narration: data.narration ?? null,
          lastMovementAt: data.lastMovementAt ? new Date(data.lastMovementAt) : null,
          status: data.status ?? "Active",
          itemType: data.itemType ?? "RAW_MATERIAL",
        },
      });

      return rawMaterial;
    });
  }

  async findAll(
    params: {
      search?: string;
      storeId?: string;
      isActive?: boolean;
      itemType?: string;
      categoryId?: string;
      status?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    } = {}
  ) {
    const {
      search,
      storeId,
      isActive,
      itemType,
      categoryId,
      status,
      page,
      limit,
      sortBy = "rawMaterialId",
      sortOrder = "asc",
    } = params;

    const whereClause: any = {};

    if (search) {
      whereClause.OR = [
        { rawMaterialId: { contains: search, mode: "insensitive" } },
        { materialName: { contains: search, mode: "insensitive" } },
      ];
    }

    if (storeId) {
      whereClause.storeId = storeId;
    }

    if (categoryId) {
      whereClause.categoryId = Number(categoryId);
    }

    if (status) {
      whereClause.status = status;
    }

    if (isActive !== undefined) {
      whereClause.isActive = isActive;
    }

    if (itemType) {
      if (itemType === "RAW_MATERIAL") {
        // Include legacy records with null itemType — treat them as RAW_MATERIAL
        const typeFilter = { OR: [{ itemType: "RAW_MATERIAL" }, { itemType: null }] };
        whereClause.AND = whereClause.AND ? [...whereClause.AND, typeFilter] : [typeFilter];
      } else {
        whereClause.itemType = itemType;
      }
    }

    const queryOptions: any = {
      where: whereClause,
      include: {
        store: { include: { location: true } },
        category: true,
        storeLocation: true,
        hsnCode: { select: { id: true, code: true, gstRate: true, cessRate: true } },
      },
      orderBy: { [sortBy]: sortOrder },
    };

    if (page !== undefined || limit !== undefined) {
      const p = page || 1;
      const l = limit || 10;
      queryOptions.skip = (p - 1) * l;
      queryOptions.take = l;
    }

    const [rawMaterials, total] = await Promise.all([
      prisma.rawMaterial.findMany(queryOptions),
      prisma.rawMaterial.count({ where: whereClause }),
    ]);

    return {
      rawMaterials,
      total,
      page: page || 1,
      limit: limit || total,
      totalPages: limit ? Math.ceil(total / limit) : 1,
    };
  }

  async findById(rawMaterialId: string) {
    const rawMaterial = await prisma.rawMaterial.findUnique({
      where: byCode("rawMaterialId", rawMaterialId),
      include: {
        store: true,
        category: true,
        storeLocation: true,
        hsnCode: { select: { id: true, code: true, gstRate: true, cessRate: true } },
      },
    });

    if (!rawMaterial) {
      throw new ApiError(404, `Raw Material with ID ${rawMaterialId} not found`);
    }

    return rawMaterial;
  }

  async update(rawMaterialId: string, data: UpdateRawMaterialInput, userId?: string) {
    await this.findById(rawMaterialId);
    await this.assertTenantRefs(data);

    const { categoryId, storeId, locationId, hsnCodeId, ...restData } = data;

    const updateData: any = {
      ...restData,
      updatedBy: userId,
    };

    if (locationId !== undefined) {
      if (locationId === null) {
        updateData.storeLocation = { disconnect: true };
      } else {
        updateData.storeLocation = { connect: { id: locationId } };
      }
    }

    if (categoryId !== undefined) {
      if (categoryId === null) {
        updateData.category = { disconnect: true };
      } else {
        updateData.category = { connect: { id: categoryId } };
      }
    }

    if (storeId !== undefined) {
      if (storeId === null) {
        updateData.store = { disconnect: true };
      } else {
        updateData.store = { connect: byCode("storeId", storeId) };
      }
    }

    if (hsnCodeId !== undefined) {
      updateData.hsnCode =
        hsnCodeId === null ? { disconnect: true } : { connect: { id: hsnCodeId } };
    }

    return prisma.rawMaterial.update({
      where: byCode("rawMaterialId", rawMaterialId),
      data: updateData,
    });
  }

  async delete(rawMaterialId: string, userId?: string) {
    await this.findById(rawMaterialId);

    const txnCount = await prisma.rawMaterialTransaction.count({
      where: { rawMaterialId },
    });

    if (txnCount > 0) {
      throw new ApiError(
        400,
        "Cannot delete this Raw Material because it has transaction history."
      );
    }

    // Hard Delete with Prisma error boundary
    return executeDeleteWithValidation(
      () => prisma.rawMaterial.delete({ where: byCode("rawMaterialId", rawMaterialId) }),
      "Raw Material"
    );
  }
  async getNextRawMaterialId() {
    const lastItem = await prisma.rawMaterial.findFirst({
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!lastItem) {
      return "RM001";
    }

    const lastId = lastItem.rawMaterialId;
    const match = lastId.match(/\d+/);
    if (!match) {
      return lastId + "001";
    }

    const numberStr = match[0];
    const nextNumber = parseInt(numberStr, 10) + 1;
    const paddedNumber = String(nextNumber).padStart(numberStr.length, "0");
    const prefix = lastId.substring(0, lastId.indexOf(numberStr));
    const suffix = lastId.substring(lastId.indexOf(numberStr) + numberStr.length);
    return `${prefix}${paddedNumber}${suffix}`;
  }
}

export default new RawMaterialService();
