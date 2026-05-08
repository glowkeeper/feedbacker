import { FeedbackRequest, Env } from './types'
import { handleFeedbackRequest } from './routes/feedback'

interface WorkerRequest extends Request {
  json(): Promise<FeedbackRequest>
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

type StartupHealthResult = {
  status: 'ok' | 'degraded'
  timestamp: number
  checks: {
    d1Binding: boolean
    d1Query: boolean
    vectorizeBinding: boolean
    openRouterKey: boolean
  }
  errors: string[]
}

function resolveD1Binding(env: Env & { feedbacker?: unknown }): D1Database | null {
  const maybeDb = (env as Env & { DB?: D1Database; feedbacker?: D1Database }).DB
  const legacyDb = (env as Env & { feedbacker?: D1Database }).feedbacker
  return maybeDb || legacyDb || null
}

async function runStartupHealthCheck(env: Env): Promise<StartupHealthResult> {
  const errors: string[] = []
  const d1 = resolveD1Binding(env as Env & { feedbacker?: unknown })
  const d1Binding = !!d1
  let d1Query = false
  const vectorizeBinding = !!env.VECTORIZE
  const openRouterKey = !!(
    env.OPENROUTER_KEY ||
    (env as Env & { OPENROUTER_API_KEY?: string }).OPENROUTER_API_KEY ||
    (env as Env & { NEXT_PUBLIC_OPENROUTER_KEY?: string }).NEXT_PUBLIC_OPENROUTER_KEY
  )

  if (!d1Binding) {
    errors.push('Missing D1 binding (expected `DB`)')
  }

  if (d1) {
    try {
      const probe = await d1.prepare('SELECT 1 as ok').first()
      d1Query = !!probe
      if (!d1Query) {
        errors.push('D1 probe query returned no result')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown D1 error'
      errors.push(`D1 probe query failed: ${message}`)
    }
  }

  if (!vectorizeBinding) {
    errors.push('Missing Vectorize binding (expected `VECTORIZE`)')
  }

  if (!openRouterKey) {
    errors.push('Missing OpenRouter key (set Worker secret `OPENROUTER_KEY`)')
  }

  return {
    status: errors.length ? 'degraded' : 'ok',
    timestamp: Date.now(),
    checks: {
      d1Binding,
      d1Query,
      vectorizeBinding,
      openRouterKey,
    },
    errors,
  }
}

export default {
  async fetch(request: WorkerRequest, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      })
    }

    try {
      // Route to handler
      if (path === '/api/feedback' && request.method === 'POST') {
        const response = await handleFeedbackRequest(request, env)
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        })
      }

      // Basic health check endpoint
      if (path === '/health' && request.method === 'GET') {
        const health = await runStartupHealthCheck(env)
        return new Response(
          JSON.stringify({
            status: health.status,
            timestamp: health.timestamp,
          }),
          {
            status: health.status === 'ok' ? 200 : 503,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        )
      }

      // Detailed startup readiness endpoint
      if (path === '/health/startup' && request.method === 'GET') {
        const health = await runStartupHealthCheck(env)
        return new Response(JSON.stringify(health), {
          status: health.status === 'ok' ? 200 : 503,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        })
      }

      // 404
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Log error (in production, send to monitoring service)
      if (env.ENVIRONMENT === 'development') {
        console.error('Worker error:', errorMessage)
      }

      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      })
    }
  },
}
