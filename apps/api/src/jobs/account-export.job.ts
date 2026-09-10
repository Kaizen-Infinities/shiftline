import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { Prisma } from "@prisma/client";
import type PgBoss from "pg-boss";

import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { TENANT_MODELS } from "../lib/prisma";
import { logger } from "../lib/logger";
import { TarWriter } from "../lib/tar";
import { runAsTenant } from "../lib/tenant-context";
import type { TenantJobData } from "../lib/jobs";
import { notify } from "../modules/notifications/notify";

/**
 * Full account export (P1-03, PF8 / DPDP): every tenant-scoped table as NDJSON, the files the
 * rows point at, and a manifest, in one `.tar.gz` under EXPORT_DIR/<companyId>/. Secrets never
 * leave (password hashes, tokens, SMTP and WhatsApp credentials). The archive is downloadable
 * for 24 hours by the requester (signed in) or through a signed link, then removed.
 */
export const EXPORT_TTL_HOURS = 24;
export const FORMAT_VERSION = 1;
const PAGE = 1000;

/** Columns that never leave the system, whatever the table. */
const SECRET_COLUMNS = new Set([
  "passwordHash",
  "sessionToken",
  "prevTokenHash",
  "accessToken",
  "refreshToken",
  "mfaSecret",
  "tokenHash",
  "smtpPassword",
  "apiKey",
  "apiSecret",
  "webhookSecret",
  "appSecret",
  "verifyToken",
]);

/** Columns holding URLs of files the tenant uploaded (copied into attachments/). */
const FILE_COLUMNS: Record<string, string[]> = {
  Employee: ["photoUrl"],
  Product: ["imageUrl"],
  ProductImage: ["url", "imageUrl"],
  Expense: ["receiptInvoice"],
  MobileCollection: ["attachments"],
  MobileVisit: ["attachments", "photos"],
};

const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

export interface AccountExportJobData extends TenantJobData {
  exportId: string;
}

type Manifest = {
  format: number;
  generatedAt: string;
  company: { id: string; code: string | null; name: string };
  tables: { table: string; model: string; rows: number; file: string }[];
  attachments: {
    table: string;
    id: string;
    column: string;
    url: string;
    included: boolean;
    file: string | null;
  }[];
  excludedColumns: string[];
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

const plain = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = plain(v);
    return out;
  }
  return value;
};

const localUpload = (url: string): string | null => {
  const m = /\/uploads\/(.+)$/.exec(url);
  if (!m) return null;
  const rel = path.normalize(m[1]).replace(/^(\.\.[/\\])+/, "");
  return rel;
};

const urlsIn = (value: unknown): string[] => {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(urlsIn);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return urlsIn(o.url ?? o.uri ?? o.path ?? null);
  }
  return [];
};

export const newDownloadToken = () => randomBytes(32).toString("hex");
export const hashDownloadToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Builds the archive for one export row; idempotent per row (a re-run overwrites). */
export const runAccountExport = async (exportId: string, companyId: string) =>
  runAsTenant(companyId, async () => {
    const row = await prisma.accountExport.findUniqueOrThrow({ where: { id: exportId } });
    if (row.status === "READY") return row;
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, companyCode: true, companyName: true },
    });
    const started = new Date();
    await prisma.accountExport.update({
      where: { id: exportId },
      data: { status: "RUNNING", startedAt: started, error: null },
    });

    const dir = path.resolve(env.EXPORT_DIR, companyId);
    await mkdir(dir, { recursive: true });
    const fileName = `shiftline-export-${(company.companyCode ?? "company").toLowerCase()}-${stamp(started)}.tar.gz`;
    const full = path.join(dir, fileName);
    const out = createWriteStream(full);
    const gzip = createGzip({ level: 6 });
    const hash = createHash("sha256");
    gzip.on("data", (chunk: Buffer) => hash.update(chunk));
    const piped = pipeline(gzip, out);
    const tar = new TarWriter(gzip);

    const manifest: Manifest = {
      format: FORMAT_VERSION,
      generatedAt: started.toISOString(),
      company: { id: company.id, code: company.companyCode, name: company.companyName },
      tables: [],
      attachments: [],
      excludedColumns: [...SECRET_COLUMNS].sort(),
    };

    try {
      const models = Prisma.dmmf.datamodel.models
        .filter((m) => TENANT_MODELS.has(m.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const model of models) {
        const table = model.dbName ?? model.name;
        const delegate = (prisma as unknown as Record<string, any>)[
          model.name.charAt(0).toLowerCase() + model.name.slice(1)
        ];
        if (!delegate?.findMany) continue;
        const idField = model.fields.find((f) => f.isId)?.name ?? model.primaryKey?.fields[0];
        const orderBy = idField ? { [idField]: "asc" } : undefined;
        const fileColumns = FILE_COLUMNS[model.name] ?? [];
        const lines: string[] = [];
        let rows = 0;
        for (let skip = 0; ; skip += PAGE) {
          const page: Record<string, unknown>[] = await delegate.findMany({
            skip,
            take: PAGE,
            ...(orderBy && { orderBy }),
          });
          for (const r of page) {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(r)) {
              if (!SECRET_COLUMNS.has(k)) clean[k] = plain(v);
            }
            lines.push(JSON.stringify(clean));
            for (const col of fileColumns) {
              for (const url of urlsIn(r[col])) {
                manifest.attachments.push({
                  table,
                  id: String(r[idField ?? "id"] ?? ""),
                  column: col,
                  url,
                  included: false,
                  file: null,
                });
              }
            }
          }
          rows += page.length;
          if (page.length < PAGE) break;
        }
        await tar.file(`tables/${table}.ndjson`, lines.length ? lines.join("\n") + "\n" : "");
        manifest.tables.push({ table, model: model.name, rows, file: `tables/${table}.ndjson` });
        logger.debug({ exportId, table, rows }, "account export table written");
      }

      // Files the rows point at, when they live in this instance's uploads folder.
      const seen = new Set<string>();
      for (const a of manifest.attachments) {
        const rel = localUpload(a.url);
        if (!rel) continue;
        const source = path.join(UPLOADS_DIR, rel);
        if (!source.startsWith(UPLOADS_DIR)) continue;
        try {
          const info = await stat(source);
          if (!info.isFile()) continue;
          const target = `attachments/${rel.replace(/\\/g, "/")}`;
          if (!seen.has(target)) {
            seen.add(target);
            const entry = await tar.open(target, info.size, info.mtime);
            for await (const chunk of createReadStream(source)) await entry.write(chunk as Buffer);
            await entry.end();
          }
          a.included = true;
          a.file = target;
        } catch {
          // Missing on disk: listed in the manifest as not included.
        }
      }

      await tar.file("manifest.json", JSON.stringify(manifest, null, 2));
      await tar.file(
        "README.txt",
        [
          `Shiftline account export for ${company.companyName} (${company.companyCode ?? company.id})`,
          `Generated ${started.toISOString()} · format ${FORMAT_VERSION}`,
          "",
          "tables/<table>.ndjson  one JSON object per row, every tenant table, secrets removed",
          "attachments/           files referenced by the rows, when stored on this instance",
          "manifest.json          row counts per table and the attachment index",
          "",
          "Open with any archiver or `tar -xzf`. Money is decimal text; dates are ISO 8601 UTC.",
        ].join("\n")
      );
      await tar.close();
      gzip.end();
      await piped; // resolves once the file stream has finished and closed

      const size = (await stat(full)).size;
      const rawToken = newDownloadToken();
      const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 60 * 60 * 1000);
      const done = await prisma.accountExport.update({
        where: { id: exportId },
        data: {
          status: "READY",
          completedAt: new Date(),
          expiresAt,
          fileName,
          sizeBytes: BigInt(size),
          sha256: hash.digest("hex"),
          tableCounts: Object.fromEntries(manifest.tables.map((t) => [t.table, t.rows])),
          attachmentCount: manifest.attachments.filter((a) => a.included).length,
          tokenHash: hashDownloadToken(rawToken),
        },
      });
      const link = `${env.BACKEND_URL}/api/account-export/${exportId}/download?token=${rawToken}`;
      if (row.requestedBy) {
        await notify({
          category: "account-export",
          title: "Your account export is ready",
          body: `${manifest.tables.reduce((n, t) => n + t.rows, 0)} rows across ${manifest.tables.length} tables, ${done.attachmentCount} files. The link works for ${EXPORT_TTL_HOURS} hours.`,
          link,
          to: { userIds: [row.requestedBy] },
        });
      }
      logger.info({ exportId, companyId, fileName, size }, "account export ready");
      return { ...done, downloadLink: link };
    } catch (err) {
      gzip.destroy();
      out.destroy();
      await unlink(full).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      await prisma.accountExport.update({
        where: { id: exportId },
        data: { status: "FAILED", completedAt: new Date(), error: message.slice(0, 500) },
      });
      if (row.requestedBy) {
        await notify({
          category: "account-export",
          level: "WARNING",
          title: "Your account export failed",
          body: "Shiftline could not build the archive. Try again; if it fails twice, contact support.",
          to: { userIds: [row.requestedBy] },
        });
      }
      throw err;
    }
  });

/** Marks READY exports past their expiry as EXPIRED and removes their files. */
export const expireAccountExports = async (companyId: string) =>
  runAsTenant(companyId, async () => {
    const stale = await prisma.accountExport.findMany({
      where: { status: "READY", expiresAt: { lte: new Date() } },
    });
    for (const s of stale) {
      if (s.fileName) {
        await unlink(path.resolve(env.EXPORT_DIR, companyId, s.fileName)).catch(() => undefined);
      }
      await prisma.accountExport.update({
        where: { id: s.id },
        data: { status: "EXPIRED", tokenHash: null },
      });
    }
    return stale.length;
  });

export const accountExportHandler = async (job: PgBoss.Job<AccountExportJobData>) => {
  const { exportId, companyId } = job.data;
  const result = await runAccountExport(exportId, companyId);
  return { exportId, status: result.status, fileName: result.fileName };
};
