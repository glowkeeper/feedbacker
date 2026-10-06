/**
 * Remove an image's hidden metadata, keeping its pixels: a port of `core/src/feedbacker_core/image_metadata.py`.
 *
 * A figure is reviewed by its picture, but its file may carry what the picture doesn't show: a photo's camera details,
 * date or location (EXIF), an author or software name (XMP, IPTC, text chunks), comments. This rewrites the file's
 * structure without decoding it, keeping only what draws the image, so the same bytes come out in the browser, in Node
 * and in Python. A file that can't be read is refused (null), never passed on as it is.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The PNG chunks that draw the image (and its animation); every other chunk is left out. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT", "bKGD", "pHYs", "acTL", "fcTL", "fdAT"]);
/** JPEG application segments kept: JFIF (APP0) and Adobe's colour transform (APP14). Every other APPn, and comments, go. */
const JPEG_KEEP_APP = new Set([0xe0, 0xee]);
/** GIF application extensions kept: animation looping. */
const GIF_KEEP_APP = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

class Unreadable extends Error {}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);
function need(bytes: Uint8Array, end: number) {
  if (end > bytes.length) throw new Unreadable();
}

function png(bytes: Uint8Array): Uint8Array {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) throw new Unreadable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let at = 8;
  let ended = false;
  while (!ended) {
    need(bytes, at + 12);
    const length = view.getUint32(at);
    const type = ascii(bytes.subarray(at + 4, at + 8));
    need(bytes, at + 12 + length);
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(at, at + 12 + length));
    ended = type === "IEND";
    at += 12 + length;
  }
  return concat(parts);
}

function jpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Unreadable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 2)];
  let at = 2;
  for (;;) {
    need(bytes, at + 2);
    if (bytes[at] !== 0xff) throw new Unreadable();
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // a fill byte
      continue;
    }
    if (marker === 0xd9) return concat([...parts, bytes.subarray(at, at + 2)]); // the end, with no image data: kept as it is
    need(bytes, at + 4);
    const length = view.getUint16(at + 2);
    need(bytes, at + 2 + length);
    const segment = bytes.subarray(at, at + 2 + length);
    if (marker === 0xda) return concat([...parts, bytes.subarray(at)]); // the scan: the image data, and everything after it, as it is
    const app = marker >= 0xe0 && marker <= 0xef;
    if ((app && JPEG_KEEP_APP.has(marker)) || (!app && marker !== 0xfe)) parts.push(segment);
    at += 2 + length;
  }
}

/** A GIF's data sub-blocks from `at`: where they end (after the terminator). */
function gifSubBlocks(bytes: Uint8Array, at: number): number {
  for (;;) {
    need(bytes, at + 1);
    const size = bytes[at];
    at += 1 + size;
    if (size === 0) return at;
  }
}

function gif(bytes: Uint8Array): Uint8Array {
  if (ascii(bytes.subarray(0, 4)) !== "GIF8") throw new Unreadable();
  need(bytes, 13);
  const globalTable = bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 0x07) + 1) : 0;
  let at = 13 + globalTable;
  need(bytes, at);
  const parts = [bytes.subarray(0, at)];
  for (;;) {
    need(bytes, at + 1);
    const block = bytes[at];
    if (block === 0x3b) return concat([...parts, bytes.subarray(at, at + 1)]);
    if (block === 0x2c) {
      need(bytes, at + 10);
      const localTable = bytes[at + 9] & 0x80 ? 3 * 2 ** ((bytes[at + 9] & 0x07) + 1) : 0;
      const end = gifSubBlocks(bytes, at + 10 + localTable + 1); // after the LZW minimum code size
      parts.push(bytes.subarray(at, end));
      at = end;
    } else if (block === 0x21) {
      need(bytes, at + 2);
      const label = bytes[at + 1];
      const end = gifSubBlocks(bytes, at + 2);
      const id = label === 0xff && bytes[at + 2] === 11 ? ascii(bytes.subarray(at + 3, at + 14)) : "";
      const keep = label === 0xf9 || label === 0x01 || (label === 0xff && GIF_KEEP_APP.has(id)); // timing and plain text; looping
      if (keep) parts.push(bytes.subarray(at, end));
      at = end;
    } else throw new Unreadable();
  }
}

function webp(bytes: Uint8Array): Uint8Array {
  if (ascii(bytes.subarray(0, 4)) !== "RIFF" || ascii(bytes.subarray(8, 12)) !== "WEBP") throw new Unreadable();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const chunks: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= end) {
    const type = ascii(bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const next = at + 8 + size + (size % 2);
    need(bytes, Math.min(next, at + 8 + size));
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = bytes.slice(at, Math.min(next, bytes.length));
      if (type === "VP8X") chunk[8] &= ~(0x08 | 0x04); // the extended header's flags: no EXIF, no XMP
      chunks.push(chunk);
    }
    at = next;
  }
  const body = concat([new TextEncoder().encode("WEBP"), ...chunks]);
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode("RIFF"));
  new DataView(header.buffer).setUint32(4, body.length, true);
  return concat([header, body]);
}

const CLEANERS: Record<string, (bytes: Uint8Array) => Uint8Array> = { "image/png": png, "image/jpeg": jpeg, "image/gif": gif, "image/webp": webp };

/** The types whose metadata can be removed: those the AI may be sent. */
export const cleanable = (mediaType: string) => Object.hasOwn(CLEANERS, mediaType);

/** The image without its hidden metadata; null if it can't be read. Only for a type that is `cleanable`. */
export function withoutMetadata(bytes: Uint8Array, mediaType: string): Uint8Array | null {
  const clean = CLEANERS[mediaType];
  if (!clean) throw new Error(`no way to remove metadata from ${mediaType}`);
  try {
    return clean(bytes);
  } catch (err) {
    if (err instanceof Unreadable || err instanceof RangeError) return null;
    throw err;
  }
}
