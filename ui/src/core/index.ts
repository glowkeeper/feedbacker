/** The Feedbacker core: no UI or DOM dependencies (ADR 0004). */

export * from "./contract.ts";
export * from "./models.ts";
export { codePointLength, instant, isWellFormed, normaliseTimestamp, sha256Text } from "./text.ts";
export * from "./fs.ts";
export * from "./workspace.ts";
export * from "./archive.ts";
export * from "./extract.ts";
export { InspectionError, inspectDocx, inspectFile, inspectPdf, inspectZip, nameShape } from "./structure.ts";
export { bytesSource, hashSource, listZip, readMember, ZipError, type ByteSource, type ZipEntry } from "./zip.ts";
export * from "./request.ts";
export * from "./originals.ts";
