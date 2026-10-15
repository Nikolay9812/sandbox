import type { LanguageModelUsage } from "ai"

import { DOLLAR } from "@/lib/billing/format"
import type { GameModelId } from "@/lib/games/model-catalog"

type ModelPrices = {
  /** Input read fresh, neither from nor into the prompt cache. */
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/**
 * Anthropic's list prices, in dollars per million tokens.
 *
 * Cache writes are the 5-minute rate: nothing here asks for the 1-hour cache,
 * which costs more. Reasoning tokens are billed as output, and the SDK already
 * counts them in `outputTokens`.
 *
 * `satisfies` so a model added to the catalog without a price here is a type
 * error, not a step that silently costs nothing.
 */
const PRICES_PER_MILLION = {
  "claude-opus-5": { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  "claude-sonnet-5": { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  "claude-haiku-4-5": {
    input: 1,
    cacheRead: 0.1,
    cacheWrite: 1.25,
    output: 5,
  },
} satisfies Record<GameModelId, ModelPrices>

// Ledger units per token. Every price above comes out a whole number of
// billionths per token, so the cost of a step is exact integer arithmetic.
const perToken = (dollarsPerMillion: number) =>
  Math.round((dollarsPerMillion * DOLLAR) / 1_000_000)

/** What one step's token usage cost, in ledger units. */
export function stepCost(modelId: GameModelId, usage: LanguageModelUsage) {
  const prices = PRICES_PER_MILLION[modelId]
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0
  // `inputTokens` includes the cached tokens, so fresh input is what is left
  // when the provider doesn't break it out.
  const input =
    usage.inputTokenDetails.noCacheTokens ??
    Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite)

  return (
    input * perToken(prices.input) +
    cacheRead * perToken(prices.cacheRead) +
    cacheWrite * perToken(prices.cacheWrite) +
    (usage.outputTokens ?? 0) * perToken(prices.output)
  )
}
