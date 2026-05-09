import { FeedbackRequest, FeedbackResponse, Env } from '../types'
import { normalizeRubric, hashRubric, buildEmbeddingContext, generateId } from '../utils/rubric'
import { generateEmbedding, callOpenRouter } from '../utils/openrouter'
import {
  storeRubric,
  getRubricByHash,
  storeFeedback,
  getFeedbackByRubric,
  createOrUpdateSession,
  recordAnalytics,
} from '../db/queries'

interface FeedbackRouteEnv extends Env {
  DB?: any
  feedbacker?: any
  VECTORIZE: any
}

function getDb(env: FeedbackRouteEnv): any {
  const db = env.DB ?? env.feedbacker
  if (!db) {
    throw new Error('D1 binding is missing. Expected binding `DB` in wrangler.toml.')
  }
  return db
}

function isVectorizeLocalBindingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Binding VECTORIZE needs to be run remotely')
}

export async function handleFeedbackRequest(
  request: Request,
  env: FeedbackRouteEnv
): Promise<FeedbackResponse> {
  const startTime = Date.now()
  const db = getDb(env)
  const body = (await request.json()) as FeedbackRequest
  const { rubric, assessmentText, sessionId, prompt } = body

  // Validate input
  if (!rubric || !assessmentText) {
    throw new Error('Missing required fields: rubric, assessmentText')
  }

  // DEBUG: Log incoming assessment text length and content preview
  const assessmentPreview = assessmentText.substring(0, 200).replace(/\n/g, ' ')
  const promptPreview = prompt?.substring(0, 300).replace(/\n/g, ' ') || '(none)'
  console.log(`[DEBUG] ════════════════════════════════════════════════════════════════`)
  console.log(`[DEBUG] Feedback request RECEIVED at ${new Date().toISOString()}`)
  console.log(`[DEBUG] Assessment text length: ${assessmentText.length} chars`)
  console.log(`[DEBUG] Assessment text preview: ${assessmentPreview}${assessmentText.length > 200 ? '...' : ''}`)
  console.log(`[DEBUG] Rubric structure: ${Array.isArray(rubric) ? rubric.length : 'unknown'} rows`)
  console.log(`[DEBUG] Prompt length: ${prompt?.length || 0} chars`)
  console.log(`[DEBUG] Prompt preview: ${promptPreview}${(prompt?.length || 0) > 300 ? '...' : ''}`)
  console.log(`[DEBUG] Session ID: ${sessionId || '(none)'}`)
  
  // Check if assessment text looks like it has actual content
  const hasReferencesList = /references|bibliography|works cited/i.test(assessmentText)
  const hasMethodsSection = /methods|methodology|procedure/i.test(assessmentText)
  const hasResultsSection = /results|findings|analysis/i.test(assessmentText)
  const hasDiscussionSection = /discussion|conclusion|interpretation/i.test(assessmentText)
  console.log(`[DEBUG] Content check: references=${hasReferencesList}, methods=${hasMethodsSection}, results=${hasResultsSection}, discussion=${hasDiscussionSection}`)

  try {
    // 1. Normalize the rubric
    let normalizationStart = Date.now()
    const normalized = normalizeRubric(rubric)
    const rubricHash = await hashRubric(normalized)
    console.log(`[DEBUG] ✓ Rubric normalization complete (${Date.now() - normalizationStart}ms)`)
    console.log(`[DEBUG]   Normalized rubric has ${normalized.criteria?.length || 0} criteria`)

    // 2. Get or create the rubric record
    let rubricId: string
    const existing = await getRubricByHash(db, rubricHash)

    if (existing) {
      rubricId = existing.id
      console.log(`[DEBUG] ✓ Rubric found in database (id: ${rubricId})`)
    } else {
      rubricId = await storeRubric(db, rubricHash, normalized)
      console.log(`[DEBUG] ✓ Rubric stored in database (id: ${rubricId})`)
    }

    // 3. Create/update session
    const sessionToken = sessionId || generateId('sess')
    await createOrUpdateSession(db, sessionToken)
    console.log(`[DEBUG] ✓ Session created/updated (token: ${sessionToken})`)

    // 4. Build embedding context
    const embeddingContextStart = Date.now()
    const embeddingText = buildEmbeddingContext(normalized, assessmentText)
    console.log(`[DEBUG] ✓ Embedding context built (${embeddingText.length} chars for embedding, ${Date.now() - embeddingContextStart}ms)`)

    // 5. Generate embedding
    const embeddingStart = Date.now()
    const embedding = await generateEmbedding(embeddingText, env)
    console.log(`[DEBUG] ✓ Embedding generated (${embedding.length} dimensions, ${Date.now() - embeddingStart}ms)`)

    // 6. Query Vectorize for similar feedback
    const vectorizeStart = Date.now()
    const similarityThreshold = parseFloat(env.SIMILARITY_THRESHOLD || '0.8')
    let vectorizeResults: Array<{ id: string; score: number }> = []
    let vectorizeAvailable = true

    try {
      const vectorizeRaw = await env.VECTORIZE.query(embedding, {
        topK: 3,
        returnValues: false,
        returnMetadata: 'none',
      })
      vectorizeResults = Array.isArray(vectorizeRaw)
        ? vectorizeRaw
        : Array.isArray(vectorizeRaw?.matches)
        ? vectorizeRaw.matches
        : []
      console.log(`[DEBUG] ✓ Vectorize query complete (${Date.now() - vectorizeStart}ms, found ${vectorizeResults.length} results)`)
      if (vectorizeResults.length > 0) {
        console.log(`[DEBUG]   Top match score: ${vectorizeResults[0].score.toFixed(3)} (threshold: ${similarityThreshold})`)
      }
    } catch (error) {
      if (isVectorizeLocalBindingError(error)) {
        vectorizeAvailable = false
        console.log(`[DEBUG] ⚠ Vectorize unavailable (local dev mode), will call OpenRouter for new feedback`)
      } else {
        throw error
      }
    }

    // 7. Check if we have a high-similarity match
    let feedbackText: string
    let feedbackId: string
    let isCacheHit = false
    let bestSimilarity = 0

    if (vectorizeResults.length > 0 && vectorizeResults[0].score >= similarityThreshold) {
      // Cache hit: reuse feedback
      const topMatch = vectorizeResults[0]
      const storedFeedback = await db.prepare(
        `SELECT id, feedback_text FROM feedback_examples WHERE embedding_id = ? ORDER BY created_at DESC LIMIT 1`
      )
        .bind(topMatch.id)
        .first()

      if (storedFeedback) {
        feedbackText = storedFeedback.feedback_text as string
        feedbackId = storedFeedback.id as string
        isCacheHit = true
        bestSimilarity = topMatch.score
        console.log(`[DEBUG] ✓ CACHE HIT - reusing stored feedback (similarity: ${bestSimilarity.toFixed(3)})`)
      } else {
        // Fallback: embedding found but feedback missing, call OpenRouter
        const openrouterStart = Date.now()
        console.log(`[DEBUG] ⚠ Cache miss - embedding exists but feedback missing, calling OpenRouter...`)
        feedbackText = await callFeedbackViaOpenRouter(normalized, assessmentText, prompt, env)
        console.log(`[DEBUG] ✓ OpenRouter call complete (${Date.now() - openrouterStart}ms)`)
        console.log(`[DEBUG]   Feedback length: ${feedbackText.length} chars`)
        feedbackId = await storeFeedbackWithEmbedding(
          env,
          rubricId,
          assessmentText,
          feedbackText,
          embedding,
          vectorizeAvailable
        )
      }
    } else {
      // Cache miss: call OpenRouter and store result
      const openrouterStart = Date.now()
      if (vectorizeResults.length > 0) {
        console.log(`[DEBUG] ⚠ Cache miss - top match score ${vectorizeResults[0].score.toFixed(3)} below threshold ${similarityThreshold}`)
      } else {
        console.log(`[DEBUG] ⚠ Cache miss - no prior feedback found, calling OpenRouter...`)
      }
      feedbackText = await callFeedbackViaOpenRouter(normalized, assessmentText, prompt, env)
      const openrouterElapsed = Date.now() - openrouterStart
      console.log(`[DEBUG] ✓ OpenRouter call complete (${openrouterElapsed}ms)`)
      console.log(`[DEBUG]   Feedback length: ${feedbackText.length} chars`)
      feedbackId = await storeFeedbackWithEmbedding(
        env,
        rubricId,
        assessmentText,
        feedbackText,
        embedding,
        vectorizeAvailable
      )
    }

    // 8. Record analytics
    const responseTime = Date.now() - startTime
    await recordAnalytics(db, feedbackId, sessionToken, isCacheHit, responseTime)
    console.log(`[DEBUG] ✓ Analytics recorded`)
    console.log(`[DEBUG] ════════════════════════════════════════════════════════════════`)
    console.log(`[DEBUG] Feedback request COMPLETED in ${responseTime}ms (cache: ${isCacheHit ? 'HIT' : 'MISS'})`)
    console.log(`[DEBUG] ════════════════════════════════════════════════════════════════`)

    return {
      feedback: feedbackText,
      cached: isCacheHit,
      feedbackId,
      similarityScore: bestSimilarity,
      timestamp: Date.now(),
      debug: {
        cacheDecision: isCacheHit ? 'HIT' : 'MISS',
        similarityThreshold,
        topMatchScore: vectorizeResults[0]?.score,
        topMatchEmbeddingId: vectorizeResults[0]?.id,
        vectorizeAvailable,
        vectorizeResultCount: vectorizeResults.length,
        promptLength: prompt?.length || 0,
        assessmentLength: assessmentText.length,
        responseTimeMs: responseTime,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.log(`[DEBUG] ✗ ERROR: ${errorMessage}`)
    console.log(`[DEBUG] ════════════════════════════════════════════════════════════════`)
    throw new Error(`Feedback generation failed: ${errorMessage}`)
  }
}

/**
 * Call OpenRouter to generate feedback
 */
async function callFeedbackViaOpenRouter(
  rubric: any,
  assessmentText: string,
  customPrompt: string | undefined,
  env: FeedbackRouteEnv
): Promise<string> {
  const rubricDescription = rubric.criteria
    .map((c: any) => `${c.name} (${c.weighting})`)
    .join(', ')

  const defaultPrompt = `You are assessing a student's submission using the assessment rubric provided.

Rubric Criteria: ${rubricDescription}

Assessment Text (first 1000 chars):
${assessmentText.substring(0, 1000)}

Provide structured, criterion-aligned feedback based on this rubric. Be specific and constructive.`

  const messageContent = customPrompt || defaultPrompt

  // DEBUG: Log what we're sending to OpenRouter
  if (!customPrompt) {
    console.log(`[DEBUG] → OpenRouter: Using DEFAULT prompt (${defaultPrompt.length} chars)`)
  } else {
    console.log(`[DEBUG] → OpenRouter: Using CUSTOM prompt (${customPrompt.length} chars)`)
  }
  console.log(`[DEBUG] → OpenRouter: Assessment text (${assessmentText.length} chars, preview: ${assessmentText.substring(0, 80).replace(/\n/g, ' ')}...)`)
  console.log(`[DEBUG] → OpenRouter: Calling model 'openrouter/auto'...`)

  const openrouterStart = Date.now()
  const result = await callOpenRouter(
    [
      {
        role: 'system',
        content:
          'You are an experienced educator providing detailed, rubric-based feedback on student work.',
      },
      {
        role: 'user',
        content: messageContent,
      },
    ],
    'openrouter/auto',
    env
  )
  
  console.log(`[DEBUG] ← OpenRouter: Response received (${Date.now() - openrouterStart}ms, ${result.length} chars)`)
  return result
}

/**
 * Store feedback with embedding in both D1 and Vectorize
 */
async function storeFeedbackWithEmbedding(
  env: FeedbackRouteEnv,
  rubricId: string,
  assessmentText: string,
  feedbackText: string,
  embedding: number[],
  vectorizeAvailable: boolean
): Promise<string> {
  const embeddingId = generateId('emb')

  // Store in Vectorize when available; local dev may not support it.
  if (vectorizeAvailable) {
    try {
      await env.VECTORIZE.insert([
        {
          id: embeddingId,
          values: embedding,
        },
      ])
    } catch (error) {
      if (!isVectorizeLocalBindingError(error)) {
        throw error
      }
    }
  }

  // Store in D1
  const db = getDb(env)
  const feedbackId = await storeFeedback(db, rubricId, assessmentText, feedbackText, embeddingId)

  return feedbackId
}
