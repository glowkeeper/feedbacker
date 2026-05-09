# Feedbacker Backend Architecture & Data Flow

## System Overview

Feedbacker now has a two-tier architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                       │
│  - Rubric creation/selection (localStorage)                 │
│  - PDF upload & text extraction                             │
│  - Session management                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │ POST /api/feedback
                       │ {rubric, assessmentText, sessionId}
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER API                          │
│  - Request routing & CORS                                   │
│  - Input validation                                         │
│  - Orchestration (DB, embedding, cache, LLM)               │
└──────────────────────┬──────────────────────────────────────┘
         ┌─────────────┼──────────────┬─────────────┐
         ▼             ▼              ▼             ▼
    ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
    │   D1    │  │ Vectorize│  │OpenRouter│  │  Analytics   │
    │Database │  │ (Vector  │  │(LLM +    │  │  (optional)  │
    │ Storage │  │  Search) │  │Embeddings)  │              │
    └─────────┘  └──────────┘  └──────────┘  └──────────────┘
         │
         └─────────────┬──────────────┬─────────────┐
                       ▼              ▼             ▼
              ┌─────────────────────────────────────┐
              │  Tables:                            │
              │  - rubrics (structure + hash)      │
              │  - feedback_examples (cache)       │
              │  - sessions (anonymous tracking)   │
              │  - analytics (telemetry)           │
              └─────────────────────────────────────┘
```

---

## Request/Response Flow

### Scenario 1: New Assessment (Cache Miss)

```
1. Frontend extracts text from student PDF
2. Frontend loads rubric (array or localStorage)
3. Frontend calls Worker:
   {
     rubric: [[...criteria...]],
     assessmentText: "student's work...",
     sessionId: "sess_...",
     prompt?: "custom prompt (optional)"
   }

4. Worker:
   a) Normalize rubric (extract criteria, performance levels)
   b) Hash rubric (SHA-256) for deduplication
   c) Check if rubric exists in D1 (by hash)
   d) Generate embedding from rubric + assessment
   e) Query Vectorize for similar embeddings (cosine similarity)
   f) No match found → Cache miss
   g) Call OpenRouter LLM for feedback
   h) Store feedback + embedding in D1 + Vectorize
   i) Record analytics (response time, cache miss)

5. Frontend receives:
   {
     feedback: "detailed criterion-aligned feedback...",
     cached: false,
     feedbackId: "feedback_...",
     similarityScore: 0.0,
     timestamp: 1778259003616
   }
```

### Scenario 2: Similar Assessment (Cache Hit)

```
1-3. Same as above

4. Worker:
   a-e. Same: normalize, hash, check D1, embed, query Vectorize
   f) HIGH SIMILARITY match found (>0.8 cosine similarity)
   g) Retrieve cached feedback from D1 (via embedding_id)
   h) Skip OpenRouter call (save cost & latency)
   i) Record analytics (response time, cache hit)

5. Frontend receives:
   {
     feedback: "same/similar cached feedback",
     cached: true,
     feedbackId: "feedback_xyz",
     similarityScore: 0.92,
     timestamp: ...
   }
```

---

## Component Details

### Frontend (Next.js)

**Rubrics**
- Stored in browser localStorage under `feedbacker-rubrics` key
- Format: 2D array (rows × columns, matching Handsontable spreadsheet)
- Structure:
  ```
  [
    ["", "", "Level 1", "Level 2", ...],
    ["Criteria", "Weighting", "0", "1-30", ...],
    ["Criterion 1", "20%", "comment", "comment", ...],
    ["Criterion 2", "20%", "comment", "comment", ...],
    ...
  ]
  ```

**PDF Extraction** (`pdfExtract.ts`)
- Current: `pdf.js` extraction with worker-first parsing and non-worker fallback
- Uses explicit timeouts for file read, document load, and per-page extraction
- Extracted submission text is sent to the Worker for rubric-aligned analysis

**Worker API Client** (`workerAPI.ts`)
- Calls Worker endpoint: `POST ${NEXT_PUBLIC_WORKER_URL}/api/feedback`
- Fallback: Direct OpenRouter if no Worker URL configured
- Handles CORS + auth headers

**Session Management**
- Anonymous session ID generated client-side
- Passed to Worker on each request
- Worker validates/extends expiry in D1

---

### Worker (Cloudflare)

**Routes**
- `POST /api/feedback` — Main feedback generation endpoint
- `GET /health` — Basic liveness check
- `GET /health/startup` — Detailed readiness (bindings + keys)

**Core Logic** (`routes/feedback.ts`)

```
handleFeedbackRequest(request, env):
  1. Parse request body {rubric, assessmentText, sessionId, prompt}
  2. Normalize rubric → RubricStructure
  3. Hash normalized rubric
  4. Check D1 for existing rubric (deduplication)
  5. Generate embedding (OpenRouter)
  6. Query Vectorize (top-3 similar embeddings)
  7. If similarity > threshold:
       → Fetch cached feedback from D1
     Else:
       → Call OpenRouter LLM
       → Store feedback + embedding
  8. Record analytics
  9. Return {feedback, cached, feedbackId, ...}
```

**Database Schema** (D1)

```sql
rubrics
  id TEXT PRIMARY KEY
  rubric_json TEXT          -- normalized structure
  rubric_hash TEXT UNIQUE   -- SHA-256 for deduplication
  created_at INTEGER

feedback_examples
  id TEXT PRIMARY KEY
  rubric_id TEXT FK         -- which rubric
  assessment_text TEXT      -- extracted submission text payload
  feedback_text TEXT        -- generated feedback
  embedding_id TEXT         -- reference to Vectorize
  similarity_score REAL     -- for analytics
  created_at INTEGER

sessions
  id TEXT PRIMARY KEY
  created_at INTEGER
  expires_at INTEGER
  last_activity INTEGER

analytics
  id TEXT PRIMARY KEY
  session_id TEXT FK
  feedback_id TEXT FK
  is_cache_hit INTEGER      -- 0 or 1
  response_time_ms INTEGER
  created_at INTEGER
```

**Vectorize Index**
- Name: `feedbacker-embeddings`
- Dimensions: 1536 (OpenRouter embeddings)
- Metric: Cosine similarity
- Stores: Embedding vectors + embedding_id links to D1

**Environment Variables**
```
Secrets (set via wrangler secret put):
  OPENROUTER_KEY

Config (in wrangler.toml):
  OPENROUTER_URL
  SIMILARITY_THRESHOLD
  ENVIRONMENT
```

---

## Rubric Normalization Example

**Input** (raw 2D array from frontend):
```
[
  ["", "", "Fail", "Pass", "Excellent"],
  ["Criteria", "Weight", "0-40", "41-70", "71-100"],
  ["Clarity", "30%", "Unclear writing", "Clear writing", "Very clear"],
  ["Completeness", "40%", "Missing sections", "All sections present", "All sections excellent"],
  ["Analysis", "30%", "Shallow", "Adequate depth", "Deep analysis"]
]
```

**Output** (normalized RubricStructure):
```
{
  criteria: [
    {
      name: "Clarity",
      weighting: "30%",
      level_0_Fail: "Unclear writing",
      level_1_Pass: "Clear writing",
      level_2_Excellent: "Very clear"
    },
    {
      name: "Completeness",
      weighting: "40%",
      level_0_Fail: "Missing sections",
      level_1_Pass: "All sections present",
      level_2_Excellent: "All sections excellent"
    },
    {
      name: "Analysis",
      weighting: "30%",
      level_0_Fail: "Shallow",
      level_1_Pass: "Adequate depth",
      level_2_Excellent: "Deep analysis"
    }
  ],
  performanceLevels: ["Fail", "Pass", "Excellent"],
  metadata: { createdAt: "2026-05-08T..." }
}
```

**Hash**: SHA-256 of JSON string → stable identifier for cache deduplication

---

## Embedding & Similarity Search

**Embedding Context** (built before OpenRouter call):
```
RUBRIC:
Criterion: Clarity (Weight: 30%). Levels: Unclear writing; Clear writing; Very clear
Criterion: Completeness (Weight: 40%). Levels: Missing sections; All sections present; All sections excellent
Criterion: Analysis (Weight: 30%). Levels: Shallow; Adequate depth; Deep analysis

ASSESSMENT:
[extracted submission text excerpt]
```

**Embedding Model**: OpenRouter's `text-embedding-3-small` (1536 dimensions)

**Similarity Search**:
1. Generate embedding for current assessment
2. Query Vectorize: `index.query(embedding, {topK: 3})`
3. Get top-3 results with cosine similarity scores
4. If best score > threshold (default 0.8) → cache hit
5. Else → new LLM call

---

## Cost & Performance Model

| Operation | Cost | Latency | Cached? |
|-----------|------|---------|---------|
| OpenRouter LLM call | ~$0.002-0.01/call | 3-10s | No |
| OpenRouter embedding | ~$0.00001/embedding | 100-500ms | Always |
| Vectorize query | Free (Cloudflare) | <50ms | N/A |
| D1 write | Free (Cloudflare) | 10-50ms | N/A |
| **Cache hit (reuse feedback)** | ~$0.00001 (embedding only) | <500ms | Yes ✓ |

**Savings with caching**: 100× faster, 1000× cheaper for similar assessments.

---

## Error Handling & Degradation

**Vectorize unavailable (local dev)**:
- Query fails → Continue without cache search
- Insert fails → Continue with D1 storage only
- Feedback still generated via OpenRouter

**OpenRouter key missing**:
- Worker startup check detects it
- Returns 503 with error list from `/health/startup`

**D1 connection issue**:
- Startup check detects it
- Feedback generation fails (depends on D1 storage)

---

## Deployment Environments

### Local Development (`wrangler dev`)
- D1: Local SQLite (in-memory or .wrangler/)
- Vectorize: Remote (requires `remote = true` in wrangler.toml)
- OpenRouter: Requires secret in `.dev.vars`
- No cost, fast feedback loop

### Production (`wrangler deploy`)
- D1: Cloudflare managed, replicated
- Vectorize: Cloudflare managed, globally indexed
- OpenRouter: via Worker secrets
- Minimal cost (D1/Vectorize free tier, pay only for LLM calls)

---

## Future Improvements

1. **OCR support**: Add optional OCR for scanned/image-only PDFs
2. **User accounts**: Move from anonymous to authenticated sessions
3. **Rate limiting**: Use Durable Objects for per-user quotas
4. **Analytics dashboard**: Query D1 for cache hit rates, latency trends
5. **Rubric versioning**: Track rubric changes over time
6. **Feedback refinement**: Let teachers edit & re-prompt without re-running embedding

