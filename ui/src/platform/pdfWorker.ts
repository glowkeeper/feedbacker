/**
 * pdf.js in the browser runs its parser in a web worker, loaded from the app's
 * own origin (the proxy's Content Security Policy allows `worker-src 'self'`).
 * Import this once, before any PDF is opened.
 */

import { GlobalWorkerOptions } from "#pdfjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
