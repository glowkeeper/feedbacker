/**
 * Reading zip archives by byte range, so that listing a bulk download never
 * opens any member, and only the members asked for are ever read.
 *
 * The central directory at the end of the archive lists every member. A
 * member's bytes are fetched and inflated only when `readMember` is called
 * for it, and are checked against the stored CRC-32. Names are decoded as
 * Python's zipfile decodes them: UTF-8 when the archive says so, otherwise
 * code page 437. Stored and deflated members are supported, zip64 included;
 * encrypted members are refused.
 */

import { inflateSync } from "fflate";

/** Something whose bytes can be read by range: a `File` in the browser, a file in tests. */
export interface ByteSource {
  readonly name: string;
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** A source over bytes already in memory. */
export function bytesSource(name: string, bytes: Uint8Array): ByteSource {
  return {
    name,
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(offset + length, bytes.length)),
  };
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipEntry {
  /** The member name as stored (folders separated by "/"). */
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  size: number;
  crc32: number;
  method: number;
  encrypted: boolean;
  localHeaderOffset: number;
}

const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

// Code page 437, bytes 0x80-0xff (bytes below 0x80 are ASCII), as Python decodes names without the UTF-8 flag.
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

function cp437(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return out;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

let CRC_TABLE: Uint32Array | null = null;
export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Values of 0xffff/0xffffffff mean "see the zip64 extra field". */
function zip64Extra(extra: Uint8Array, wanted: { size: boolean; compressed: boolean; offset: boolean }) {
  const v = view(extra);
  for (let i = 0; i + 4 <= extra.length; ) {
    const id = v.getUint16(i, true);
    const len = v.getUint16(i + 2, true);
    if (id === 0x0001) {
      let p = i + 4;
      const next = () => {
        const value = Number(v.getBigUint64(p, true));
        p += 8;
        return value;
      };
      return {
        size: wanted.size ? next() : undefined,
        compressed: wanted.compressed ? next() : undefined,
        offset: wanted.offset ? next() : undefined,
      };
    }
    i += 4 + len;
  }
  throw new ZipError("a zip64 entry has no zip64 extra field");
}

/** List every entry, reading only the end of the archive and its central directory. */
export async function listZip(source: ByteSource): Promise<ZipEntry[]> {
  if (source.size < 22) throw new ZipError("not a zip archive (too short)");
  const tailLength = Math.min(source.size, 22 + MAX_COMMENT + 20);
  const tail = await source.read(source.size - tailLength, tailLength);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("not a zip archive (no end of central directory)");

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator < 0 || tv.getUint32(locator, true) !== ZIP64_LOCATOR) throw new ZipError("a zip64 archive has no zip64 locator");
    const z64Offset = Number(tv.getBigUint64(locator + 8, true));
    const z64 = view(await source.read(z64Offset, 56));
    if (z64.getUint32(0, true) !== ZIP64_EOCD) throw new ZipError("the zip64 end of central directory is missing");
    count = Number(z64.getBigUint64(32, true));
    cdSize = Number(z64.getBigUint64(40, true));
    cdOffset = Number(z64.getBigUint64(48, true));
  }
  if (cdOffset + cdSize > source.size) throw new ZipError("the central directory lies outside the archive");

  const cd = await source.read(cdOffset, cdSize);
  const cv = view(cd);
  const entries: ZipEntry[] = [];
  for (let i = 0, n = 0; n < count; n++) {
    if (i + 46 > cd.length || cv.getUint32(i, true) !== CENTRAL) throw new ZipError("the central directory is damaged");
    const flags = cv.getUint16(i + 8, true);
    const method = cv.getUint16(i + 10, true);
    const crc = cv.getUint32(i + 16, true);
    let compressedSize = cv.getUint32(i + 20, true);
    let size = cv.getUint32(i + 24, true);
    const nameLength = cv.getUint16(i + 28, true);
    const extraLength = cv.getUint16(i + 30, true);
    const commentLength = cv.getUint16(i + 32, true);
    let localHeaderOffset = cv.getUint32(i + 42, true);
    const rawName = cd.subarray(i + 46, i + 46 + nameLength);
    const extra = cd.subarray(i + 46 + nameLength, i + 46 + nameLength + extraLength);
    if (size === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      const z = zip64Extra(extra, {
        size: size === 0xffffffff,
        compressed: compressedSize === 0xffffffff,
        offset: localHeaderOffset === 0xffffffff,
      });
      size = z.size ?? size;
      compressedSize = z.compressed ?? compressedSize;
      localHeaderOffset = z.offset ?? localHeaderOffset;
    }
    let name: string;
    if (flags & 0x800) {
      try {
        name = utf8.decode(rawName);
      } catch {
        throw new ZipError("a member name is not valid UTF-8");
      }
    } else {
      name = cp437(rawName);
    }
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      compressedSize,
      size,
      crc32: crc,
      method,
      encrypted: (flags & 1) === 1,
      localHeaderOffset,
    });
    i += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Read and check one member. Nothing else in the archive is read. */
export async function readMember(source: ByteSource, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError("the member is encrypted");
  const header = await source.read(entry.localHeaderOffset, 30);
  const hv = view(header);
  if (header.length < 30 || hv.getUint32(0, true) !== LOCAL) throw new ZipError("the member's local header is damaged");
  const start = entry.localHeaderOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const compressed = await source.read(start, entry.compressedSize);
  if (compressed.length !== entry.compressedSize) throw new ZipError("the member is truncated");
  let data: Uint8Array;
  if (entry.method === 0) data = compressed;
  else if (entry.method === 8) {
    try {
      data = inflateSync(compressed, { out: new Uint8Array(entry.size) });
    } catch {
      throw new ZipError("the member could not be decompressed");
    }
  } else throw new ZipError(`the member uses an unsupported compression method (${entry.method})`);
  if (data.length !== entry.size || crc32(data) !== entry.crc32) throw new ZipError("the member failed its integrity check");
  return data;
}
