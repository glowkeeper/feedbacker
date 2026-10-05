/**
 * A minimal PNG encoder, for a PDF's figures: pdf.js gives an image's decoded pixels, not its file, so they are kept
 * as PNG. The same code (and fflate's deflate, at a fixed level) runs in the browser and in Node, so the same pixels
 * always give the same bytes, and the same hash.
 */

import { zlibSync } from "fflate";

/** Pixel layouts, as pdf.js's ImageKind: 1 bit grey (1 is white, rows padded to a byte), 8-bit RGB, 8-bit RGBA. */
export const PIXELS = { GREY_1BIT: 1, RGB: 2, RGBA: 3 } as const;
export type PixelKind = (typeof PIXELS)[keyof typeof PIXELS];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const body = out.subarray(4, 8 + data.length);
  body.set([...type].map((c) => c.charCodeAt(0)));
  body.set(data, 4);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

/** Encode pixels as a PNG, each row unfiltered. */
export function encodePng(width: number, height: number, kind: PixelKind, data: Uint8Array | Uint8ClampedArray): Uint8Array {
  const [colourType, bitDepth, rowBytes] = kind === PIXELS.GREY_1BIT ? [0, 1, Math.ceil(width / 8)] : kind === PIXELS.RGB ? [2, 8, width * 3] : [6, 8, width * 4];
  if (data.length < rowBytes * height) throw new Error(`the image's pixels are short: ${data.length} bytes for ${width}×${height}`);
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1); // filter byte 0: none
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([bitDepth, colourType, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
