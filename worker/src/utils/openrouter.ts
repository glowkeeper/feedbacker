import { Env } from '../types'

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface OpenRouterResponse {
  id: string
  model: string
  choices: Array<{
    message: {
      role: string
      content: string
    }
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  model: string = 'openrouter/auto',
  env?: Env
): Promise<string> {
  const key = env?.OPENROUTER_KEY || process.env.OPENROUTER_KEY
  const url = env?.OPENROUTER_URL || process.env.OPENROUTER_URL

  if (!key || !url) {
    throw new Error('OpenRouter credentials not configured')
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://feedbacker.huckle.studio',
      'X-Title': 'Feedbacker',
    },
    body: JSON.stringify({
      model,
      messages,
      reasoning: {
        effort: 'high',
        exclude: true, // Use reasoning but exclude from response
      },
      stream: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter error: ${response.status} ${error}`)
  }

  const data = (await response.json()) as OpenRouterResponse
  const feedback = data.choices?.[0]?.message?.content

  if (!feedback) {
    throw new Error('No feedback content in OpenRouter response')
  }

  return feedback
}

export async function generateEmbedding(
  text: string,
  env: Env,
  model: string = 'text-embedding-3-small'
): Promise<number[]> {
  const key = env.OPENROUTER_KEY
  const url = env.OPENROUTER_URL

  if (!key || !url) {
    throw new Error('OpenRouter credentials not configured')
  }

  // Call OpenRouter embeddings endpoint
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://feedbacker.huckle.studio',
    },
    body: JSON.stringify({
      model,
      input: text,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Embedding error: ${response.status} ${error}`)
  }

  interface EmbeddingResponse {
    data: Array<{ embedding: number[] }>
  }

  const data = (await response.json()) as EmbeddingResponse
  const embedding = data.data?.[0]?.embedding

  if (!embedding) {
    throw new Error('No embedding in response')
  }

  return embedding
}
