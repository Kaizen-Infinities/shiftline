import ImageKit from "imagekit";
import { env } from "./env";
import { ApiError } from "../utils/ApiError";

let client: ImageKit | null = null;

/** Lazily constructed so the API boots without ImageKit configured; uploads then fail with 503. */
export const getImageKit = (): ImageKit => {
  if (client) return client;
  if (!env.IMAGEKIT_PUBLIC_KEY || !env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_URL_ENDPOINT) {
    throw new ApiError(503, "File storage is not configured (IMAGEKIT_* variables missing)");
  }
  client = new ImageKit({
    publicKey: env.IMAGEKIT_PUBLIC_KEY,
    privateKey: env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
  });
  return client;
};

/**
 * Upload a file buffer (from multer memoryStorage) to ImageKit and return its URL.
 * @param folder ImageKit folder path, e.g. "/shiftline/employees"
 */
export async function uploadToImageKit(
  buffer: Buffer,
  fileName: string,
  folder: string = "/shiftline"
): Promise<string> {
  const result = await getImageKit().upload({
    file: buffer.toString("base64"),
    fileName,
    folder,
    useUniqueFileName: true,
    transformation: { pre: "w-400,h-400,c-maintain_ratio" },
  });
  return result.url;
}
