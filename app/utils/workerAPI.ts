// Utility to call the Feedbacker Worker backend API

import type { Rubric } from '@/app/store/types'

interface WorkerFeedbackRequest {
  rubric: Rubric
  assessmentText: string
  sessionId?: string
  prompt?: string
}

interface WorkerFeedbackResponse {
  feedback: string
  cached: boolean
  feedbackId: string
  similarityScore?: number
  timestamp: number
}

function resolveTimeoutMs(envValue: string | undefined, fallbackMs: number): number {
  const parsed = Number(envValue)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs
  }

  // Guardrails: min 10s, max 10m
  return Math.min(600000, Math.max(10000, parsed))
}

export async function callWorkerFeedback(
  request: WorkerFeedbackRequest
): Promise<WorkerFeedbackResponse> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL

  if (!workerUrl) {
    throw new Error('Worker URL not configured (NEXT_PUBLIC_WORKER_URL)')
  }

  const controller = new AbortController()
  const timeoutMs = resolveTimeoutMs(process.env.NEXT_PUBLIC_WORKER_TIMEOUT_MS, 300000)
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  const startedAt = Date.now()
  const payloadSize = JSON.stringify(request).length
  console.log(`[DEBUG] Sending to Worker...`)
  console.log(`[DEBUG] Timeout: ${timeoutMs / 1000}s`)
  console.log(`[DEBUG] Payload size: ${(payloadSize / 1024).toFixed(2)}KB`)
  console.log(`[DEBUG] Rubric rows: ${request.rubric.length}`)
  console.log(`[DEBUG] Assessment text: ${request.assessmentText.length} chars`)
  console.log(`[DEBUG] Custom prompt: ${request.prompt ? request.prompt.length : 0} chars`)

  let response: Response
  try {
    response = await fetch(`${workerUrl}/api/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
  } catch (error: unknown) {
    const elapsed = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('aborted') || message.includes('AbortError')) {
      console.error(`[DEBUG] ✗ Worker request TIMEOUT after ${elapsed}ms (configured: ${timeoutMs}ms)`)
      throw new Error(`Worker request timed out after ${timeoutMs / 1000}s`)
    }
    console.error(`[DEBUG] ✗ Worker request FAILED: ${message}`)
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }

  const elapsed = Date.now() - startedAt
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEBUG] ✓ Worker response received after ${elapsed}ms`)
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Worker error: ${response.status} ${error}`)
  }

  return await response.json()
}

/**
 * Fallback to direct OpenRouter call (for development without Worker)
 */
interface DirectFeedbackRequest {
  prompt: string
  rubricBase64?: string
  studentBase64?: string
}

type FileEncodingMode = 'raw-base64' | 'data-url'

function normalizeBase64(input: string): string {
  // Support both raw base64 and data URLs from FileReader.readAsDataURL.
  const withoutPrefix = input.replace(/^data:[^;]+;base64,/, '')
  const compact = withoutPrefix.replace(/\s+/g, '')

  // Keep only standard base64 alphabet to avoid transport artifacts.
  const sanitized = compact.replace(/[^A-Za-z0-9+/=]/g, '')

  // Canonicalize when possible to avoid parser issues with malformed padding.
  if (typeof atob === 'function' && typeof btoa === 'function') {
    try {
      return btoa(atob(sanitized))
    } catch {
      return sanitized
    }
  }

  return sanitized
}

function toFileData(input: string, mode: FileEncodingMode): string {
  const normalized = normalizeBase64(input)
  if (mode === 'raw-base64') {
    return normalized
  }
  return `data:application/pdf;base64,${normalized}`
}

function assertLikelyPdfBase64(base64: string, label: string): void {
  // Most PDFs start with "%PDF" -> base64 prefix "JVBERi0".
  if (!base64.startsWith('JVBERi0')) {
    console.warn(`[WARN] ${label} payload does not look like a PDF base64 header`)
  }
}

export async function callOpenRouterDirectly(request: DirectFeedbackRequest): Promise<string> {
  const url = process.env.NEXT_PUBLIC_OPENROUTER_URL
  const key = process.env.NEXT_PUBLIC_OPENROUTER_KEY

  if (!url || !key) {
    throw new Error('OpenRouter not configured')
  }

  const buildContent = (encodingMode: FileEncodingMode): any[] => {
    const content: any[] = [
      {
        type: 'text',
        text: request.prompt,
      },
    ]

    if (request.rubricBase64) {
      const normalizedRubric = normalizeBase64(request.rubricBase64)
      assertLikelyPdfBase64(normalizedRubric, 'rubric.pdf')

      content.push({
        type: 'file',
        file: {
          filename: 'rubric.pdf',
          mime_type: 'application/pdf',
          file_data: toFileData(request.rubricBase64, encodingMode),
        },
      })
    }

    if (request.studentBase64) {
      const normalizedSubmission = normalizeBase64(request.studentBase64)
      assertLikelyPdfBase64(normalizedSubmission, 'submission.pdf')

      content.push({
        type: 'file',
        file: {
          filename: 'submission.pdf',
          mime_type: 'application/pdf',
          file_data: toFileData(request.studentBase64, encodingMode),
        },
      })
    }

    return content
  }

  const controller = new AbortController()
  const timeoutMs = 180000
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)

  const sendWithEncoding = async (encodingMode: FileEncodingMode): Promise<Response> => {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_HOMEPAGE || '',
        'X-Title': process.env.NEXT_PUBLIC_TITLE || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        messages: [
          {
            role: 'user',
            content: buildContent(encodingMode),
          },
        ],
        reasoning: {
          effort: 'high',
          exclude: true,
        },
        plugins: [
          {
            id: 'file-parser',
            pdf: {
              engine: 'pdf-text',
            },
          },
        ],
        stream: false,
      }),
      signal: controller.signal,
    })
  }

  let response: Response
  try {
    response = await sendWithEncoding('raw-base64')

    if (!response.ok) {
      const firstErrorBody = await response.text()
      const shouldRetryDataUrl =
        response.status === 400 &&
        (firstErrorBody.includes('Invalid content') ||
          firstErrorBody.includes('Failed to parse rubric.pdf') ||
          firstErrorBody.includes('Failed to parse submission.pdf'))

      if (shouldRetryDataUrl) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[WARN] OpenRouter rejected first PDF payload mode; retrying with data URL encoding')
        }
        response = await sendWithEncoding('data-url')
      } else {
        throw new Error(`OpenRouter error: ${response.status} ${firstErrorBody}`)
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('aborted') || message.includes('AbortError')) {
      throw new Error(`OpenRouter request timed out after ${timeoutMs / 1000}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter error: ${response.status} ${error}`)
  }

  interface OpenRouterResponse {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  const data = (await response.json()) as OpenRouterResponse
  const feedback = data.choices?.[0]?.message?.content

  if (!feedback) {
    throw new Error('No feedback in response')
  }

  return feedback
}
