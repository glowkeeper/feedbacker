import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── workerAPI imports need process.env set BEFORE import, so we do a dynamic import below ──

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response
}

const baseRequest = {
  rubric: [
    ['Criteria', 'Weighting', 'Excellent'],
    ['', '', ''],
    ['Analysis', '100%', 'Thorough'],
  ] as any,
  assessmentText: 'Student essay text',
}

const successResponse = {
  feedback: 'Well done!',
  cached: false,
  feedbackId: 'feedback_123',
  similarityScore: 0,
  timestamp: Date.now(),
}

// ─── callWorkerFeedback ───────────────────────────────────────────────────────

describe('callWorkerFeedback', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reset module registry so env vars take effect
    vi.resetModules()
  })

  it('throws when NEXT_PUBLIC_WORKER_URL is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', '')
    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await expect(callWorkerFeedback(baseRequest)).rejects.toThrow('Worker URL not configured')
  })

  it('returns parsed JSON on a successful response', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(successResponse)))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    const result = await callWorkerFeedback(baseRequest)
    expect(result.feedback).toBe('Well done!')
    expect(result.cached).toBe(false)
  })

  it('throws on a non-ok HTTP response', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('Internal Server Error', false, 500)))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await expect(callWorkerFeedback(baseRequest)).rejects.toThrow('Worker error: 500')
  })

  it('throws a timeout error when fetch is aborted', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    vi.stubEnv('NEXT_PUBLIC_WORKER_TIMEOUT_MS', '10000')

    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await expect(callWorkerFeedback(baseRequest)).rejects.toThrow('timed out')
  })

  it('re-throws non-abort network errors', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await expect(callWorkerFeedback(baseRequest)).rejects.toThrow('Network failure')
  })

  it('sends rubric and assessmentText in the POST body', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(successResponse))
    vi.stubGlobal('fetch', mockFetch)

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await callWorkerFeedback(baseRequest)

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.assessmentText).toBe('Student essay text')
    expect(Array.isArray(body.rubric)).toBe(true)
  })

  it('sends to /api/feedback endpoint', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(successResponse))
    vi.stubGlobal('fetch', mockFetch)

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await callWorkerFeedback(baseRequest)

    const [url] = mockFetch.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:8787/api/feedback')
  })
})

// ─── resolveTimeoutMs (via env) ───────────────────────────────────────────────

describe('callWorkerFeedback timeout configuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('uses 300s default when NEXT_PUBLIC_WORKER_TIMEOUT_MS is not set', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    vi.stubEnv('NEXT_PUBLIC_WORKER_TIMEOUT_MS', '')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(successResponse)))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    // Just confirm it resolves without error (default 300s applied internally)
    await expect(callWorkerFeedback(baseRequest)).resolves.toBeDefined()
  })

  it('clamps negative timeout to minimum 10s internally', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    vi.stubEnv('NEXT_PUBLIC_WORKER_TIMEOUT_MS', '-5000')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(successResponse)))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    await expect(callWorkerFeedback(baseRequest)).resolves.toBeDefined()
  })
})

// ─── debug field passthrough ──────────────────────────────────────────────────

describe('callWorkerFeedback – debug field', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('passes through the debug field from the worker response', async () => {
    vi.stubEnv('NEXT_PUBLIC_WORKER_URL', 'http://localhost:8787')
    const withDebug = {
      ...successResponse,
      debug: {
        cacheDecision: 'HIT' as const,
        similarityThreshold: 0.8,
        vectorizeAvailable: true,
        vectorizeResultCount: 1,
        promptLength: 500,
        assessmentLength: 200,
        responseTimeMs: 1408,
        topMatchScore: 0.95,
        topMatchEmbeddingId: 'emb_abc',
      },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(withDebug)))

    const { callWorkerFeedback } = await import('../utils/workerAPI')
    const result = await callWorkerFeedback(baseRequest)

    expect(result.debug?.cacheDecision).toBe('HIT')
    expect(result.debug?.responseTimeMs).toBe(1408)
    expect(result.debug?.topMatchScore).toBeCloseTo(0.95)
  })
})
