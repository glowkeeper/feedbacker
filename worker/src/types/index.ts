// Type definitions for Feedbacker Worker

export interface RubricEntry {
  name: string
  weighting?: string
  [key: string]: string | undefined
}

export interface RubricStructure {
  criteria: RubricEntry[]
  performanceLevels: string[]
  metadata?: {
    createdAt?: string
    name?: string
  }
}

export interface FeedbackRequest {
  rubric: string[][] | RubricStructure // Can be raw array or normalized structure
  assessmentText: string
  sessionId?: string
  prompt?: string // Optional custom prompt template
}

export interface FeedbackResponse {
  feedback: string
  cached: boolean
  feedbackId: string
  similarityScore?: number
  timestamp: number
  debug?: {
    cacheDecision: 'HIT' | 'MISS'
    similarityThreshold: number
    topMatchScore?: number
    topMatchEmbeddingId?: string
    vectorizeAvailable: boolean
    vectorizeResultCount: number
    promptLength: number
    assessmentLength: number
    responseTimeMs: number
  }
}

export interface EmbeddingVector {
  values: number[]
  id: string
}

export interface VectorizeMatch {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, unknown>
}

export interface StoredFeedback {
  id: string
  rubricId: string
  assessmentText: string
  feedbackText: string
  embeddingId: string
  similarityScore: number
  createdAt: number
}

export interface Session {
  id: string
  createdAt: number
  expiresAt: number
  lastActivity: number
}

export interface AnalyticsRecord {
  id: string
  sessionId?: string
  feedbackId: string
  isCacheHit: boolean
  responseTimeMs: number
  createdAt: number
}

// Cloudflare Worker Env
export interface Env {
  DB: D1Database
  feedbacker?: D1Database
  VECTORIZE: Vectorize
  OPENROUTER_KEY: string
  OPENROUTER_URL: string
  EMBEDDING_MODEL?: string
  SIMILARITY_THRESHOLD?: string
  ENVIRONMENT?: 'production' | 'development'
}

// Type for Vectorize (Cloudflare AI)
interface Vectorize {
  insert(vectors: Array<{ id: string; values: number[] }>): Promise<void>
  query(
    vector: number[],
    options?: { topK: number; returnValues?: boolean; returnMetadata?: 'all' | 'none' }
  ): Promise<VectorizeMatch[] | { matches?: VectorizeMatch[] }>
}

// Type for D1 Database
interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
  exec(query: string): Promise<D1Result>
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first(): Promise<Record<string, unknown> | undefined>
  all(): Promise<D1Result>
  run(): Promise<D1Result>
}

interface D1Result {
  success: boolean
  results?: Record<string, unknown>[]
  errors?: string[]
  meta?: {
    duration: number
    last_row_id?: number
    changes?: number
    served_by?: string
    internal_stats?: string
  }
}
