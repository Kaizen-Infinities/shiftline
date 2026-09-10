import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import {
  expireAccountExports,
  hashDownloadToken,
  runAccountExport,
} from "../../jobs/account-export.job";
import { QUEUES, isJobsStarted, sendTenantJob } from "../../lib/jobs";
import { requireTenantId, withoutTenant } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";

/** Account export requests and downloads (P1-03). */
class AccountExportService {
  async list() {
    const companyId = requireTenantId();
    await expireAccountExports(companyId);
    const rows = await prisma.accountExport.findMany({
      orderBy: { requestedAt: "desc" },
      take: 20,
    });
    return rows.map(this.present);
  }

  async get(id: string) {
    const row = await prisma.accountExport.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Export not found");
    return this.present(row);
  }

  /** One export at a time per tenant; runs inline when no worker is attached. */
  async request(requestedBy: string | undefined) {
    const companyId = requireTenantId();
    const open = await prisma.accountExport.findFirst({
      where: { status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (open) throw new ApiError(409, "An export is already in progress", "EXPORT_IN_PROGRESS");
    const row = await prisma.accountExport.create({
      data: { status: "QUEUED", requestedBy: requestedBy?.slice(0, 36) ?? null },
    });
    if (isJobsStarted()) {
      await sendTenantJob(QUEUES.ACCOUNT_EXPORT, { companyId, exportId: row.id });
      return { ...this.present(row), queued: true };
    }
    const done = await runAccountExport(row.id, companyId);
    return { ...this.present(done), queued: false };
  }

  /** The file for a signed-in user with the permission, or for a valid signed link. */
  async fileFor(id: string, token?: string) {
    const row = token
      ? await withoutTenant(() =>
          prisma.accountExport.findFirst({
            where: { id, tokenHash: hashDownloadToken(token) },
          })
        )
      : await prisma.accountExport.findUnique({ where: { id } });
    if (!row || !row.fileName) throw new ApiError(404, "Export not found");
    if (row.status !== "READY" || !row.expiresAt || row.expiresAt <= new Date()) {
      throw new ApiError(410, "This export has expired; request a new one", "EXPORT_EXPIRED");
    }
    const full = path.resolve(env.EXPORT_DIR, row.companyId, row.fileName);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile()) throw new ApiError(410, "The export file is no longer available");
    await withoutTenant(() =>
      prisma.accountExport.update({
        where: { id: row.id },
        data: { downloads: { increment: 1 }, lastDownloadedAt: new Date() },
      })
    );
    return { stream: createReadStream(full), fileName: row.fileName, size: info.size };
  }

  private present = (row: {
    id: string;
    status: string;
    requestedBy: string | null;
    requestedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    expiresAt: Date | null;
    fileName: string | null;
    sizeBytes: bigint | null;
    sha256: string | null;
    tableCounts: unknown;
    attachmentCount: number;
    downloads: number;
    lastDownloadedAt: Date | null;
    error: string | null;
  }) => ({
    id: row.id,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    sha256: row.sha256,
    tableCounts: row.tableCounts,
    attachmentCount: row.attachmentCount,
    downloads: row.downloads,
    lastDownloadedAt: row.lastDownloadedAt,
    error: row.error,
  });
}

export const accountExportService = new AccountExportService();
