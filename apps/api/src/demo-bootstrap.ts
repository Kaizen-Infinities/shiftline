/**
 * One-shot Kubernetes demo bootstrap. Run after migrations with DEMO_EMAIL and
 * DEMO_PASSWORD supplied by the installer's Secret:
 *
 *   node apps/api/dist/demo-bootstrap.js
 *
 * This deliberately does not run the development seed or create a platform admin.
 */
import { generatePermissions } from "@shiftline/shared";

import { prisma } from "./config/prisma";
import { runAsTenant, withoutTenant } from "./lib/tenant-context";
import { provisioningService } from "./modules/platform/provisioning.service";
import { comparePassword, hashPassword } from "./utils/hashPassword";

const COMPANY_CODE = "DEMO";
const COMPANY_SLUG = "demo";
const USERNAME = "demo.k8s";

export async function bootstrapDemo(email: string, password: string): Promise<void> {
  if (!email || email !== email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("DEMO_EMAIL must be a valid email address without surrounding spaces");
  }
  if (
    password.length < 12 ||
    password.length > 72 ||
    Buffer.byteLength(password, "utf8") > 72 ||
    !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)
  ) {
    throw new Error(
      "DEMO_PASSWORD must be 12–72 characters (at most 72 UTF-8 bytes) with uppercase, lowercase and a digit"
    );
  }

  // A pre-existing account must be exactly the one this helper created. In
  // particular, never take over another tenant's email or a platform admin.
  const [company, user, usernameOwner, admin] = await withoutTenant(async () =>
    Promise.all([
      prisma.company.findFirst({
        where: { OR: [{ companyCode: COMPANY_CODE }, { slug: COMPANY_SLUG }] },
      }),
      prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }),
      prisma.user.findUnique({ where: { username: USERNAME } }),
      prisma.admin.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }),
    ])
  );

  if (company && (company.companyCode !== COMPANY_CODE || company.slug !== COMPANY_SLUG)) {
    throw new Error("The DEMO tenant code or slug already belongs to another company");
  }
  if (admin) throw new Error("DEMO_EMAIL is already used by a platform admin");
  if (
    user &&
    (user.companyId !== company?.id || user.username !== USERNAME || user.email !== email)
  ) {
    throw new Error("DEMO_EMAIL is already used by another account");
  }
  if (usernameOwner && usernameOwner.userId !== user?.userId) {
    throw new Error("The demo bootstrap username is already used by another account");
  }
  if (user && !(await comparePassword(password, user.passwordHash))) {
    throw new Error("The existing demo account has a different password; refusing to rotate it");
  }

  // The API normally syncs this catalogue at startup. The installer runs this
  // CLI independently, before the API starts, so ensure grants exist here too.
  await prisma.permission.createMany({ data: generatePermissions(), skipDuplicates: true });

  const provisioned = await provisioningService.provisionTenant({
    companyCode: COMPANY_CODE,
    companyName: "Shiftline Demo Industries",
    legalName: "Shiftline Demo Industries",
    slug: COMPANY_SLUG,
    isOnboarded: true,
    planCode: "ENTERPRISE",
    subscriptionStatus: "ACTIVE",
  });
  const ownerRoleId = provisioned.roles.OWNER;
  if (!ownerRoleId) throw new Error("Demo tenant OWNER role was not provisioned");

  if (user) {
    if (user.roleId !== ownerRoleId || user.status !== "active" || user.mustChangePw) {
      throw new Error("The existing demo account is no longer an active OWNER account");
    }
    process.stdout.write("Demo tenant and account already exist.\n");
    return;
  }

  const passwordHash = await hashPassword(password);
  await runAsTenant(provisioned.company.id, () =>
    prisma.user.create({
      data: {
        username: USERNAME,
        email,
        fullName: "Demo Owner",
        passwordHash,
        roleId: ownerRoleId,
        mustChangePw: false,
      },
    })
  );
  process.stdout.write("Demo tenant and account created.\n");
}

if (require.main === module) {
  bootstrapDemo(process.env.DEMO_EMAIL ?? "", process.env.DEMO_PASSWORD ?? "")
    .catch((error: unknown) => {
      // Errors from this helper never contain the supplied plaintext password.
      process.stderr.write(
        `Demo bootstrap failed: ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
