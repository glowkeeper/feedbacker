/**
 * Parse a rubric PDF with table structure into a normalized rubric object
 * 
 * Assumes format:
 * - Row 1: Headers (Criteria, Weighting, Level 1, Level 2, ...)
 * - Rows 2+: Criteria (name, weighting, descriptors with optional comments)
 * 
 * Comments may be embedded within cells, separated by newlines or special markers
 */

import { extractTextFromPDF } from './pdfExtract'

export interface ParsedRubric {
  criteria: Array<{
    name: string
    weighting: string
    levels: string[]
    comments?: string
  }>
  performanceLevels: string[]
  metadata: {
    parsedAt: string
    rawText: string
  }
}

/**
 * Parse a rubric PDF file into structured rubric data
 */
export async function parseRubricPDFFile(file: File): Promise<ParsedRubric> {
  const text = await extractTextFromPDF(file)
  return parseRubricText(text)
}

/**
 * Parse rubric text (extracted from PDF) into structured data
 */
export function parseRubricText(text: string): ParsedRubric {
  // Split into potential rows (separated by multiple newlines or specific patterns)
  const lines = text.split('\n').filter(line => line.trim().length > 0)

  // Try to identify table structure
  const rows = identifyTableRows(lines)

  if (rows.length < 2) {
    console.warn('Could not identify rubric table structure. Returning raw text.')
    return {
      criteria: [],
      performanceLevels: [],
      metadata: {
        parsedAt: new Date().toISOString(),
        rawText: text,
      },
    }
  }

  // First row should be headers
  const headerRow = rows[0]
  const performanceLevels = extractPerformanceLevels(headerRow)

  // Parse criteria from remaining rows
  const criteria = rows.slice(1).map(row => parseCriteriaRow(row, performanceLevels))

  return {
    criteria: criteria.filter(c => c !== null) as Array<{
      name: string
      weighting: string
      levels: string[]
      comments?: string
    }>,
    performanceLevels,
    metadata: {
      parsedAt: new Date().toISOString(),
      rawText: text,
    },
  }
}

/**
 * Identify table rows from extracted text
 * Uses heuristics to detect row boundaries
 */
function identifyTableRows(lines: string[]): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Check if this looks like a new row (contains percentage or starts with capital)
    if (isLikelyRowStart(trimmed) && currentRow.length > 0) {
      rows.push(currentRow)
      currentRow = [trimmed]
    } else if (trimmed.length > 0) {
      currentRow.push(trimmed)
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow)
  }

  return rows
}

/**
 * Heuristic: detect if a line is likely the start of a new row
 * Looks for percentage (weighting indicator) or numbered/bulleted lists
 */
function isLikelyRowStart(line: string): boolean {
  return /^\d+\.|^•|^-|^[A-Z][a-z]+.*\d+%/.test(line)
}

/**
 * Extract performance level names from header row
 * Usually 2nd column onwards (after "Criteria" and "Weighting")
 */
function extractPerformanceLevels(headerRow: string[]): string[] {
  if (headerRow.length <= 2) {
    return ['Level 1', 'Level 2', 'Level 3'] // Fallback
  }

  // Skip first two columns (Criteria, Weighting) and get the rest
  return headerRow.slice(2).map(level => {
    // Clean up common prefixes
    return level
      .replace(/^Level\s*\d+\s*[:-]?\s*/, '')
      .replace(/^[Dd]escriptor\s*\d+\s*[:-]?\s*/, '')
      .trim()
  })
}

/**
 * Parse a single criteria row
 */
function parseCriteriaRow(
  row: string[],
  performanceLevels: string[]
): {
  name: string
  weighting: string
  levels: string[]
  comments?: string
} | null {
  if (row.length < 2) {
    return null
  }

  const name = row[0]?.trim() || ''
  const weighting = row[1]?.trim() || ''

  // Extract performance level descriptors
  const levels: string[] = []
  let comments = ''

  for (let i = 2; i < row.length; i++) {
    const cell = row[i]?.trim() || ''

    // Try to separate descriptor from comments
    const { descriptor, comment } = separateDescriptorAndComment(cell)
    levels.push(descriptor)

    if (comment) {
      comments += `[${performanceLevels[i - 2] || `Level ${i - 1}`}] ${comment}\n`
    }
  }

  // Pad levels if we don't have enough
  while (levels.length < performanceLevels.length) {
    levels.push('')
  }

  return {
    name,
    weighting: weighting || 'Unweighted',
    levels,
    comments: comments.trim() || undefined,
  }
}

/**
 * Try to separate a cell's descriptor from embedded comments
 * 
 * Heuristics:
 * - Comments often follow a descriptor with "Comment:" or "Note:" prefix
 * - Comments might be in parentheses at the end
 * - Comments might be on a new line within the cell
 */
function separateDescriptorAndComment(cell: string): { descriptor: string; comment: string } {
  // Look for common comment separators
  const commentPatterns = [
    /^([^]*?)\s+Comment[s]?:\s*(.+)$/i,
    /^([^]*?)\s+Note:\s*(.+)$/i,
    /^([^]*?)\s+\(([^)]+)\)$/,
    /^([^]*?)\n+(.+)$/,
  ]

  for (const pattern of commentPatterns) {
    const match = cell.match(pattern)
    if (match) {
      return {
        descriptor: match[1].trim(),
        comment: match[2].trim(),
      }
    }
  }

  // No separator found - entire cell is descriptor
  return {
    descriptor: cell,
    comment: '',
  }
}

/**
 * Convert parsed rubric to 2D array format (compatible with Handsontable)
 */
export function parsedRubricTo2DArray(parsed: ParsedRubric): string[][] {
  const result: string[][] = []

  // Header row
  result.push(['', '', ...parsed.performanceLevels])

  // Criteria header
  result.push(['Criteria', 'Weighting', ...parsed.performanceLevels.map(l => '')])

  // Criteria rows
  for (const criterion of parsed.criteria) {
    result.push([criterion.name, criterion.weighting, ...criterion.levels])
  }

  return result
}

/**
 * Log parsing results for debugging
 */
export function logParsingResults(parsed: ParsedRubric): void {
  console.log('=== Rubric Parsing Results ===')
  console.log(`Performance Levels: ${parsed.performanceLevels.join(', ')}`)
  console.log(`Criteria Found: ${parsed.criteria.length}`)

  parsed.criteria.forEach((criterion, idx) => {
    console.log(`\n${idx + 1}. ${criterion.name} (${criterion.weighting})`)
    console.log(`   Levels: ${criterion.levels.join(' | ')}`)
    if (criterion.comments) {
      console.log(`   Comments: ${criterion.comments}`)
    }
  })

  console.log('\n=== Raw Extracted Text ===')
  console.log(parsed.metadata.rawText)
}
