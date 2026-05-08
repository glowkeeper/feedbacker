import { Env } from '../types'

const DEFAULT_OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

function resolveOpenRouterConfig(env?: Env): { key: string; chatUrl: string } {
  const processEnv = typeof process !== 'undefined' ? process.env : undefined
  const maybeEnv = env as Env & {
    OPENROUTER_API_KEY?: string
    OPENROUTER_CHAT_URL?: string
    NEXT_PUBLIC_OPENROUTER_KEY?: string
    NEXT_PUBLIC_OPENROUTER_URL?: string
  }

  const key =
    maybeEnv?.OPENROUTER_KEY ||
    maybeEnv?.OPENROUTER_API_KEY ||
    maybeEnv?.NEXT_PUBLIC_OPENROUTER_KEY ||
    processEnv?.OPENROUTER_KEY ||
    processEnv?.OPENROUTER_API_KEY ||
    processEnv?.NEXT_PUBLIC_OPENROUTER_KEY

  const chatUrl =
    maybeEnv?.OPENROUTER_URL ||
    maybeEnv?.OPENROUTER_CHAT_URL ||
    maybeEnv?.NEXT_PUBLIC_OPENROUTER_URL ||
    processEnv?.OPENROUTER_URL ||
    processEnv?.OPENROUTER_CHAT_URL ||
    processEnv?.NEXT_PUBLIC_OPENROUTER_URL ||
    DEFAULT_OPENROUTER_CHAT_URL

  if (!key) {
    throw new Error('OpenRouter API key missing. Set Worker secret OPENROUTER_KEY.')
  }

  return { key, chatUrl }
}

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
  const { key, chatUrl } = resolveOpenRouterConfig(env)

  const response = await fetch(chatUrl, {
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
  const { key } = resolveOpenRouterConfig(env)

  // Call OpenRouter embeddings endpoint
  const response = await fetch(DEFAULT_OPENROUTER_EMBEDDINGS_URL, {
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
