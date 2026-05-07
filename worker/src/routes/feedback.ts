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
  DB: any
  VECTORIZE: any
}

export async function handleFeedbackRequest(
  request: Request,
  env: FeedbackRouteEnv
): Promise<FeedbackResponse> {
  const startTime = Date.now()
  const body = (await request.json()) as FeedbackRequest
  const { rubric, assessmentText, sessionId, prompt } = body

  // Validate input
  if (!rubric || !assessmentText) {
    throw new Error('Missing required fields: rubric, assessmentText')
  }

  try {
    // 1. Normalize the rubric
    const normalized = normalizeRubric(rubric)
    const rubricHash = await hashRubric(normalized)

    // 2. Get or create the rubric record
    let rubricId: string
    const existing = await getRubricByHash(env.DB, rubricHash)

    if (existing) {
      rubricId = existing.id
    } else {
      rubricId = await storeRubric(env.DB, rubricHash, normalized)
    }

    // 3. Create/update session
    const sessionToken = sessionId || generateId('sess')
    await createOrUpdateSession(env.DB, sessionToken)

    // 4. Build embedding context
    const embeddingText = buildEmbeddingContext(normalized, assessmentText)

    // 5. Generate embedding
    const embedding = await generateEmbedding(embeddingText, env)

    // 6. Query Vectorize for similar feedback
    const similarityThreshold = parseFloat(env.SIMILARITY_THRESHOLD || '0.8')
    const vectorizeResults = await env.VECTORIZE.query(embedding, {
      topK: 3,
      returnValues: false,
      returnMetadata: 'none',
    })

    // 7. Check if we have a high-similarity match
    let feedbackText: string
    let feedbackId: string
    let isCacheHit = false
    let bestSimilarity = 0

    if (vectorizeResults.length > 0 && vectorizeResults[0].score >= similarityThreshold) {
      // Cache hit: reuse feedback
      const topMatch = vectorizeResults[0]
      const storedFeedback = await env.DB.prepare(
        `SELECT feedback_text FROM feedback_examples WHERE embedding_id = ? LIMIT 1`
      )
        .bind(topMatch.id)
        .first()

      if (storedFeedback) {
        feedbackText = storedFeedback.feedback_text as string
        feedbackId = topMatch.id
        isCacheHit = true
        bestSimilarity = topMatch.score
      } else {
        // Fallback: embedding found but feedback missing, call OpenRouter
        feedbackText = await callFeedbackViaOpenRouter(normalized, assessmentText, prompt, env)
        feedbackId = await storeFeedbackWithEmbedding(
          env,
          rubricId,
          assessmentText,
          feedbackText,
          embedding
        )
      }
    } else {
      // Cache miss: call OpenRouter and store result
      feedbackText = await callFeedbackViaOpenRouter(normalized, assessmentText, prompt, env)
      feedbackId = await storeFeedbackWithEmbedding(
        env,
        rubricId,
        assessmentText,
        feedbackText,
        embedding
      )
    }

    // 8. Record analytics
    const responseTime = Date.now() - startTime
    await recordAnalytics(env.DB, feedbackId, sessionToken, isCacheHit, responseTime)

    return {
      feedback: feedbackText,
      cached: isCacheHit,
      feedbackId,
      similarityScore: bestSimilarity,
      timestamp: Date.now(),
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
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

  return await callOpenRouter(
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
}

/**
 * Store feedback with embedding in both D1 and Vectorize
 */
async function storeFeedbackWithEmbedding(
  env: FeedbackRouteEnv,
  rubricId: string,
  assessmentText: string,
  feedbackText: string,
  embedding: number[]
): Promise<string> {
  const embeddingId = generateId('emb')

  // Store in Vectorize
  await env.VECTORIZE.insert([
    {
      id: embeddingId,
      values: embedding,
    },
  ])

  // Store in D1
  const feedbackId = await storeFeedback(env.DB, rubricId, assessmentText, feedbackText, embeddingId)

  return feedbackId
}
