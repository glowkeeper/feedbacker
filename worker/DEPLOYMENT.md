# Feedbacker Worker Backend Deployment & Setup Guide

This guide walks through setting up and deploying the Cloudflare Worker backend for Feedbacker.

## Architecture Overview

```
Next.js Frontend (app/)
        ↓
Cloudflare Worker API (worker/)
        ↓
├── D1 Database (rubrics, feedback cache, sessions)
├── Vectorize (semantic search index)
└── OpenRouter API (LLM calls for new assessments)
```

## Prerequisites

- Cloudflare account with Workers enabled
- Node.js 18+ and pnpm
- OpenRouter API key
- (Optional) Knowledge of D1 and Vectorize services

## Step 1: Initialize Cloudflare Worker

### 1.1 Install Wrangler (if not already installed)

```bash
npm install -g wrangler
```

### 1.2 Login to Cloudflare

```bash
wrangler login
```

### 1.3 Create D1 Database

```bash
cd worker
wrangler d1 create feedbacker
```

This creates a D1 database and returns a `database_id`. Copy this ID.

### 1.4 Update `wrangler.toml`

Replace the `database_id` placeholder with the ID from step 1.3:

```toml
[[d1_databases]]
binding = "DB"
database_name = "feedbacker"
database_id = "your-actual-db-id"
```

### 1.5 Create Vectorize Index

Go to Cloudflare Dashboard → Vectorize and create an index:

- **Index Name**: `feedbacker-embeddings`
- **Dimensions**: `1536` (for most embedding models)
- **Metric**: `cosine`

Or use wrangler (if supported in your version):

```bash
wrangler vectorize create feedbacker-embeddings --dimensions=1536 --metric=cosine
```

### 1.6 Apply Database Schema

```bash
wrangler d1 execute feedbacker --file=src/db/schema.sql
```

Verify the schema:

```bash
wrangler d1 execute feedbacker --command="SELECT name FROM sqlite_master WHERE type='table';"
```

Should return: `rubrics`, `feedback_examples`, `sessions`, `analytics`.

## Step 2: Configure Environment Variables

### 2.1 Worker Environment Variables

In `worker/wrangler.toml`, add secrets:

```bash
wrangler secret put OPENROUTER_KEY
# Paste your OpenRouter API key
```

### 2.2 Worker Local Development (.env.local)

Create `worker/.env.local`:

```
OPENROUTER_KEY=your-openrouter-key
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
SIMILARITY_THRESHOLD=0.8
ENVIRONMENT=development
```

### 2.3 Frontend Environment Variables

Update `app/.env.local`:

```
NEXT_PUBLIC_WORKER_URL=http://localhost:8787  # for local dev
# OR: https://feedbacker-worker.your-domain.com  # for production

NEXT_PUBLIC_OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
NEXT_PUBLIC_OPENROUTER_KEY=your-key  # fallback only
NEXT_PUBLIC_OPENROUTER_MODEL=openrouter/auto
NEXT_PUBLIC_HANDSONTABLE_LICENSE_KEY=your-key
NEXT_PUBLIC_TITLE=Feedbacker
NEXT_PUBLIC_HOMEPAGE=http://localhost:3000
```

## Step 3: Local Development

### 3.1 Install Dependencies

```bash
cd worker
npm install
```

### 3.2 Run Wrangler Dev Server

```bash
wrangler dev
```

This starts the Worker at `http://localhost:8787` with local D1 and Vectorize bindings.

### 3.3 In Another Terminal, Run Frontend

```bash
cd ..
npm run dev
```

Frontend runs at `http://localhost:3000`.

## Step 4: Test the Integration

### 4.1 Create a Rubric in Frontend

1. Navigate to `/rubric/create-rubric`
2. Create a simple rubric with criteria (e.g., "Clarity", "Structure", "Completeness")
3. Save it with a name like "Test Rubric"

### 4.2 Test Submission-Based Assessment

1. Go to `/feedback/submission-based-assessment`
2. Select "Test Rubric" from the dropdown
3. Upload or create a simple student PDF (or any PDF)
4. Click "Get Feedback"
5. Check response:
   - First call should show `cached: false` (new assessment)
   - Should see feedback from OpenRouter
   - Check Worker logs: `wrangler tail`

### 4.3 Test Caching

1. Submit a similar assessment with the same rubric
2. If similarity > 0.8, should get `cached: true`
3. Feedback should be identical/very similar
4. Response time should be much faster

### 4.4 Verify Database

```bash
wrangler d1 execute feedbacker --command="SELECT COUNT(*) as feedback_count FROM feedback_examples;"
```

Should increment with each new assessment.

## Step 5: Deploy to Production

### 5.1 Deploy Worker

```bash
cd worker
wrangler publish
```

Wrangler returns your Worker URL (e.g., `https://feedbacker-worker.your-account.workers.dev`).

### 5.2 Update Frontend Environment

Update `app/.env` for production:

```
NEXT_PUBLIC_WORKER_URL=https://feedbacker-worker.your-account.workers.dev
```

### 5.3 Deploy Frontend

```bash
npm run build
npm run deploy  # or your hosting provider's deploy command
```

### 5.4 Enable CORS in Cloudflare

The Worker includes CORS headers, but verify:

1. Cloudflare Dashboard → Workers → Feedbacker Worker → Settings
2. Ensure routes are public (not behind authentication)

## Troubleshooting

### Worker Errors

**Problem**: `D1 binding not found`

- Ensure `database_id` in `wrangler.toml` matches created database
- Run `wrangler d1 list` to verify

**Problem**: `Vectorize binding not found`

- Ensure index exists in Cloudflare Dashboard
- Restart `wrangler dev`

### Embedding Errors

**Problem**: `Embedding model not found`

- Verify OpenRouter API key is valid
- Check model name in `openrouter.ts` (defaults to `text-embedding-3-small`)
- Try a different model via OpenRouter API docs

### Cache Not Working

**Problem**: Assessments never return `cached: true`

- Lower `SIMILARITY_THRESHOLD` (e.g., from 0.8 to 0.7)
- Check `SIMILARITY_THRESHOLD` is set in `wrangler.toml`
- Verify Vectorize index has embeddings: `wrangler vectorize list`

### CORS Issues

**Problem**: Frontend gets CORS error calling Worker

- Ensure Worker URL in `.env` matches deployed Worker
- Check browser console for exact error
- Verify Worker returns `Access-Control-Allow-Origin: *` headers

## Monitoring & Analytics

### View Analytics in D1

```bash
wrangler d1 execute feedbacker --command="SELECT session_id, is_cache_hit, response_time_ms FROM analytics ORDER BY created_at DESC LIMIT 10;"
```

### Worker Logs

```bash
wrangler tail
```

Shows real-time logs from Worker execution.

## Next Steps

1. **Fine-tune similarity threshold**: Adjust `SIMILARITY_THRESHOLD` based on real usage
2. **Add rate limiting**: Use Durable Objects for per-session rate limits
3. **Optimize embeddings**: Consider dedicated embedding service if costs spike
4. **Archive old feedback**: Implement data retention policy in D1
5. **Add user accounts**: (Optional) Migrate from anonymous to authenticated sessions

## Files Reference

| File | Purpose |
|------|---------|
| `worker/wrangler.toml` | Worker config, bindings, env vars |
| `worker/src/index.ts` | Main Worker entry point, routing |
| `worker/src/routes/feedback.ts` | POST /api/feedback endpoint |
| `worker/src/db/schema.sql` | D1 table definitions |
| `worker/src/db/queries.ts` | D1 query helpers |
| `worker/src/utils/openrouter.ts` | OpenRouter API client |
| `worker/src/utils/rubric.ts` | Rubric normalization, embedding context |
| `worker/src/types/index.ts` | TypeScript type definitions |
| `app/utils/workerAPI.ts` | Frontend Worker client |
| `app/feedback/Feedback.tsx` | Updated to use Worker |

## Questions?

Check the main [Feedbacker README](../README.md) or open an issue on GitHub.
