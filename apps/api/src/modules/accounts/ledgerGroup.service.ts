import { LedgerType, Prisma } from "@prisma/client";

import { prisma } from "../../config/prisma";
import type { Db } from "../../lib/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { STANDARD_LEDGER_GROUPS, legacyGroupCode } from "./ledgerGroups";

/**
 * Ledger groups (P1-09c): the tenant's chart-of-accounts tree. `ensureLedgerGroups()` seeds
 * the standard tree and files every ledger without a group under the right node; the
 * screens read `tree()`; custom groups are added beneath a system group of the same nature.
 */
export interface GroupNode {
  id: number;
  code: string;
  name: string;
  nature: LedgerType;
  parentId: number | null;
  scheduleHead: string | null;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
  ledgerCount: number;
  children: GroupNode[];
}

const codeFromName = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

class LedgerGroupService {
  /** Idempotent: creates missing standard groups and files ungrouped ledgers. */
  async ensureLedgerGroups(db: Db = prisma) {
    const existing = await db.ledgerGroup.findMany({ select: { id: true, code: true } });
    const byCode = new Map(existing.map((g) => [g.code, g.id]));
    let sort = 0;
    for (const def of STANDARD_LEDGER_GROUPS) {
      sort += 10;
      if (byCode.has(def.code)) continue;
      const parentId = def.parent ? (byCode.get(def.parent) ?? null) : null;
      const created = await db.ledgerGroup.create({
        data: {
          code: def.code,
          name: def.name,
          nature: def.nature,
          parentId,
          scheduleHead: def.scheduleHead,
          isSystem: true,
          sortOrder: sort,
        },
      });
      byCode.set(def.code, created.id);
    }

    const ungrouped = await db.accountLedger.findMany({
      where: { groupId: null },
      select: { id: true, code: true, type: true, group: true, customerId: true, supplierId: true },
    });
    for (const ledger of ungrouped) {
      const groupId = byCode.get(legacyGroupCode(ledger));
      if (!groupId) continue;
      await db.accountLedger.update({ where: { id: ledger.id }, data: { groupId } });
    }
    return byCode;
  }

  /** The id of a standard group by code (seeding it if the tenant has none yet). */
  async idOf(code: string, db: Db = prisma): Promise<number> {
    const found = await db.ledgerGroup.findFirst({ where: { code } });
    if (found) return found.id;
    const seeded = await this.ensureLedgerGroups(db);
    const id = seeded.get(code);
    if (!id) throw new ApiError(400, `Unknown ledger group ${code}`);
    return id;
  }

  async tree(opts: { includeInactive?: boolean } = {}): Promise<GroupNode[]> {
    await this.ensureLedgerGroups();
    const [groups, counts] = await Promise.all([
      prisma.ledgerGroup.findMany({
        where: opts.includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      prisma.accountLedger.groupBy({ by: ["groupId"], _count: { _all: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.groupId, c._count._all]));
    const nodes = new Map<number, GroupNode>();
    for (const g of groups) {
      nodes.set(g.id, {
        id: g.id,
        code: g.code,
        name: g.name,
        nature: g.nature,
        parentId: g.parentId,
        scheduleHead: g.scheduleHead,
        isSystem: g.isSystem,
        isActive: g.isActive,
        sortOrder: g.sortOrder,
        ledgerCount: countBy.get(g.id) ?? 0,
        children: [],
      });
    }
    const roots: GroupNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** Flat list, useful for pickers: `path` is "Current Assets › Bank Accounts". */
  async flat(): Promise<(GroupNode & { path: string })[]> {
    const roots = await this.tree();
    const out: (GroupNode & { path: string })[] = [];
    const walk = (node: GroupNode, prefix: string) => {
      const path = prefix ? `${prefix} › ${node.name}` : node.name;
      out.push({ ...node, path });
      node.children.forEach((c) => walk(c, path));
    };
    roots.forEach((r) => walk(r, ""));
    return out;
  }

  async create(input: {
    name: string;
    parentId: number;
    code?: string;
    scheduleHead?: string | null;
  }) {
    const parent = await prisma.ledgerGroup.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new ApiError(404, "Parent group not found");
    const code = (input.code ? codeFromName(input.code) : codeFromName(input.name)) || "GROUP";
    const clash = await prisma.ledgerGroup.findFirst({ where: { code } });
    if (clash) throw new ApiError(409, `A group with code ${code} already exists`);
    const siblings = await prisma.ledgerGroup.count({ where: { parentId: parent.id } });
    return prisma.ledgerGroup.create({
      data: {
        code,
        name: input.name.trim(),
        nature: parent.nature,
        parentId: parent.id,
        scheduleHead: input.scheduleHead ?? parent.scheduleHead,
        isSystem: false,
        sortOrder: parent.sortOrder + siblings + 1,
      },
    });
  }

  async update(
    id: number,
    input: {
      name?: string;
      parentId?: number | null;
      scheduleHead?: string | null;
      isActive?: boolean;
    }
  ) {
    const group = await prisma.ledgerGroup.findUnique({ where: { id } });
    if (!group) throw new ApiError(404, "Ledger group not found");
    const data: Prisma.LedgerGroupUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.scheduleHead !== undefined) data.scheduleHead = input.scheduleHead;
    if (input.parentId !== undefined) {
      if (group.isSystem) throw new ApiError(400, "System groups cannot be moved");
      if (input.parentId === null) throw new ApiError(400, "A custom group needs a parent");
      if (input.parentId === id) throw new ApiError(400, "A group cannot be its own parent");
      const parent = await prisma.ledgerGroup.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new ApiError(404, "Parent group not found");
      if (parent.nature !== group.nature) {
        throw new ApiError(
          400,
          `Cannot move a ${group.nature} group under a ${parent.nature} group`
        );
      }
      // No cycles: the new parent must not sit below this group.
      let cursor: { parentId: number | null } | null = parent;
      while (cursor?.parentId) {
        if (cursor.parentId === id)
          throw new ApiError(400, "Cannot move a group under its own child");
        cursor = await prisma.ledgerGroup.findUnique({
          where: { id: cursor.parentId },
          select: { parentId: true },
        });
      }
      data.parent = { connect: { id: parent.id } };
    }
    if (input.isActive !== undefined) {
      if (group.isSystem && !input.isActive)
        throw new ApiError(400, "System groups cannot be deactivated");
      if (!input.isActive) {
        const [ledgers, children] = await Promise.all([
          prisma.accountLedger.count({ where: { groupId: id } }),
          prisma.ledgerGroup.count({ where: { parentId: id, isActive: true } }),
        ]);
        if (ledgers > 0 || children > 0) {
          throw new ApiError(409, "Move its ledgers and sub-groups first", "GROUP_IN_USE", {
            ledgers,
            children,
          });
        }
      }
      data.isActive = input.isActive;
    }
    return prisma.ledgerGroup.update({ where: { id }, data });
  }

  /** Resolves the group for a ledger payload: an explicit id, else a name, else the legacy mapping. */
  async resolveGroupId(
    input: { groupId?: number | null; group?: string | null; code: string; type: LedgerType },
    db: Db = prisma
  ): Promise<{ groupId: number; groupName: string }> {
    if (input.groupId) {
      const g = await db.ledgerGroup.findUnique({ where: { id: input.groupId } });
      if (!g || !g.isActive) throw new ApiError(404, "Ledger group not found");
      if (g.nature !== input.type) {
        throw new ApiError(400, `Group ${g.name} holds ${g.nature} ledgers, not ${input.type}`);
      }
      return { groupId: g.id, groupName: g.name };
    }
    if (input.group) {
      const g = await db.ledgerGroup.findFirst({
        where: {
          name: { equals: input.group.trim(), mode: "insensitive" },
          nature: input.type,
          isActive: true,
        },
      });
      if (g) return { groupId: g.id, groupName: g.name };
    }
    const code = legacyGroupCode({
      code: input.code,
      type: input.type,
      group: input.group ?? null,
    });
    const id = await this.idOf(code, db);
    const g = await db.ledgerGroup.findUniqueOrThrow({ where: { id } });
    return { groupId: g.id, groupName: g.name };
  }

  companyId() {
    return requireTenantId();
  }
}

export const ledgerGroupService = new LedgerGroupService();
