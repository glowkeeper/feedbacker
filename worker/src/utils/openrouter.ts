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
      content: string | Array<{ type?: string; text?: string }> | null
    }
    text?: string
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

function extractMessageContent(data: OpenRouterResponse): string {
  const firstChoice = data.choices?.[0]
  if (!firstChoice) {
    return ''
  }

  const content = firstChoice.message?.content

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        if (part && typeof part.text === 'string') {
          return part.text
        }
        return ''
      })
      .join('')
      .trim()
    if (joined) {
      return joined
    }
  }

  if (typeof firstChoice.text === 'string') {
    return firstChoice.text.trim()
  }

  return ''
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
  const feedback = extractMessageContent(data)

  if (!feedback) {
    const finishReason = data.choices?.[0]?.finish_reason || 'unknown'
    const usageSummary = data.usage
      ? `prompt_tokens=${data.usage.prompt_tokens || 0}, completion_tokens=${data.usage.completion_tokens || 0}`
      : 'no usage block'
    throw new Error(`No feedback content in OpenRouter response (finish_reason=${finishReason}, ${usageSummary})`)
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
