// PDF text extraction using pdf.js for robust, reliable parsing.
// Load pdf.js lazily in the browser to avoid SSR/module-evaluation issues.

type PdfJsModule = {
  version?: string
  GlobalWorkerOptions: {
    workerSrc: string
  }
  getDocument: (src: {
    data: ArrayBuffer
    disableWorker?: boolean
    stopAtErrors?: boolean
    isEvalSupported?: boolean
  }) => {
    promise: Promise<{
      numPages: number
      getPage: (page: number) => Promise<{
        getTextContent: () => Promise<{ items: unknown[] }>
      }>
    }>
  }
}

let pdfJsModulePromise: Promise<PdfJsModule> | null = null

const PDF_LOAD_TIMEOUT_MS = 60000  // Increased from 30s to handle larger PDFs
const PAGE_EXTRACT_TIMEOUT_MS = 20000  // Increased from 12s per-page
const MAX_PAGES_TO_PROCESS = 80
const FILE_READ_TIMEOUT_MS = 45000  // Increased from 20s for file reading into memory

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function getPdfJs(): Promise<PdfJsModule> {
  if (typeof window === 'undefined') {
    throw new Error('PDF extraction is only supported in the browser runtime')
  }

  if (!pdfJsModulePromise) {
    // Use legacy build for broader runtime compatibility in browser toolchains.
    pdfJsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      // Prefer a locally bundled worker URL so we don't rely on external CDN availability.
      if (!mod.GlobalWorkerOptions.workerSrc) {
        try {
          mod.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
            import.meta.url
          ).toString()
        } catch {
          const version = mod.version || '5.7.284'
          mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`
        }
      }
      return mod as PdfJsModule
    })
  }

  return pdfJsModulePromise
}

export async function extractTextFromPDF(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const timeoutId = setTimeout(() => {
      try {
        reader.abort()
      } catch {
        // noop
      }
      reject(new Error(`Reading ${file.name} timed out after ${Math.round(FILE_READ_TIMEOUT_MS / 1000)}s`))
    }, FILE_READ_TIMEOUT_MS)

    reader.onload = async () => {
      try {
        clearTimeout(timeoutId)
        const arrayBuffer = reader.result as ArrayBuffer
        const text = await extractPDFText(arrayBuffer, file.name)
        resolve(text)
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Failed to extract PDF text'))
      }
    }

    reader.onerror = () => {
      clearTimeout(timeoutId)
      reject(new Error('Failed to read file'))
    }

    reader.readAsArrayBuffer(file)
  })
}

// Extract text from PDF using pdf.js library
async function extractPDFText(arrayBuffer: ArrayBuffer, fileName: string): Promise<string> {
  const pdfjsLib = await getPdfJs()

  // Try worker mode first (faster and non-blocking), then fallback to disableWorker mode.
  let pdf: Awaited<ReturnType<ReturnType<PdfJsModule['getDocument']>['promise']['then']>> extends never
    ? never
    : {
        numPages: number
        getPage: (page: number) => Promise<{
          getTextContent: () => Promise<{ items: unknown[] }>
        }>
      }

  const workerLoadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    stopAtErrors: true,
    isEvalSupported: false,
  })

  try {
    pdf = await withTimeout(workerLoadingTask.promise, 90000, `Loading PDF ${fileName} (worker mode)`)
  } catch (workerError) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[WARN] Worker-mode PDF load failed, retrying without worker', {
        fileName,
        error: workerError instanceof Error ? workerError.message : String(workerError),
      })
    }

    const fallbackLoadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      disableWorker: true,
      stopAtErrors: true,
      isEvalSupported: false,
    })

    pdf = await withTimeout(
      fallbackLoadingTask.promise,
      PDF_LOAD_TIMEOUT_MS,
      `Loading PDF ${fileName} (fallback mode)`
    )
  }
  const textPages: string[] = []

  const pagesToProcess = Math.min(pdf.numPages, MAX_PAGES_TO_PROCESS)

  if (process.env.NODE_ENV !== 'production') {
    console.log('[DEBUG] PDF extraction started', {
      fileName,
      totalPages: pdf.numPages,
      pagesToProcess,
    })
  }

  // Iterate through all pages
  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
    try {
      const page = await withTimeout(
        pdf.getPage(pageNum),
        PAGE_EXTRACT_TIMEOUT_MS,
        `Loading page ${pageNum} of ${fileName}`
      )
      const textContent = await withTimeout(
        page.getTextContent(),
        PAGE_EXTRACT_TIMEOUT_MS,
        `Extracting page ${pageNum} text from ${fileName}`
      )

      // Extract text items from the page
      const pageText = (textContent.items as any[])
        .map((item: any) => {
          // Handle different item types (text, spaces, etc.)
          if ('str' in item) {
            return item.str
          }
          if ('chars' in item) {
            return item.chars.map((c: any) => c.unicode || '').join('')
          }
          return ''
        })
        .join('')

      if (pageText.trim()) {
        textPages.push(pageText)
      }

      if (process.env.NODE_ENV !== 'production' && (pageNum === 1 || pageNum % 5 === 0)) {
        console.log('[DEBUG] PDF extraction progress', {
          fileName,
          pageNum,
          pagesToProcess,
          extractedChars: pageText.length,
        })
      }
    } catch (pageError) {
      // Log page error but continue with other pages
      console.warn(`Failed to extract page ${pageNum}:`, pageError)
    }
  }

  if (pdf.numPages > MAX_PAGES_TO_PROCESS && process.env.NODE_ENV !== 'production') {
    console.warn(
      `[DEBUG] ${fileName} has ${pdf.numPages} pages; processed first ${MAX_PAGES_TO_PROCESS} only`
    )
  }

  // Join all pages and clean up whitespace
  let fullText = textPages.join('\n\n')

  // Normalize whitespace
  fullText = fullText
    .replace(/\s+/g, ' ') // Multiple spaces to single
    .replace(/\n\s*\n/g, '\n') // Multiple newlines to single
    .trim()

  if (process.env.NODE_ENV !== 'production') {
    const preview = fullText.substring(0, 150).replace(/\n/g, ' ')
    console.log('[DEBUG] PDF extraction completed', {
      fileName,
      totalChars: fullText.length,
      pagesExtracted: textPages.length,
      pagesToProcess,
      preview: preview + (fullText.length > 150 ? '...' : ''),
    })
  }

  return fullText
}

/**
 * Alternative: Return base64 and let Worker handle extraction
 * Use this if frontend extraction is unreliable
 */
export function getBase64FromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] || result
      resolve(base64)
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsDataURL(file)
  })
}
