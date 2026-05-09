import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callOpenRouter, generateEmbedding } from '../utils/openrouter'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockEnv = { OPENROUTER_KEY: 'test-key-abc' } as any

function makeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  } as unknown as Response
}

// ─── callOpenRouter ───────────────────────────────────────────────────────────

describe('callOpenRouter', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns content when response has a string content field', async () => {
    const payload = {
      id: 'r1',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: 'Good work!' }, finish_reason: 'stop' }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(payload)))

    const result = await callOpenRouter([{ role: 'user', content: 'Mark this' }], 'gpt-4', mockEnv)
    expect(result).toBe('Good work!')
  })

  it('returns joined content when response has an array of content parts', async () => {
    const payload = {
      id: 'r2',
      model: 'gpt-4',
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Part one. ' },
              { type: 'text', text: 'Part two.' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(payload)))

    const result = await callOpenRouter([{ role: 'user', content: 'test' }], 'gpt-4', mockEnv)
    expect(result).toBe('Part one. Part two.')
  })

  it('falls back to choice.text when message.content is null', async () => {
    const payload = {
      id: 'r3',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: null }, text: 'Fallback text', finish_reason: 'stop' }],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(payload)))

    const result = await callOpenRouter([{ role: 'user', content: 'test' }], 'gpt-4', mockEnv)
    expect(result).toBe('Fallback text')
  })

  it('throws when response content is empty', async () => {
    const payload = {
      id: 'r4',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(payload)))

    await expect(
      callOpenRouter([{ role: 'user', content: 'test' }], 'gpt-4', mockEnv)
    ).rejects.toThrow('No feedback content')
  })

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('Unauthorized', false, 401)))

    await expect(
      callOpenRouter([{ role: 'user', content: 'test' }], 'gpt-4', mockEnv)
    ).rejects.toThrow('OpenRouter error: 401')
  })

  it('throws when OPENROUTER_KEY is missing', async () => {
    await expect(
      callOpenRouter([{ role: 'user', content: 'test' }], 'gpt-4', {} as any)
    ).rejects.toThrow('OpenRouter API key missing')
  })

  it('sends the correct Authorization header', async () => {
    const payload = {
      id: 'r5',
      model: 'gpt-4',
      choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    }
    const mockFetch = vi.fn().mockResolvedValue(makeFetchResponse(payload))
    vi.stubGlobal('fetch', mockFetch)

    await callOpenRouter([{ role: 'user', content: 'test' }], 'gpt-4', mockEnv)

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key-abc')
  })
})

// ─── generateEmbedding ────────────────────────────────────────────────────────

describe('generateEmbedding', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a number array from the API response', async () => {
    const vector = Array.from({ length: 1536 }, (_, i) => i * 0.001)
    const payload = { data: [{ embedding: vector }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(payload)))

    const result = await generateEmbedding('some text', mockEnv)
    expect(result).toHaveLength(1536)
    expect(result[0]).toBeCloseTo(0)
  })

  it('throws when embedding is missing in the response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({ data: [] })))

    await expect(generateEmbedding('text', mockEnv)).rejects.toThrow('No embedding in response')
  })

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse('Server error', false, 500)))

    await expect(generateEmbedding('text', mockEnv)).rejects.toThrow('Embedding error: 500')
  })
})
