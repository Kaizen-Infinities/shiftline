/**
 * Development seed: platform admin + one anonymised demo tenant. Idempotent.
 *
 *   npm run -w @shiftline/api db:seed
 *
 * Passwords come from SEED_PASSWORD (default below, development only).
 */
import "dotenv/config";
import { prisma } from "../src/config/prisma";
import { bootstrapAdmin } from "../src/utils/bootstrapAdmin";
import { withoutTenant } from "../src/lib/tenant-context";
import { seedTenant } from "./seed-lib";
import {
  seedDemoActivity,
  seedDemoProductionOrders,
  seedDemoStockMinimums,
} from "./seed-demo-activity";

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "Demo@12345678";
const log = (msg: string) => process.stdout.write(`[seed] ${msg}\n`);

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data in production");
  }
  // Platform admin and the permission catalogue (global), same as on server boot.
  await bootstrapAdmin(prisma);

  const company = await seedTenant({
    companyCode: "DEMO",
    companyName: "Shiftline Demo Industries",
    slug: "demo",
    globalPrefix: "",
    password: SEED_PASSWORD,
    log,
  });
  // Invoices and receipts, so the demo books show money in as well as money out. The integration
  // suite builds its own data on top of the plain masters and skips this.
  if (process.env.NODE_ENV !== "test") {
    const owner = await withoutTenant(() =>
      prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } })
    );
    await seedDemoActivity({ companyId: company.id, ownerUserId: owner.userId, log });
    await seedDemoStockMinimums({ companyId: company.id, log });
    await seedDemoProductionOrders({ companyId: company.id, ownerUserId: owner.userId, log });
  }
  log(
    "users demo.owner, demo.accounts, demo.stores, demo.production, demo.sales, demo.auditor (password: SEED_PASSWORD)"
  );
  log("done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
