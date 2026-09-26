/**
 * A file the moderator chose (for example a bulk download), readable by byte
 * range. Zips are read this way, so listing an archive reads only its
 * directory, and only the selected members are ever read (#47).
 */

import type { ByteSource } from "../core/zip.ts";

export function fileSource(file: File): ByteSource {
  return {
    name: file.name,
    size: file.size,
    read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()),
  };
}
