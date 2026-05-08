import { rubricPrompt, rubricWithCommentsPrompt } from "../config/prompts"

/**
 * Helper functions for building complete prompts with actual rubric data embedded.
 * 
 * These functions take the parsed rubric structure (either as a 2D array from Handsontable
 * or normalized structure) and build complete prompts suitable for OpenRouter/Worker.
 * 
 * The prompts include:
 * - Full rubric criteria and weighting
 * - Optional: assessment text (if provided)
 * - Clear instructions for evaluation
 * 
 * Prompts are built in two contexts:
 * 1. Submission-based assessment: rubric vs. student work
 * 2. Live assessment: feedback synthesis from completed rubric with comments
 */

/**
 * Build a rubric description from either raw 2D array or normalized structure
 */
function buildRubricDescription(rubric: any): string {
  if (Array.isArray(rubric)) {
    // Handle raw 2D array format (from Handsontable)
    // Row 0: headers, Row 1: criteria names and weighting labels
    // Rows 2+: actual criteria
    const criteria = rubric.slice(2).map((row: any[]) => {
      const name = row[0];
      const weighting = row[1];
      return `${name} (${weighting})`;
    }).join(', ');
    return criteria;
  } else if (rubric.criteria && Array.isArray(rubric.criteria)) {
    // Handle normalized rubric structure
    return rubric.criteria
      .map((c: any) => `${c.name} (${c.weighting})`)
      .join(', ');
  }
  return '';
}

function isPlaceholderCriterionName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return (
    normalized.startsWith('first criteria') ||
    normalized.startsWith('second criteria') ||
    normalized.startsWith('third criteria') ||
    normalized.startsWith('fourth criteria') ||
    normalized.startsWith('fifth criteria')
  )
}

function buildDetailedRubricBlock(rubric: any): { block: string; hasDescriptors: boolean; hasPlaceholderNames: boolean } {
  if (Array.isArray(rubric)) {
    const headerRow = rubric[0] || []
    const criteriaRows = rubric.slice(2)
    const levels = headerRow.slice(2)
    const details: string[] = []
    let hasDescriptors = false
    let hasPlaceholderNames = false

    criteriaRows.forEach((row: any[], rowIdx: number) => {
      const name = (row[0] || `Criterion ${rowIdx + 1}`).toString().trim()
      const weighting = (row[1] || 'Unweighted').toString().trim()

      if (isPlaceholderCriterionName(name)) {
        hasPlaceholderNames = true
      }

      const levelLines = levels
        .map((level: any, idx: number) => {
          const descriptor = (row[idx + 2] || '').toString().trim()
          if (descriptor) {
            hasDescriptors = true
          }
          return descriptor ? `- ${String(level).trim()}: ${descriptor}` : ''
        })
        .filter(Boolean)

      details.push(
        [`${name} (${weighting})`, ...levelLines].join('\n')
      )
    })

    return {
      block: details.join('\n\n'),
      hasDescriptors,
      hasPlaceholderNames,
    }
  }

  if (rubric?.criteria && Array.isArray(rubric.criteria)) {
    const details = rubric.criteria.map((c: any) => {
      const entries = Object.entries(c)
        .filter(([key]) => key.startsWith('level_'))
        .map(([key, value]) => `- ${key.replace(/^level_\d+_?/, '').replace(/_/g, ' ')}: ${String(value)}`)
      return [`${c.name} (${c.weighting || 'Unweighted'})`, ...entries].join('\n')
    })

    const hasDescriptors = details.some((d) => d.includes(':') && d.split('\n').length > 1)
    const hasPlaceholderNames = rubric.criteria.some((c: any) => isPlaceholderCriterionName(String(c?.name || '')))

    return {
      block: details.join('\n\n'),
      hasDescriptors,
      hasPlaceholderNames,
    }
  }

  return {
    block: '',
    hasDescriptors: false,
    hasPlaceholderNames: false,
  }
}

/**
 * Generate a complete prompt for assessing a student's submission against a rubric
 * @param rubric - The rubric data (2D array or normalized structure)
 * @param submissionText - Optional: the student's submission text. If not provided, Worker will add it
 * @returns A complete prompt with rubric details and optionally submission text
 */
export const getRubricPrompt = (rubric: any, submissionText?: string): string => {
  const rubricDescription = buildRubricDescription(rubric);
  const rubricDetails = buildDetailedRubricBlock(rubric)
  
  let prompt = rubricPrompt + `

Rubric Criteria: ${rubricDescription}`;

  if (rubricDetails.block) {
    prompt += `

Rubric Performance Descriptors:
${rubricDetails.block}`
  }

  if (!rubricDetails.hasDescriptors) {
    prompt += `

[System note: The inline rubric data appears to be missing performance descriptors. If a rubric PDF is attached, extract full descriptors from that file.]`
  }

  if (rubricDetails.hasPlaceholderNames) {
    prompt += `

[System note: Criterion names in inline data look like placeholders (e.g., First/Second Criteria). Prefer criteria and descriptors from attached rubric files when available.]`
  }
  
  if (submissionText) {
    prompt += `

Assessment Text (first 1000 chars):
${submissionText.substring(0, 1000)}`;
  }
  
  return prompt;
};

/**
 * Generate a complete prompt for generating feedback from a completed rubric with comments
 * @param rubric - The rubric data (2D array, normalized structure, ParsedRubric, or string as fallback)
 * @param rubricComments - Optional: the comments entered in the rubric
 * @returns A complete prompt with rubric details
 * 
 * Note: If rubric is a string (filename), it's treated as a fallback and a generic prompt is returned.
 * For best results, pass actual rubric data (2D array, normalized object, or ParsedRubric).
 */
export const getCommentedRubricPrompt = (rubric: any, rubricComments?: string): string => {
  // Handle fallback case where filename was passed instead of actual rubric data
  if (typeof rubric === 'string') {
    console.warn(`getCommentedRubricPrompt received a filename "${rubric}" instead of rubric data. 
      For best results, extract and pass the actual rubric structure.`);
    return rubricWithCommentsPrompt;
  }

  // Handle ParsedRubric structure (from live-assessment PDF parsing)
  if (rubric.criteria && Array.isArray(rubric.criteria) && rubric.performanceLevels) {
    const rubricDescription = rubric.criteria
      .map((c: any) => `${c.name} (${c.weighting})`)
      .join(', ');
    
    const commentsFromCriteria = rubric.criteria
      .filter((c: any) => c.comments)
      .map((c: any) => `${c.name}: ${c.comments}`)
      .join('\n\n');

    const prompt = rubricWithCommentsPrompt + `

Rubric:
${rubricDescription}

${commentsFromCriteria ? `Criterion-Specific Comments:\n${commentsFromCriteria}` : ''}
${rubricComments ? `Additional Comments:\n${rubricComments}` : ''}`;
    
    return prompt;
  }

  // Fallback to generic description builder
  const rubricDescription = buildRubricDescription(rubric);
  
  const prompt = rubricWithCommentsPrompt + `

Rubric:
${rubricDescription}

${rubricComments ? `Rubric Comments:\n${rubricComments}` : ''}`;
  
  return prompt;
};

