// Utility to call the Feedbacker Worker backend API

import type { Rubric } from '@/app/store/types'

interface WorkerFeedbackRequest {
  rubric: Rubric
  assessmentText: string
  sessionId?: string
  prompt?: string
}

interface WorkerFeedbackResponse {
  feedback: string
  cached: boolean
  feedbackId: string
  similarityScore?: number
  timestamp: number
}

export async function callWorkerFeedback(
  request: WorkerFeedbackRequest
): Promise<WorkerFeedbackResponse> {
  const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL

  if (!workerUrl) {
    throw new Error('Worker URL not configured (NEXT_PUBLIC_WORKER_URL)')
  }

  const response = await fetch(`${workerUrl}/api/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Worker error: ${response.status} ${error}`)
  }

  return await response.json()
}

/**
 * Fallback to direct OpenRouter call (for development without Worker)
 */
interface DirectFeedbackRequest {
  prompt: string
  rubricBase64?: string
  studentBase64?: string
}

export async function callOpenRouterDirectly(request: DirectFeedbackRequest): Promise<string> {
  const url = process.env.NEXT_PUBLIC_OPENROUTER_URL
  const key = process.env.NEXT_PUBLIC_OPENROUTER_KEY

  if (!url || !key) {
    throw new Error('OpenRouter not configured')
  }

  const content: any[] = [
    {
      type: 'text',
      text: request.prompt,
    },
  ]

  if (request.rubricBase64) {
    content.push({
      type: 'file',
      file: {
        filename: 'rubric.pdf',
        file_data: request.rubricBase64,
      },
    })
  }

  if (request.studentBase64) {
    content.push({
      type: 'file',
      file: {
        filename: 'submission.pdf',
        file_data: request.studentBase64,
      },
    })
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': process.env.NEXT_PUBLIC_HOMEPAGE || '',
      'X-Title': process.env.NEXT_PUBLIC_TITLE || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      reasoning: {
        effort: 'high',
        exclude: true,
      },
      plugins: [
        {
          id: 'file-parser',
          pdf: {
            engine: 'pdf-text',
          },
        },
      ],
      stream: false,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter error: ${response.status} ${error}`)
  }

  interface OpenRouterResponse {
    choices?: Array<{
      message?: {
        content?: string
      }
    }>
  }

  const data = (await response.json()) as OpenRouterResponse
  const feedback = data.choices?.[0]?.message?.content

  if (!feedback) {
    throw new Error('No feedback in response')
  }

  return feedback
}
