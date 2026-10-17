import { Prisma } from "@prisma/client";
import { requireTenantId } from "./tenant-context";

/**
 * Serialises auto-generated business codes. "Latest row + 1" is only safe if no other
 * transaction can read the same latest row before this one commits, so the caller takes a
 * transaction-scoped advisory lock first and reads the next code inside it:
 *
 *   prisma.$transaction((tx) =>
 *     withCodeLock(tx, "daily-plan", async () => {
 *       const code = await nextCode(tx);
 *       return tx.model.create({ data: { code, ... } });
 *     })
 *   );
 *
 * The lock key is per tenant and scope, so two companies never wait on each other. It is released
 * when the transaction commits or rolls back. Under READ COMMITTED each statement sees rows
 * committed before it starts, so a read taken after the lock sees the previous holder's row.
 */
export const withCodeLock = async <T>(
  tx: Prisma.TransactionClient,
  scope: string,
  fn: () => Promise<T>
): Promise<T> => {
  const key = `${requireTenantId()}:${scope}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  return fn();
};
