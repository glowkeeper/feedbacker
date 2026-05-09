import { describe, it, expect } from 'vitest'
import {
  normalizeRubric,
  hashRubric,
  buildEmbeddingContext,
  cosineSimilarity,
  generateId,
} from '../utils/rubric'
import type { RubricStructure } from '../types'

// ─── normalizeRubric ─────────────────────────────────────────────────────────

describe('normalizeRubric', () => {
  const raw2D: string[][] = [
    ['Criteria', 'Weighting', 'Excellent', 'Good', 'Pass', 'Fail'],
    ['', '', '', '', '', ''],
    ['Analysis', '40%', 'Deep insight', 'Good insight', 'Basic insight', 'Little insight'],
    ['Writing', '30%', 'Fluent prose', 'Clear writing', 'Adequate', 'Poor'],
    ['Referencing', '30%', 'Perfect APA', 'Minor errors', 'Some errors', 'Missing'],
  ]

  it('parses a raw 2D array into a RubricStructure', () => {
    const result = normalizeRubric(raw2D)
    expect(result.criteria).toHaveLength(3)
    expect(result.performanceLevels).toEqual(['Excellent', 'Good', 'Pass', 'Fail'])
    expect(result.criteria[0].name).toBe('Analysis')
    expect(result.criteria[0].weighting).toBe('40%')
  })

  it('passes through an already-normalised RubricStructure unchanged', () => {
    const already: RubricStructure = {
      criteria: [{ name: 'Analysis', weighting: '100%' }],
      performanceLevels: ['Pass'],
      metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
    }
    expect(normalizeRubric(already)).toBe(already)
  })

  it('throws when header rows are missing', () => {
    expect(() => normalizeRubric([])).toThrow('Invalid rubric format')
  })

  it('skips rows with empty criterion names', () => {
    const withEmpty: string[][] = [
      ['Criteria', 'Weighting', 'Excellent'],
      ['', '', ''],
      ['Analysis', '50%', 'Great'],
      ['', '', ''],           // empty row – should be skipped
      ['Writing', '50%', 'Fluent'],
    ]
    const result = normalizeRubric(withEmpty)
    expect(result.criteria).toHaveLength(2)
    expect(result.criteria.map((c) => c.name)).toEqual(['Analysis', 'Writing'])
  })

  it('includes performance-level descriptors on each criterion', () => {
    const result = normalizeRubric(raw2D)
    const analysis = result.criteria[0]
    const keys = Object.keys(analysis).filter((k) => k.startsWith('level_'))
    expect(keys.length).toBeGreaterThan(0)
    expect(Object.values(analysis)).toContain('Deep insight')
  })
})

// ─── hashRubric ──────────────────────────────────────────────────────────────

describe('hashRubric', () => {
  const rubric: RubricStructure = {
    criteria: [{ name: 'Analysis', weighting: '100%' }],
    performanceLevels: ['Pass'],
    metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
  }

  it('returns a 64-character hex string', async () => {
    const hash = await hashRubric(rubric)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same hash for equal content', async () => {
    const a = await hashRubric(rubric)
    const b = await hashRubric({ ...rubric })
    expect(a).toBe(b)
  })

  it('produces different hashes for different content', async () => {
    const a = await hashRubric(rubric)
    const b = await hashRubric({ ...rubric, criteria: [{ name: 'Writing', weighting: '100%' }] })
    expect(a).not.toBe(b)
  })

  it('accepts a plain string and hashes it', async () => {
    const hash = await hashRubric('hello world')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ─── buildEmbeddingContext ────────────────────────────────────────────────────

describe('buildEmbeddingContext', () => {
  const rubric: RubricStructure = {
    criteria: [
      { name: 'Analysis', weighting: '60%', level_0_Excellent: 'Thorough' },
      { name: 'Writing', weighting: '40%', level_0_Excellent: 'Fluent' },
    ],
    performanceLevels: ['Excellent'],
    metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
  }

  it('includes RUBRIC and ASSESSMENT headers', () => {
    const ctx = buildEmbeddingContext(rubric, 'Some student text')
    expect(ctx).toContain('RUBRIC:')
    expect(ctx).toContain('ASSESSMENT:')
  })

  it('includes each criterion name and weighting', () => {
    const ctx = buildEmbeddingContext(rubric, 'text')
    expect(ctx).toContain('Analysis')
    expect(ctx).toContain('60%')
    expect(ctx).toContain('Writing')
  })

  it('truncates assessment text to assessmentLength', () => {
    const long = 'A'.repeat(2000)
    const ctx = buildEmbeddingContext(rubric, long, 500)
    const assessmentPart = ctx.split('ASSESSMENT:\n')[1]
    expect(assessmentPart.length).toBeLessThanOrEqual(500)
  })

  it('includes level descriptors in the rubric block', () => {
    const ctx = buildEmbeddingContext(rubric, 'text')
    expect(ctx).toContain('Thorough')
  })
})

// ─── cosineSimilarity ────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical non-zero vectors', () => {
    const v = [1, 2, 3]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 10)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10)
  })

  it('returns 0 when either vector is the zero vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10)
  })

  it('throws when vector lengths differ', () => {
    expect(() => cosineSimilarity([1, 2], [1])).toThrow('same length')
  })
})

// ─── generateId ──────────────────────────────────────────────────────────────

describe('generateId', () => {
  it('returns a non-empty string', () => {
    expect(generateId()).toBeTruthy()
  })

  it('starts with the given prefix when supplied', () => {
    expect(generateId('rubric')).toMatch(/^rubric_/)
    expect(generateId('feedback')).toMatch(/^feedback_/)
  })

  it('generates unique IDs across many calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('test')))
    // With 100 IDs all should be unique (extremely unlikely to collide)
    expect(ids.size).toBeGreaterThan(95)
  })
})
