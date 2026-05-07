-- D1 Schema for Feedbacker Backend

-- Rubrics table: stores normalized rubric structures and their hash
CREATE TABLE IF NOT EXISTS rubrics (
  id TEXT PRIMARY KEY,
  rubric_json TEXT NOT NULL,
  rubric_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_rubric_hash ON rubrics(rubric_hash);

-- Feedback examples table: caches feedback + embedding references
CREATE TABLE IF NOT EXISTS feedback_examples (
  id TEXT PRIMARY KEY,
  rubric_id TEXT NOT NULL,
  assessment_text TEXT NOT NULL,
  feedback_text TEXT NOT NULL,
  embedding_id TEXT NOT NULL,
  similarity_score REAL DEFAULT 0.0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (rubric_id) REFERENCES rubrics(id) ON DELETE CASCADE
);

CREATE INDEX idx_feedback_rubric ON feedback_examples(rubric_id);
CREATE INDEX idx_feedback_embedding ON feedback_examples(embedding_id);

-- Sessions table: simple anonymous session tracking
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_session_expires ON sessions(expires_at);

-- Optional: analytics table for monitoring cache hits
CREATE TABLE IF NOT EXISTS analytics (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  feedback_id TEXT,
  is_cache_hit INTEGER DEFAULT 0,
  response_time_ms INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (feedback_id) REFERENCES feedback_examples(id) ON DELETE CASCADE
);

CREATE INDEX idx_analytics_session ON analytics(session_id);
CREATE INDEX idx_analytics_feedback ON analytics(feedback_id);
