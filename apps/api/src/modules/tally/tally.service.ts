import { createHash } from "node:crypto";

import type { Prisma, TallyExportScope, TallyNameKind } from "@prisma/client";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { buildMasters } from "./tally.masters";
import { buildVouchers } from "./tally.vouchers";
import type { TallyNameLookup, TallyOverride } from "./tally.names";
import { envelope } from "./tally.xml";

/**
 * Tally XML export (P1-06).
 *
 * The file is generated on demand and never stored: the books are the source of truth and a
 * stored copy would only go stale. What *is* stored is the run — the window, the counts and the
 * hash of what was handed over — because the next incremental export has to start where the last
 * confirmed one ended, and because an accountant asking "is this the file I imported?" deserves
 * an answer.
 */
export interface GeneratedFile {
  xml: string;
  counts: Record<string, number>;
  throughAt: Date | null;
}

const NO_OVERRIDE: TallyOverride = { isExported: true };

const midnight = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

class TallyService {
  /** The tenant's overrides, indexed once so the builders can ask per record. */
  private async lookup(): Promise<TallyNameLookup> {
    const rows = await prisma.tallyNameMap.findMany();
    const index = new Map<string, TallyOverride>();
    for (const r of rows) {
      index.set(`${r.kind}:${r.sourceCode}`, {
        tallyName: r.tallyName || undefined,
        tallyParent: r.tallyParent ?? undefined,
        isExported: r.isExported,
      });
    }
    return {
      override: (kind, sourceCode) => index.get(`${kind}:${sourceCode}`) ?? NO_OVERRIDE,
    };
  }

  private async tallyCompanyName(given?: string | null) {
    if (given?.trim()) return given.trim().slice(0, 160);
    const company = await prisma.company.findFirstOrThrow({ where: { id: requireTenantId() } });
    return (company.legalName ?? company.companyName).slice(0, 160);
  }

  async mappings() {
    return prisma.tallyNameMap.findMany({ orderBy: [{ kind: "asc" }, { sourceCode: "asc" }] });
  }

  async saveMapping(
    input: {
      kind: TallyNameKind;
      sourceCode: string;
      tallyName: string;
      tallyParent?: string | null;
      isExported?: boolean;
      notes?: string | null;
    },
    actor: { userId?: string }
  ) {
    const sourceCode = input.sourceCode.trim();
    if (!sourceCode) throw new ApiError(400, "A mapping needs the code it is mapping from");
    const data = {
      tallyName: input.tallyName.trim().slice(0, 160),
      tallyParent: input.tallyParent?.trim() || null,
      isExported: input.isExported ?? true,
      notes: input.notes?.slice(0, 255) ?? null,
    };
    return prisma.tallyNameMap.upsert({
      where: {
        companyId_kind_sourceCode: { companyId: requireTenantId(), kind: input.kind, sourceCode },
      },
      create: { kind: input.kind, sourceCode, createdBy: actor.userId?.slice(0, 36), ...data },
      update: data,
    });
  }

  async deleteMapping(id: string) {
    const row = await prisma.tallyNameMap.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "That mapping does not exist");
    await prisma.tallyNameMap.delete({ where: { id } });
    return { id };
  }

  /** The masters file: groups Tally does not already have, ledgers, units and stock items. */
  async masters(tallyCompany?: string | null): Promise<GeneratedFile> {
    const lookup = await this.lookup();
    const { messages, counts } = await buildMasters(lookup);
    return {
      xml: envelope("All Masters", await this.tallyCompanyName(tallyCompany), messages),
      counts: { ...counts },
      throughAt: null,
    };
  }

  /** The voucher file for a window, optionally only what changed since a watermark. */
  async vouchers(input: {
    from: Date;
    to: Date;
    sinceAt?: Date | null;
    tallyCompany?: string | null;
  }): Promise<GeneratedFile> {
    if (input.to < input.from) throw new ApiError(400, "The period ends before it starts");
    const lookup = await this.lookup();
    const companyId = requireTenantId();
    const { messages, counts, throughAt } = await buildVouchers(
      { from: midnight(input.from), to: midnight(input.to), sinceAt: input.sinceAt ?? null },
      lookup,
      companyId
    );
    return {
      xml: envelope("Vouchers", await this.tallyCompanyName(input.tallyCompany), messages),
      counts: { ...counts },
      throughAt,
    };
  }

  /**
   * Where an incremental run starts: the watermark of the last confirmed run. A draft run does
   * not move it, because nobody has told us its file reached Tally.
   */
  async watermark(): Promise<Date | null> {
    const last = await prisma.tallyExportRun.findFirst({
      where: { status: "CONFIRMED", throughAt: { not: null } },
      orderBy: { throughAt: "desc" },
      select: { throughAt: true },
    });
    return last?.throughAt ?? null;
  }

  /** What a run would contain, without recording anything. */
  async preview(input: { from: Date; to: Date; incremental?: boolean; scope?: TallyExportScope }) {
    const sinceAt = input.incremental ? await this.watermark() : null;
    const scope = input.scope ?? "BOTH";
    const counts: Record<string, number> = {};
    if (scope !== "VOUCHERS") Object.assign(counts, (await this.masters()).counts);
    if (scope !== "MASTERS") {
      const v = await this.vouchers({ from: input.from, to: input.to, sinceAt });
      Object.assign(counts, v.counts);
    }
    return { scope, incremental: Boolean(input.incremental), sinceAt, counts };
  }

  /**
   * Generates the file and records the run. The run is a draft until someone says the import
   * happened; only then does it move the incremental watermark, because nothing here can see
   * whether Tally accepted anything.
   */
  async createRun(
    input: {
      scope?: TallyExportScope;
      from: Date;
      to: Date;
      incremental?: boolean;
      tallyCompany?: string | null;
      notes?: string | null;
    },
    actor: { userId?: string }
  ) {
    const scope = input.scope ?? "BOTH";
    const sinceAt = input.incremental ? await this.watermark() : null;
    const file = await this.generate({ ...input, scope, sinceAt });
    const row = await prisma.tallyExportRun.create({
      data: {
        scope,
        tallyCompany: await this.tallyCompanyName(input.tallyCompany),
        fromDate: scope === "MASTERS" ? null : midnight(input.from),
        toDate: scope === "MASTERS" ? null : midnight(input.to),
        incremental: Boolean(input.incremental),
        sinceAt,
        throughAt: file.throughAt,
        counts: file.counts as Prisma.InputJsonValue,
        sizeBytes: Buffer.byteLength(file.xml, "utf8"),
        payloadHash: createHash("sha256").update(file.xml).digest("hex"),
        requestedBy: actor.userId?.slice(0, 36) ?? null,
        notes: input.notes?.slice(0, 255) ?? null,
      },
    });
    return { run: row, xml: file.xml };
  }

  /** Masters and vouchers in one file when the scope asks for both; masters always go first. */
  private async generate(input: {
    scope: TallyExportScope;
    from: Date;
    to: Date;
    sinceAt: Date | null;
    tallyCompany?: string | null;
  }): Promise<GeneratedFile> {
    if (input.scope === "MASTERS") return this.masters(input.tallyCompany);
    const vouchers = await this.vouchers({
      from: input.from,
      to: input.to,
      sinceAt: input.sinceAt,
      tallyCompany: input.tallyCompany,
    });
    if (input.scope === "VOUCHERS") return vouchers;
    const masters = await this.masters(input.tallyCompany);
    return {
      // Tally imports one envelope per file, so "both" is the two envelopes back to back: the
      // utility reads them in order and the masters are in place before a voucher names them.
      xml: `${masters.xml}\n${vouchers.xml}`,
      counts: { ...masters.counts, ...vouchers.counts },
      throughAt: vouchers.throughAt,
    };
  }

  async runs(limit = 25) {
    return prisma.tallyExportRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  async run(id: string) {
    const row = await prisma.tallyExportRun.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "That export run does not exist");
    return row;
  }

  /**
   * Rebuilds a run's file from the window it recorded. The hash is compared rather than trusted:
   * a file that no longer matches means the books moved since it was generated, which is the one
   * thing the accountant needs to know before importing it a second time.
   */
  async fileFor(id: string) {
    const row = await this.run(id);
    const file = await this.generate({
      scope: row.scope,
      from: row.fromDate ?? new Date(0),
      to: row.toDate ?? new Date(),
      sinceAt: row.sinceAt,
      tallyCompany: row.tallyCompany,
    });
    const hash = createHash("sha256").update(file.xml).digest("hex");
    await prisma.tallyExportRun.update({
      where: { id },
      data: { downloads: { increment: 1 }, lastDownloadedAt: new Date() },
    });
    return { xml: file.xml, run: row, changedSinceRun: hash !== row.payloadHash };
  }

  /** The person says the file reached Tally; that, and only that, moves the watermark. */
  async confirm(id: string, actor: { userId?: string }) {
    const row = await this.run(id);
    if (row.status === "CONFIRMED") return row;
    if (row.status === "DISCARDED") {
      throw new ApiError(409, "That export was discarded; generate a new one", "RUN_DISCARDED");
    }
    return prisma.tallyExportRun.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedBy: actor.userId?.slice(0, 36) ?? null,
        confirmedAt: new Date(),
      },
    });
  }

  /** A file that was never imported; discarding keeps the watermark where it was. */
  async discard(id: string, reason: string) {
    const row = await this.run(id);
    if (row.status === "CONFIRMED") {
      throw new ApiError(
        409,
        "That export was already confirmed as imported",
        "RUN_ALREADY_CONFIRMED"
      );
    }
    return prisma.tallyExportRun.update({
      where: { id },
      data: { status: "DISCARDED", notes: reason.slice(0, 255) },
    });
  }
}

export const tallyService = new TallyService();
