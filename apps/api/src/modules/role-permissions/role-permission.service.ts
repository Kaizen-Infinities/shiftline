import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";

/**
 * F01: a role id from a request is only usable if the role belongs to the current tenant
 * (the tenant-scoped client adds the company to this lookup). A foreign or unknown id is a 404.
 */
export const assertTenantRole = async (roleId: number) => {
  const role = await prisma.role.findFirst({
    where: { id: roleId },
    select: { id: true, status: true },
  });
  if (!role) throw new ApiError(404, "Role not found");
  return role;
};

export const assignPermissionsToRole = async (roleId: number, permissionIds: number[]) => {
  await assertTenantRole(roleId);
  const known = await prisma.permission.count({ where: { id: { in: permissionIds } } });
  if (known !== new Set(permissionIds).size) {
    throw new ApiError(400, "One or more permissions do not exist");
  }
  const data = permissionIds.map((permissionId) => ({
    roleId,
    permissionId,
  }));

  return prisma.rolePermission.createMany({
    data,
    skipDuplicates: true,
  });
};

export const getRolePermissions = async (roleId: number) => {
  const role = await prisma.role.findFirst({
    where: {
      id: roleId,
    },
    include: {
      rolePermissions: {
        include: {
          permission: true,
        },
      },
    },
  });
  if (!role) throw new ApiError(404, "Role not found");
  return role;
};

export const removePermissionFromRole = async (roleId: number, permissionId: number) => {
  await assertTenantRole(roleId);
  return prisma.rolePermission.delete({
    where: {
      roleId_permissionId: {
        roleId,
        permissionId,
      },
    },
  });
};
