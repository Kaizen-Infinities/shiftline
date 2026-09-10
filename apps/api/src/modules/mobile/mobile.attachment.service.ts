/**
 * Receipt / cheque / UPI screenshot storage for the Field app.
 *
 * Driver: MOBILE_STORAGE_DRIVER=imagekit|s3 (defaults to s3 when AWS_S3_BUCKET
 * is set, else ImageKit, which the ERP already uses). S3 needs the optional
 * `@aws-sdk/client-s3` package plus AWS_S3_BUCKET, AWS_REGION and credentials
 * (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or an instance role); optional
 * AWS_S3_PUBLIC_URL overrides the returned base URL (CloudFront etc.).
 */
import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";

import { env } from "../../config/env";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import { uploadToImageKit } from "../../utils/Imagekit";

const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export const uploadMobileAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new ApiError(400, "Only JPG, PNG, WEBP, HEIC images or PDF are allowed"));
    }
    cb(null, true);
  },
});

export type StorageDriver = "imagekit" | "s3";

export function activeDriver(): StorageDriver {
  if (env.MOBILE_STORAGE_DRIVER) return env.MOBILE_STORAGE_DRIVER;
  return env.AWS_S3_BUCKET ? "s3" : "imagekit";
}

export interface StoredFile {
  url: string;
  fileId?: string;
  driver: StorageDriver;
  size: number;
  mimeType: string;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

function extFor(file: Express.Multer.File) {
  const fromName = path
    .extname(file.originalname || "")
    .toLowerCase()
    .replace(".", "");
  return fromName || EXT[file.mimetype] || "bin";
}

/** Files are stored under the tenant id so two tenants never share a folder. */
export async function storeAttachment(
  file: Express.Multer.File,
  folder: string
): Promise<StoredFile> {
  const companyId = requireTenantId();
  const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "") || "misc";
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${extFor(file)}`;
  const driver = activeDriver();
  const key = `shiftline-mobile/${companyId}/${safeFolder}/${fileName}`;

  if (driver === "s3") {
    // Optional dependency: resolved at runtime so installs without it still boot.
    const specifier = "@aws-sdk/client-s3";
    let s3: {
      S3Client: new (o: object) => { send(c: unknown): Promise<unknown> };
      PutObjectCommand: new (o: object) => unknown;
    };
    try {
      s3 = (await import(specifier)) as typeof s3;
    } catch {
      throw new ApiError(500, "S3 storage selected but @aws-sdk/client-s3 is not installed");
    }
    const bucket = env.AWS_S3_BUCKET;
    const region = env.AWS_REGION || "ap-south-1";
    if (!bucket) throw new ApiError(500, "AWS_S3_BUCKET is not configured");
    const client = new s3.S3Client({ region });
    await client.send(
      new s3.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: { source: "shiftline-mobile", companyId },
      })
    );
    const base = (env.AWS_S3_PUBLIC_URL || `https://${bucket}.s3.${region}.amazonaws.com`).replace(
      /\/+$/,
      ""
    );
    return { url: `${base}/${key}`, fileId: key, driver, size: file.size, mimeType: file.mimetype };
  }

  const url = await uploadToImageKit(
    file.buffer,
    fileName,
    `/shiftline-mobile/${companyId}/${safeFolder}`
  );
  return { url, driver, size: file.size, mimeType: file.mimetype };
}
