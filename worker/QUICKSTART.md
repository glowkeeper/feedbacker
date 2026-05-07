# Quick Start: Feedbacker Worker Backend

Get the Worker backend running locally in 5 minutes.

## Prerequisites

- Node.js 18+, pnpm
- Cloudflare account (free tier OK)
- OpenRouter API key (free account OK)

## Quick Setup

### 1. Initialize D1 Database

```bash
cd worker

# Create database
wrangler d1 create feedbacker

# Copy the database_id output and update wrangler.toml:
# [[d1_databases]]
# binding = "DB"
# database_id = "PASTE_HERE"

# Apply schema
wrangler d1 execute feedbacker --file=src/db/schema.sql
```

### 2. Create Vectorize Index

Visit [Cloudflare Dashboard → Vectorize](https://dash.cloudflare.com/):
- Click "Create Index"
- Name: `feedbacker-embeddings`
- Dimensions: `1536`
- Metric: `cosine`

### 3. Set Secrets

```bash
wrangler secret put OPENROUTER_KEY
# Paste your OpenRouter key
```

### 4. Start Development Servers

**Terminal 1** (Worker):
```bash
cd worker
wrangler dev
```

**Terminal 2** (Frontend):
```bash
cd app
npm run dev
```

### 5. Test

1. Go to `http://localhost:3000`
2. Create a rubric: `/rubric/create-rubric`
3. Test feedback: `/feedback/submission-based-assessment`
   - Select the rubric you created
   - Upload a PDF (any PDF works)
   - Click "Get Feedback"

## Verify It's Working

**Check Worker logs**:
```bash
wrangler tail
```

**Check database**:
```bash
wrangler d1 execute feedbacker --command="SELECT COUNT(*) as count FROM feedback_examples;"
```

Should see count increase as you submit assessments.

## Deploy

```bash
# Deploy Worker
cd worker && wrangler publish

# Get your Worker URL from output, update frontend .env:
# NEXT_PUBLIC_WORKER_URL=https://feedbacker-worker.your-account.workers.dev

# Deploy frontend (depends on your host)
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "D1 binding not found" | Update `database_id` in `wrangler.toml` |
| "Vectorize binding not found" | Create index in Cloudflare Dashboard, restart `wrangler dev` |
| "No feedback" (hangs) | Check OpenRouter API key is valid |
| CORS error in browser | Verify `NEXT_PUBLIC_WORKER_URL` matches deployed URL |

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed setup and troubleshooting.
