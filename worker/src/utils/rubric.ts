import { RubricStructure, RubricEntry } from '../types'

/**
 * Normalize a rubric from raw 2D array format to structured format
 */
export function normalizeRubric(rubric: string[][] | RubricStructure): RubricStructure {
  // If already normalized, return as-is
  if (!Array.isArray(rubric)) {
    return rubric
  }

  // Parse raw 2D array format (from frontend)
  const [headerRow, criteriaRow, ...dataRows] = rubric

  if (!headerRow || !criteriaRow) {
    throw new Error('Invalid rubric format: missing header rows')
  }

  // Extract performance levels from header (skip first two columns: criteria, weighting)
  const performanceLevels = headerRow.slice(2).filter((val) => val && val.trim())

  // Extract criteria with weighting
  const criteria: RubricEntry[] = dataRows
    .filter((row) => row[0] && row[0].trim()) // Skip empty rows
    .map((row) => {
      const entry: RubricEntry = {
        name: row[0] || '',
        weighting: row[1] || '0%',
      }
      // Add performance level comments
      performanceLevels.forEach((level, idx) => {
        const comment = row[2 + idx] || ''
        if (comment.trim()) {
          entry[`level_${idx}_${level.replace(/\s+/g, '_')}`] = comment
        }
      })
      return entry
    })

  return {
    criteria,
    performanceLevels,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  }
}

/**
 * Generate SHA-256 hash of normalized rubric for deduplication
 */
export async function hashRubric(rubric: RubricStructure | string): Promise<string> {
  const jsonString = typeof rubric === 'string' ? rubric : JSON.stringify(rubric)

  // Use Web Crypto API
  const encoder = new TextEncoder()
  const data = encoder.encode(jsonString)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  return hashHex
}

/**
 * Build embedding context from rubric + assessment text
 * This creates a rich text representation for semantic search
 */
export function buildEmbeddingContext(
  rubric: RubricStructure,
  assessmentText: string,
  assessmentLength: number = 500
): string {
  // Truncate assessment text if too long
  const truncated = assessmentText.substring(0, assessmentLength)

  // Build rubric context
  const rubricContext = rubric.criteria
    .map((criterion) => {
      const weights = criterion.weighting || 'unweighted'
      const levels = Object.entries(criterion)
        .filter(([key]) => key.startsWith('level_'))
        .map(([, value]) => value)
        .join('; ')

      return `Criterion: ${criterion.name} (Weight: ${weights}). Levels: ${levels}`
    })
    .join('\n')

  // Combine for embedding
  return `RUBRIC:\n${rubricContext}\n\nASSESSMENT:\n${truncated}`
}

/**
 * Generate a unique ID using crypto
 */
export function generateId(prefix: string = ''): string {
  const timestamp = Date.now()
  const random = crypto.getRandomValues(new Uint8Array(8))
  const randomHex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return prefix ? `${prefix}_${timestamp}_${randomHex}` : `${timestamp}_${randomHex}`
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have same length')
  }

  const dotProduct = vec1.reduce((sum, a, i) => sum + a * vec2[i], 0)
  const mag1 = Math.sqrt(vec1.reduce((sum, a) => sum + a * a, 0))
  const mag2 = Math.sqrt(vec2.reduce((sum, a) => sum + a * a, 0))

  if (mag1 === 0 || mag2 === 0) {
    return 0
  }

  return dotProduct / (mag1 * mag2)
}
