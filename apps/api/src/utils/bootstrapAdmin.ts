import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { env, isProduction } from "../config/env";
import { generatePermissions } from "@shiftline/shared";

/**
 * Returns `true` if this was a fresh install (DB was empty),
 * `false` if admin already existed (subsequent server restarts).
 */
export const bootstrapAdmin = async (
  prisma: Pick<PrismaClient, "admin" | "permission">
): Promise<boolean> => {
  // ── 0. Fast path: already bootstrapped ───────────────────────────────────
  //    On every restart after the first, skip all seeding. Only sync truly
  //    new permissions that were added since the last migration.
  const existingAdmin = await prisma.admin.findFirst({ select: { id: true } });

  if (existingAdmin) {
    const permissionData = generatePermissions();
    const { count } = await prisma.permission.createMany({
      data: permissionData,
      skipDuplicates: true,
    });
    if (count > 0) {
      console.log(`✅ ${count} new permissions seeded from registry`);
    }
    return false;
  }

  // ── Fresh install: run full bootstrap ────────────────────────────────────
  // Production requires explicit credentials (enforced in config/env.ts). In
  // development a throwaway account is created and announced loudly.
  const adminEmail = env.ADMIN_EMAIL || "admin@shiftline.local";
  const adminUsername = env.ADMIN_USERNAME || "superadmin";
  const adminPassword = env.ADMIN_PASSWORD || (isProduction ? "" : "dev-only-change-me-Admin#2026");
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is required to bootstrap the platform admin");
  if (!env.ADMIN_PASSWORD) {
    console.warn(
      "[bootstrap] Using the development-only admin password. Set ADMIN_* in apps/api/.env."
    );
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // ── 1. Ensure the platform admin account (isSuperAdmin bypasses RBAC; no tenant role) ──
  await prisma.admin.upsert({
    where: { email: adminEmail },
    update: { fullName: "Platform Admin", username: adminUsername, passwordHash },
    create: {
      fullName: "Platform Admin",
      username: adminUsername,
      email: adminEmail,
      phone: "0000000000",
      passwordHash,
    },
  });

  console.log("✅ Platform admin bootstrapped");

  // ── 3. Seed ALL permissions from centralized registry ────────────────────
  //    generatePermissions() reads PERMISSION_REGISTRY — adding a new module
  //    here is the ONLY place you need to touch for new RBAC entries.
  const permissionData = generatePermissions();

  await prisma.permission.createMany({
    data: permissionData,
    skipDuplicates: true,
  });

  console.log(`✅ ${permissionData.length} permissions seeded from registry`);

  return true;
};
