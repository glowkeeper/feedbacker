// Utility to extract text from PDF files using a lightweight approach
// This uses a simple solution - for production, consider using pdf.js or similar

export async function extractTextFromPDF(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer
        // For now, we'll use a simple approach - try to extract basic text
        // For production, integrate pdf.js or pdf-parse
        const text = await extractPDFText(arrayBuffer)
        resolve(text)
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsArrayBuffer(file)
  })
}

// Simple PDF text extraction - extracts UTF-8 encoded text from PDF
// For more robust extraction, use pdf.js library
async function extractPDFText(arrayBuffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuffer)
  const text: string[] = []

  // Convert bytes to string, filtering for printable ASCII and UTF-8
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]

    // Look for text streams in PDF
    if (byte >= 32 && byte <= 126) {
      // Printable ASCII
      text.push(String.fromCharCode(byte))
    } else if (byte === 10 || byte === 13) {
      // Newline
      text.push('\n')
    }
  }

  let extracted = text.join('')

  // Clean up PDF artifacts
  extracted = extracted
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '') // Remove control characters
    .replace(/stream.*?endstream/gs, '') // Remove stream content
    .replace(/obj.*?endobj/gs, '') // Remove object markers
    .replace(/\s+/g, ' ') // Normalize whitespace

  return extracted.trim()
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
