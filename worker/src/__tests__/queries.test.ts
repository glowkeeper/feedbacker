import { describe, it, expect, vi } from 'vitest'
import {
  storeRubric,
  getRubricByHash,
  storeFeedback,
  getFeedbackById,
  createOrUpdateSession,
  recordAnalytics,
} from '../db/queries'
import type { RubricStructure } from '../types'

// ─── D1 mock builder ──────────────────────────────────────────────────────────

/**
 * Minimal D1-like mock.  `stmtResult` controls what `.first()` / `.run()` return.
 */
function makeDb(opts: {
  firstResult?: Record<string, unknown> | null
  runResult?: { meta?: { changes?: number } }
} = {}) {
  const { firstResult = null, runResult = { meta: { changes: 0 } } } = opts

  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(firstResult),
    run: vi.fn().mockResolvedValue(runResult),
    all: vi.fn().mockResolvedValue({ results: [] }),
  }

  return {
    prepare: vi.fn().mockReturnValue(stmt),
    _stmt: stmt,
  }
}

const sampleRubric: RubricStructure = {
  criteria: [{ name: 'Analysis', weighting: '100%' }],
  performanceLevels: ['Pass'],
  metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
}

// ─── storeRubric ──────────────────────────────────────────────────────────────

describe('storeRubric', () => {
  it('returns an ID starting with "rubric_"', async () => {
    const db = makeDb()
    const id = await storeRubric(db, 'abc123', sampleRubric)
    expect(id).toMatch(/^rubric_/)
  })

  it('calls db.prepare and bind/run once', async () => {
    const db = makeDb()
    await storeRubric(db, 'abc123', sampleRubric)
    expect(db.prepare).toHaveBeenCalledOnce()
    expect(db._stmt.bind).toHaveBeenCalledOnce()
    expect(db._stmt.run).toHaveBeenCalledOnce()
  })

  it('serialises the rubric JSON when binding', async () => {
    const db = makeDb()
    await storeRubric(db, 'abc123', sampleRubric)
    const boundArgs: unknown[] = db._stmt.bind.mock.calls[0]
    expect(boundArgs).toContain(JSON.stringify(sampleRubric))
  })
})

// ─── getRubricByHash ──────────────────────────────────────────────────────────

describe('getRubricByHash', () => {
  it('returns null when no row is found', async () => {
    const db = makeDb({ firstResult: null })
    const result = await getRubricByHash(db, 'missing')
    expect(result).toBeNull()
  })

  it('returns parsed rubric when a row exists', async () => {
    const db = makeDb({
      firstResult: { id: 'rubric_123', rubric_json: JSON.stringify(sampleRubric) },
    })
    const result = await getRubricByHash(db, 'abc123')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('rubric_123')
    expect(result!.json.criteria[0].name).toBe('Analysis')
  })
})

// ─── storeFeedback ────────────────────────────────────────────────────────────

describe('storeFeedback', () => {
  it('returns an ID starting with "feedback_"', async () => {
    const db = makeDb()
    const id = await storeFeedback(db, 'rubric_1', 'assessment text', 'feedback text', 'emb_1')
    expect(id).toMatch(/^feedback_/)
  })

  it('passes all arguments to bind', async () => {
    const db = makeDb()
    await storeFeedback(db, 'rubric_1', 'assessment text', 'feedback text', 'emb_1', 0.95)
    const boundArgs: unknown[] = db._stmt.bind.mock.calls[0]
    expect(boundArgs).toContain('rubric_1')
    expect(boundArgs).toContain('assessment text')
    expect(boundArgs).toContain('feedback text')
    expect(boundArgs).toContain('emb_1')
    expect(boundArgs).toContain(0.95)
  })
})

// ─── getFeedbackById ──────────────────────────────────────────────────────────

describe('getFeedbackById', () => {
  it('returns null when no row is found', async () => {
    const db = makeDb({ firstResult: null })
    expect(await getFeedbackById(db, 'feedback_missing')).toBeNull()
  })

  it('maps row columns to StoredFeedback fields', async () => {
    const db = makeDb({
      firstResult: {
        id: 'feedback_1',
        rubric_id: 'rubric_1',
        assessment_text: 'essay content',
        feedback_text: 'great work',
        embedding_id: 'emb_1',
        similarity_score: 0.9,
        created_at: 1700000000,
      },
    })
    const result = await getFeedbackById(db, 'feedback_1')
    expect(result).toMatchObject({
      id: 'feedback_1',
      rubricId: 'rubric_1',
      assessmentText: 'essay content',
      feedbackText: 'great work',
      embeddingId: 'emb_1',
      similarityScore: 0.9,
      createdAt: 1700000000,
    })
  })
})

// ─── createOrUpdateSession ────────────────────────────────────────────────────

describe('createOrUpdateSession', () => {
  it('creates a new session when no existing session is found (UPDATE changes=0)', async () => {
    // First call (UPDATE) returns 0 changes; second call (INSERT SELECT) returns the row
    const stmts: ReturnType<typeof makeDb>['_stmt'][] = []

    const db = {
      prepare: vi.fn().mockImplementation(() => {
        const stmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(
            stmts.length === 1
              ? { id: 'sess_1', created_at: 1700000000, expires_at: 1700604800, last_activity: 1700000000 }
              : null
          ),
          run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }
        stmts.push(stmt)
        return stmt
      }),
    }

    const session = await createOrUpdateSession(db as any, 'sess_1')
    expect(session.id).toBe('sess_1')
  })

  it('returns existing session when UPDATE changes > 0', async () => {
    const stmts: any[] = []
    const db = {
      prepare: vi.fn().mockImplementation(() => {
        const callIdx = stmts.length
        const stmt = {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(
            callIdx === 1
              ? { id: 'sess_existing', created_at: 1700000000, expires_at: 1700604800, last_activity: 1700000001 }
              : null
          ),
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }), // UPDATE succeeds
          all: vi.fn().mockResolvedValue({ results: [] }),
        }
        stmts.push(stmt)
        return stmt
      }),
    }

    const session = await createOrUpdateSession(db as any, 'sess_existing')
    expect(session.id).toBe('sess_existing')
  })
})

// ─── recordAnalytics ──────────────────────────────────────────────────────────

describe('recordAnalytics', () => {
  it('inserts a row without throwing', async () => {
    const db = makeDb()
    await expect(
      recordAnalytics(db, 'feedback_1', 'sess_1', false, 5000)
    ).resolves.toBeUndefined()
    expect(db._stmt.run).toHaveBeenCalledOnce()
  })

  it('encodes is_cache_hit as 1 for true', async () => {
    const db = makeDb()
    await recordAnalytics(db, 'feedback_1', 'sess_1', true, 1000)
    const boundArgs: unknown[] = db._stmt.bind.mock.calls[0]
    expect(boundArgs).toContain(1)
  })

  it('encodes is_cache_hit as 0 for false', async () => {
    const db = makeDb()
    await recordAnalytics(db, 'feedback_1', 'sess_1', false, 1000)
    const boundArgs: unknown[] = db._stmt.bind.mock.calls[0]
    expect(boundArgs).toContain(0)
  })

  it('passes null for undefined sessionId', async () => {
    const db = makeDb()
    await recordAnalytics(db, 'feedback_1', undefined, false, 1000)
    const boundArgs: unknown[] = db._stmt.bind.mock.calls[0]
    expect(boundArgs).toContain(null)
  })
})
