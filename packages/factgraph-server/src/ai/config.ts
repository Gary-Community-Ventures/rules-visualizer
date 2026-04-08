import { ChatOpenAI } from '@langchain/openai'

export type ChatContext = {
  rulesetId: string
}

export function getModel(modelId?: string): ChatOpenAI {
  const apiKey = process.env.OPEN_ROUTER_KEY
  if (!apiKey)
    throw new Error('OPEN_ROUTER_KEY environment variable is required')

  return new ChatOpenAI({
    model: modelId || process.env.AI_MODEL || 'google/gemini-2.5-flash',
    apiKey,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://rules-visualizer.local',
        'X-Title': 'Rules Visualizer',
      },
    },
    streaming: true,
  })
}
