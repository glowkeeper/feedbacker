/**
 * An image's size in pixels, read from its header (PNG, JPEG, GIF, WebP), to check a figure against the provider's
 * limits before it is sent (ADR 0007). Nothing is decoded; null if the header can't be read.
 */

export interface PixelSize {
  width: number;
  height: number;
}

export function imageSize(bytes: Uint8Array): PixelSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = (i: number, text: string) => [...text].every((c, j) => bytes[i + j] === c.charCodeAt(0));
  try {
    // PNG: the IHDR chunk comes first.
    if (bytes[0] === 0x89 && at(1, "PNG")) return { width: view.getUint32(16), height: view.getUint32(20) };
    // GIF: the logical screen's size, little-endian.
    if (at(0, "GIF8")) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
    if (at(0, "RIFF") && at(8, "WEBP")) {
      if (at(12, "VP8 ")) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      if (at(12, "VP8L")) {
        const b = view.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (at(12, "VP8X")) return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
      return null;
    }
    // JPEG: the first start-of-frame marker.
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1];
        if (marker === 0xff) {
          i++; // fill byte
          continue;
        }
        const length = view.getUint16(i + 2);
        const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrame) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
        i += 2 + length;
      }
    }
  } catch {
    return null; // a header cut short
  }
  return null;
}
