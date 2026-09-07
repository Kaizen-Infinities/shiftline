import { once } from "node:events";
import type { Writable } from "node:stream";

/**
 * Minimal POSIX ustar writer (P1-03): enough to stream files of any size into a tar that
 * `tar -xzf` and every desktop archiver open, without a dependency. Long names use the
 * ustar prefix field (up to 255 bytes); entries are regular files with mode 0644.
 */
const BLOCK = 512;

const pad = (n: number, width: number) => n.toString(8).padStart(width - 1, "0") + "\0";

const header = (name: string, size: number, mtime: Date): Buffer => {
  const buf = Buffer.alloc(BLOCK, 0);
  let base = name;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const slash = name.lastIndexOf("/", 154);
    if (slash <= 0) throw new Error(`tar entry name too long: ${name}`);
    prefix = name.slice(0, slash);
    base = name.slice(slash + 1);
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) {
      throw new Error(`tar entry name too long: ${name}`);
    }
  }
  buf.write(base, 0, 100, "utf8");
  buf.write(pad(0o644, 8), 100, 8, "ascii");
  buf.write(pad(0, 8), 108, 8, "ascii");
  buf.write(pad(0, 8), 116, 8, "ascii");
  buf.write(pad(size, 12), 124, 12, "ascii");
  buf.write(pad(Math.floor(mtime.getTime() / 1000), 12), 136, 12, "ascii");
  buf.write("        ", 148, 8, "ascii"); // checksum placeholder
  buf.write("0", 156, 1, "ascii"); // regular file
  buf.write("ustar\0", 257, 6, "ascii");
  buf.write("00", 263, 2, "ascii");
  buf.write("shiftline", 265, 32, "utf8");
  buf.write("shiftline", 297, 32, "utf8");
  if (prefix) buf.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of buf) sum += b;
  buf.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return buf;
};

export class TarWriter {
  constructor(private readonly out: Writable) {}

  private async push(chunk: Buffer) {
    if (!this.out.write(chunk)) await once(this.out, "drain");
  }

  /** Adds a whole in-memory file. */
  async file(name: string, content: Buffer | string, mtime = new Date()) {
    const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    await this.push(header(name, body.length, mtime));
    await this.push(body);
    await this.pad(body.length);
  }

  /**
   * Adds a file whose size is known up front and whose body arrives in chunks
   * (call `write` for each chunk, then `end`).
   */
  async open(name: string, size: number, mtime = new Date()) {
    await this.push(header(name, size, mtime));
    let written = 0;
    return {
      write: async (chunk: Buffer) => {
        written += chunk.length;
        if (written > size) throw new Error(`tar entry ${name} exceeds its declared size`);
        await this.push(chunk);
      },
      end: async () => {
        if (written !== size) throw new Error(`tar entry ${name} is short: ${written}/${size}`);
        await this.pad(size);
      },
    };
  }

  private async pad(size: number) {
    const rest = size % BLOCK;
    if (rest) await this.push(Buffer.alloc(BLOCK - rest, 0));
  }

  /** Two zero blocks close the archive. */
  async close() {
    await this.push(Buffer.alloc(BLOCK * 2, 0));
  }
}

/** Reads a tar buffer back into a map (tests, small archives). */
export const readTar = (buf: Buffer): Map<string, Buffer> => {
  const out = new Map<string, Buffer>();
  let pos = 0;
  while (pos + BLOCK <= buf.length) {
    const h = buf.subarray(pos, pos + BLOCK);
    if (h.every((b) => b === 0)) break;
    const base = h.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = h.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(h.subarray(124, 136).toString("ascii").replace(/\0.*$/, ""), 8);
    const name = prefix ? `${prefix}/${base}` : base;
    out.set(name, Buffer.from(buf.subarray(pos + BLOCK, pos + BLOCK + size)));
    pos += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
};
