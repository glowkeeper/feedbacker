import { Env, StoredFeedback, Session, AnalyticsRecord, RubricStructure } from '../types'

/**
 * Store a rubric and return its ID
 */
export async function storeRubric(
  db: any,
  rubricHash: string,
  rubricJson: RubricStructure
): Promise<string> {
  const id = `rubric_${Date.now()}`

  const stmt = db.prepare(
    `INSERT INTO rubrics (id, rubric_hash, rubric_json, created_at) 
     VALUES (?, ?, ?, unixepoch())`
  )

  await stmt.bind(id, rubricHash, JSON.stringify(rubricJson)).run()

  return id
}

/**
 * Retrieve a rubric by hash (for deduplication)
 */
export async function getRubricByHash(db: any, rubricHash: string): Promise<any> {
  const stmt = db.prepare('SELECT id, rubric_json FROM rubrics WHERE rubric_hash = ? LIMIT 1')
  const result = await stmt.bind(rubricHash).first()

  if (result) {
    return {
      id: result.id,
      json: JSON.parse(result.rubric_json as string),
    }
  }

  return null
}

/**
 * Store feedback example with embedding reference
 */
export async function storeFeedback(
  db: any,
  rubricId: string,
  assessmentText: string,
  feedbackText: string,
  embeddingId: string,
  similarityScore: number = 0
): Promise<string> {
  const id = `feedback_${Date.now()}_${Math.random().toString(36).substring(7)}`

  const stmt = db.prepare(
    `INSERT INTO feedback_examples (id, rubric_id, assessment_text, feedback_text, embedding_id, similarity_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`
  )

  await stmt.bind(id, rubricId, assessmentText, feedbackText, embeddingId, similarityScore).run()

  return id
}

/**
 * Retrieve feedback examples for a rubric
 */
export async function getFeedbackByRubric(db: any, rubricId: string): Promise<StoredFeedback[]> {
  const stmt = db.prepare(
    `SELECT id, rubric_id, assessment_text, feedback_text, embedding_id, similarity_score, created_at
     FROM feedback_examples 
     WHERE rubric_id = ?
     ORDER BY created_at DESC`
  )

  const result = await stmt.bind(rubricId).all()

  if (!result.results) {
    return []
  }

  return (result.results as any[]).map((row) => ({
    id: row.id,
    rubricId: row.rubric_id,
    assessmentText: row.assessment_text,
    feedbackText: row.feedback_text,
    embeddingId: row.embedding_id,
    similarityScore: row.similarity_score,
    createdAt: row.created_at,
  }))
}

/**
 * Retrieve a single feedback by ID
 */
export async function getFeedbackById(db: any, feedbackId: string): Promise<StoredFeedback | null> {
  const stmt = db.prepare(
    `SELECT id, rubric_id, assessment_text, feedback_text, embedding_id, similarity_score, created_at
     FROM feedback_examples 
     WHERE id = ?`
  )

  const result = await stmt.bind(feedbackId).first()

  if (!result) {
    return null
  }

  return {
    id: result.id as string,
    rubricId: result.rubric_id as string,
    assessmentText: result.assessment_text as string,
    feedbackText: result.feedback_text as string,
    embeddingId: result.embedding_id as string,
    similarityScore: result.similarity_score as number,
    createdAt: result.created_at as number,
  }
}

/**
 * Create or update a session
 */
export async function createOrUpdateSession(db: any, sessionId: string): Promise<Session> {
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days

  // Try to update existing
  const updateStmt = db.prepare(
    `UPDATE sessions SET last_activity = unixepoch(), expires_at = ? WHERE id = ?`
  )
  const updateResult = await updateStmt.bind(expiresAt, sessionId).run()

  if ((updateResult.meta?.changes || 0) > 0) {
    return getSession(db, sessionId)!
  }

  // Create new
  const createStmt = db.prepare(
    `INSERT INTO sessions (id, created_at, expires_at, last_activity) VALUES (?, unixepoch(), ?, unixepoch())`
  )
  await createStmt.bind(sessionId, expiresAt).run()

  return {
    id: sessionId,
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt,
    lastActivity: Math.floor(Date.now() / 1000),
  }
}

/**
 * Retrieve a session
 */
export async function getSession(db: any, sessionId: string): Promise<Session | null> {
  const stmt = db.prepare(
    `SELECT id, created_at, expires_at, last_activity FROM sessions WHERE id = ?`
  )
  const result = await stmt.bind(sessionId).first()

  if (!result) {
    return null
  }

  return {
    id: result.id as string,
    createdAt: result.created_at as number,
    expiresAt: result.expires_at as number,
    lastActivity: result.last_activity as number,
  }
}

/**
 * Record an analytics event
 */
export async function recordAnalytics(
  db: any,
  feedbackId: string,
  sessionId: string | undefined,
  isCacheHit: boolean,
  responseTimeMs: number
): Promise<void> {
  const id = `analytics_${Date.now()}_${Math.random().toString(36).substring(7)}`

  const stmt = db.prepare(
    `INSERT INTO analytics (id, session_id, feedback_id, is_cache_hit, response_time_ms, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())`
  )

  await stmt.bind(id, sessionId || null, feedbackId, isCacheHit ? 1 : 0, responseTimeMs).run()
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(db: any): Promise<number> {
  const stmt = db.prepare(`DELETE FROM sessions WHERE expires_at < unixepoch()`)
  const result = await stmt.run()

  return result.meta?.changes || 0
}
