import { anthropic } from "@ai-sdk/anthropic"
import { chat } from "@trigger.dev/sdk/ai"
import { validateUIMessages } from "ai"

import { generateMessageId } from "@/lib/games/messages"
import { gameTranscriptStorage } from "@/lib/games/transcript-storage"

/**
 * A game's chat thread. A game owns exactly one thread, so the chat id is the
 * game id. History is read from and written back to the game row through
 * `gameTranscriptStorage`.
 */
export const gameChat = chat.agent({
  id: "game-chat",
  storage: gameTranscriptStorage,
  // The thread is persisted, so guard the shape of what gets written back.
  onValidateMessages: ({ messages }) => validateUIMessages({ messages }),
  uiMessageStreamOptions: {
    generateMessageId,
    // Never forward provider errors (keys, stack traces) to the browser.
    onError: () => "An error occurred.",
  },
  run: async ({ messages, signal, streamText }) =>
    streamText({
      model: anthropic("claude-sonnet-5"),
      messages,
      abortSignal: signal,
    }),
})
