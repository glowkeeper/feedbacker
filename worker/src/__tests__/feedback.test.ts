import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleFeedbackRequest } from '../routes/feedback'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal D1-like mock with configurable per-call behaviour */
function makeDb(opts: {
  rubricFirst?: Record<string, unknown> | null
  feedbackFirst?: Record<string, unknown> | null
  updateChanges?: number
} = {}) {
  const calls: string[] = []

  return {
    _calls: calls,
    prepare: vi.fn().mockImplementation((sql: string) => {
      calls.push(sql)
      const isRubricLookup = sql.includes('rubric_hash')
      const isFeedbackLookup = sql.includes('feedback_examples WHERE embedding_id')
      const isSessionUpdate = sql.includes('UPDATE sessions')
      const isSessionSelect = sql.includes('SELECT id, created_at')
      const firstResult = isRubricLookup
        ? (opts.rubricFirst ?? null)
        : isFeedbackLookup
        ? (opts.feedbackFirst ?? null)
        : isSessionSelect
        ? { id: 'sess_x', created_at: 0, expires_at: 9999999999, last_activity: 0 }
        : null

      return {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(firstResult),
        run: vi.fn().mockResolvedValue({
          meta: { changes: isSessionUpdate ? (opts.updateChanges ?? 0) : 0 },
        }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }
    }),
  }
}

/** Build a fake Request with a JSON body */
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Minimal rubric in 2D array format */
const testRubric = [
  ['Criteria', 'Weighting', 'Excellent', 'Good'],
  ['', '', '', ''],
  ['Analysis', '60%', 'Thorough', 'Adequate'],
  ['Writing', '40%', 'Fluent', 'Clear'],
]

const testAssessment = 'This essay argues that the French Revolution was primarily economic in nature...'

/** Fake 1536-dim embedding */
const fakeEmbedding = Array.from({ length: 1536 }, () => Math.random())

/** Make a valid FeedbackResponse from the OpenRouter mock */
function makeOpenRouterOk(text = 'Excellent work! Criterion Analysis: 85%') {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({}),
    json: async () => ({
      id: 'or_1',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    }),
  } as unknown as Response
}

/** Make a fake embedding response */
function makeEmbeddingOk() {
  return {
    ok: true,
    status: 200,
    text: async () => '{}',
    json: async () => ({ data: [{ embedding: fakeEmbedding }] }),
  } as unknown as Response
}

// ─── Validation ───────────────────────────────────────────────────────────────

describe('handleFeedbackRequest – input validation', () => {
  it('throws when rubric is missing', async () => {
    const db = makeDb()
    const env = { DB: db, VECTORIZE: null, SIMILARITY_THRESHOLD: '0.8' } as any
    const req = makeRequest({ assessmentText: testAssessment })
    await expect(handleFeedbackRequest(req, env)).rejects.toThrow('Missing required fields')
  })

  it('throws when assessmentText is missing', async () => {
    const db = makeDb()
    const env = { DB: db, VECTORIZE: null, SIMILARITY_THRESHOLD: '0.8' } as any
    const req = makeRequest({ rubric: testRubric })
    await expect(handleFeedbackRequest(req, env)).rejects.toThrow('Missing required fields')
  })
})

// ─── Cache miss (Vectorize unavailable – local dev) ───────────────────────────

describe('handleFeedbackRequest – cache miss (Vectorize unavailable)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns feedback from OpenRouter when Vectorize binding is absent', async () => {
    const db = makeDb()

    // Vectorize throws a "needs to be run remotely" error
    const fakeVectorize = {
      query: vi.fn().mockRejectedValue(new Error('Binding VECTORIZE needs to be run remotely')),
    }

    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    // fetch: first call = embeddings, second call = OpenRouter chat
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk())
    )

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.feedback).toContain('Excellent work!')
    expect(response.cached).toBe(false)
    expect(response.debug?.cacheDecision).toBe('MISS')
    expect(response.debug?.vectorizeAvailable).toBe(false)
  })
})

// ─── Cache miss (Vectorize available but score below threshold) ───────────────

describe('handleFeedbackRequest – cache miss (low similarity score)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('calls OpenRouter and returns new feedback when best score is below threshold', async () => {
    const db = makeDb()

    const fakeVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: 'emb_old', score: 0.65 }], // below 0.8 threshold
      }),
      insert: vi.fn().mockResolvedValue({}),
    }

    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk('Good effort. Some areas to improve.'))
    )

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.feedback).toContain('Good effort')
    expect(response.cached).toBe(false)
    expect(response.debug?.cacheDecision).toBe('MISS')
    expect(response.debug?.topMatchScore).toBeCloseTo(0.65)
  })

  it('also handles bare array Vectorize response (legacy shape)', async () => {
    const db = makeDb()

    const fakeVectorize = {
      query: vi.fn().mockResolvedValue([{ id: 'emb_old', score: 0.5 }]), // bare array
      insert: vi.fn().mockResolvedValue({}),
    }

    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk())
    )

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.cached).toBe(false)
  })

  it('returns 0 matches when Vectorize returns neither array nor matches object', async () => {
    const db = makeDb()

    const fakeVectorize = {
      query: vi.fn().mockResolvedValue(null), // unexpected shape
      insert: vi.fn().mockResolvedValue({}),
    }

    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk())
    )

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.debug?.vectorizeResultCount).toBe(0)
    expect(response.cached).toBe(false)
  })
})

// ─── Cache hit ────────────────────────────────────────────────────────────────

describe('handleFeedbackRequest – cache hit', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('returns stored feedback without calling OpenRouter', async () => {
    const db = makeDb({
      feedbackFirst: {
        id: 'feedback_stored_123',
        feedback_text: 'Previously generated feedback',
      },
    })

    const fakeVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: 'emb_cached', score: 0.95 }], // above 0.8 threshold
      }),
    }

    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    // Only the embedding call should be made; no OpenRouter chat call
    const mockFetch = vi.fn().mockResolvedValue(makeEmbeddingOk())
    vi.stubGlobal('fetch', mockFetch)

    const req = makeRequest({
      rubric: testRubric,
      assessmentText: testAssessment,
      sessionId: 'sess_test',
    })
    const response = await handleFeedbackRequest(req, env)

    expect(response.feedback).toBe('Previously generated feedback')
    expect(response.cached).toBe(true)
    expect(response.feedbackId).toBe('feedback_stored_123')
    expect(response.debug?.cacheDecision).toBe('HIT')
    // Confirm OpenRouter chat was NOT called (only 1 fetch = embeddings)
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('falls back to OpenRouter when embedding_id exists but no feedback row found', async () => {
    const db = makeDb({
      feedbackFirst: null, // embedding found in Vectorize but no feedback row
    })

    const fakeVectorize = {
      query: vi.fn().mockResolvedValue({
        matches: [{ id: 'emb_orphaned', score: 0.93 }],
      }),
      insert: vi.fn().mockResolvedValue({}),
    }

    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeEmbeddingOk())
      .mockResolvedValueOnce(makeOpenRouterOk('Fallback feedback'))
    vi.stubGlobal('fetch', mockFetch)

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.feedback).toBe('Fallback feedback')
    expect(response.cached).toBe(false)
    // Two fetch calls: embeddings + OpenRouter chat
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

// ─── Debug payload ────────────────────────────────────────────────────────────

describe('handleFeedbackRequest – debug payload', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('includes all expected debug fields in the response', async () => {
    const db = makeDb()
    const fakeVectorize = {
      query: vi.fn().mockRejectedValue(new Error('Binding VECTORIZE needs to be run remotely')),
    }
    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.85',
    } as any

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk())
    )

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.debug).toBeDefined()
    expect(response.debug?.cacheDecision).toMatch(/^(HIT|MISS)$/)
    expect(response.debug?.similarityThreshold).toBe(0.85)
    expect(typeof response.debug?.vectorizeAvailable).toBe('boolean')
    expect(typeof response.debug?.vectorizeResultCount).toBe('number')
    expect(typeof response.debug?.promptLength).toBe('number')
    expect(typeof response.debug?.assessmentLength).toBe('number')
    expect(typeof response.debug?.responseTimeMs).toBe('number')
    expect(response.debug?.responseTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('reports assessmentLength matching the submitted text', async () => {
    const db = makeDb()
    const fakeVectorize = {
      query: vi.fn().mockRejectedValue(new Error('Binding VECTORIZE needs to be run remotely')),
    }
    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk())
    )

    const longAssessment = 'A'.repeat(5000)
    const req = makeRequest({ rubric: testRubric, assessmentText: longAssessment })
    const response = await handleFeedbackRequest(req, env)

    expect(response.debug?.assessmentLength).toBe(5000)
  })
})

// ─── Existing rubric deduplication ───────────────────────────────────────────

describe('handleFeedbackRequest – rubric deduplication', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('reuses an existing rubricId when the same hash is found', async () => {
    const db = makeDb({
      rubricFirst: { id: 'rubric_existing', rubric_json: JSON.stringify({
        criteria: [{ name: 'Analysis', weighting: '60%' }],
        performanceLevels: ['Excellent'],
        metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
      }) },
    })

    const fakeVectorize = {
      query: vi.fn().mockRejectedValue(new Error('Binding VECTORIZE needs to be run remotely')),
    }
    const env = {
      DB: db,
      VECTORIZE: fakeVectorize,
      OPENROUTER_KEY: 'test-key',
      SIMILARITY_THRESHOLD: '0.8',
    } as any

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(makeEmbeddingOk())
        .mockResolvedValueOnce(makeOpenRouterOk())
    )

    const req = makeRequest({ rubric: testRubric, assessmentText: testAssessment })
    await handleFeedbackRequest(req, env)

    // storeRubric (INSERT) should NOT have been called — only getRubricByHash (SELECT)
    const insertCalls = db._calls.filter((sql: string) => sql.includes('INSERT INTO rubrics'))
    expect(insertCalls).toHaveLength(0)
  })
})
