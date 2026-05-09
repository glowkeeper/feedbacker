import { describe, it, expect } from 'vitest'
import { getRubricPrompt, getCommentedRubricPrompt } from '../utils/getPrompts'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

/** Raw 2D array as Handsontable would produce */
const raw2D = [
  ['Criteria', 'Weighting', 'Excellent', 'Good', 'Pass', 'Fail'],
  ['', '', '', '', '', ''],
  ['Analysis', '40%', 'Deep insight', 'Good insight', 'Basic', 'Little'],
  ['Writing', '30%', 'Fluent prose', 'Clear writing', 'Adequate', 'Poor'],
  ['Referencing', '30%', 'Perfect APA', 'Minor errors', 'Some errors', 'Missing'],
]

/** Normalised rubric structure */
const normalised = {
  criteria: [
    { name: 'Analysis', weighting: '40%', level_0_Excellent: 'Deep insight', level_1_Good: 'Good insight' },
    { name: 'Writing', weighting: '30%', level_0_Excellent: 'Fluent prose' },
  ],
  performanceLevels: ['Excellent', 'Good'],
  metadata: { createdAt: '2024-01-01T00:00:00.000Z' },
}

/** 2D rubric with only placeholder criterion names */
const placeholderRubric = [
  ['Criteria', 'Weighting', 'Excellent'],
  ['', '', ''],
  ['First Criteria', '50%', 'Outstanding'],
  ['Second Criteria', '50%', 'Good'],
]

// ─── getRubricPrompt ──────────────────────────────────────────────────────────

describe('getRubricPrompt', () => {
  describe('with a 2D array rubric', () => {
    it('includes criterion names and weightings', () => {
      const prompt = getRubricPrompt(raw2D)
      expect(prompt).toContain('Analysis')
      expect(prompt).toContain('40%')
      expect(prompt).toContain('Writing')
      expect(prompt).toContain('30%')
    })

    it('includes performance descriptors in the prompt', () => {
      const prompt = getRubricPrompt(raw2D)
      expect(prompt).toContain('Deep insight')
      expect(prompt).toContain('Fluent prose')
    })

    it('does NOT include the missing-descriptors note when descriptors are present', () => {
      const prompt = getRubricPrompt(raw2D)
      expect(prompt).not.toContain('missing performance descriptors')
    })

    it('includes a missing-descriptors note when all descriptor cells are blank', () => {
      const noDescriptors = [
        ['Criteria', 'Weighting', 'Excellent'],
        ['', '', ''],
        ['Analysis', '100%', ''],  // blank descriptor
      ]
      const prompt = getRubricPrompt(noDescriptors)
      expect(prompt).toContain('missing performance descriptors')
    })

    it('includes the placeholder-names note when criterion names look like placeholders', () => {
      const prompt = getRubricPrompt(placeholderRubric)
      expect(prompt).toContain('placeholders')
    })

    it('appends truncated submission text when provided', () => {
      const submission = 'A'.repeat(2000)
      const prompt = getRubricPrompt(raw2D, submission)
      // Prompt should include submission but only first 1000 chars
      expect(prompt).toContain('Assessment Text')
      const textPart = prompt.split('Assessment Text (first 1000 chars):')[1] || ''
      expect(textPart.length).toBeLessThanOrEqual(1100) // small buffer for newline
    })

    it('returns a prompt without assessment text when none is provided', () => {
      const prompt = getRubricPrompt(raw2D)
      expect(prompt).not.toContain('Assessment Text')
    })
  })

  describe('with a normalised rubric structure', () => {
    it('includes criterion names and weightings', () => {
      const prompt = getRubricPrompt(normalised)
      expect(prompt).toContain('Analysis')
      expect(prompt).toContain('40%')
    })

    it('includes level descriptors', () => {
      const prompt = getRubricPrompt(normalised)
      expect(prompt).toContain('Deep insight')
    })
  })
})

// ─── getCommentedRubricPrompt ─────────────────────────────────────────────────

describe('getCommentedRubricPrompt', () => {
  it('returns a generic prompt when a filename string is passed (fallback)', () => {
    const prompt = getCommentedRubricPrompt('rubric.pdf')
    expect(typeof prompt).toBe('string')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('includes rubric criteria when passed a normalised rubric', () => {
    const prompt = getCommentedRubricPrompt(normalised)
    expect(prompt).toContain('Analysis')
    expect(prompt).toContain('40%')
  })

  it('includes rubric comments when provided', () => {
    const prompt = getCommentedRubricPrompt(normalised, 'Strong argument throughout')
    expect(prompt).toContain('Strong argument throughout')
  })

  it('includes criterion-level comments from ParsedRubric', () => {
    const parsedRubric = {
      criteria: [
        { name: 'Analysis', weighting: '40%', comments: 'Excellent analysis shown' },
        { name: 'Writing', weighting: '30%' },
      ],
      performanceLevels: ['Excellent'],
    }
    const prompt = getCommentedRubricPrompt(parsedRubric)
    expect(prompt).toContain('Excellent analysis shown')
  })

  it('handles a rubric with no criterion-level comments gracefully', () => {
    const parsedRubric = {
      criteria: [
        { name: 'Analysis', weighting: '40%' },
      ],
      performanceLevels: ['Excellent'],
    }
    const prompt = getCommentedRubricPrompt(parsedRubric)
    expect(prompt).toContain('Analysis')
    // Should not throw or produce malformed output
    expect(typeof prompt).toBe('string')
  })

  it('falls back to 2D array handling when criteria array is absent', () => {
    const prompt = getCommentedRubricPrompt(raw2D, 'Good references')
    expect(prompt).toContain('Analysis')
    expect(prompt).toContain('Good references')
  })
})
