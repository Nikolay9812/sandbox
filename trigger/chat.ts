import { anthropic } from "@ai-sdk/anthropic"
import { chat, upsertIncomingMessage } from "@trigger.dev/sdk/ai"
import { stepCountIs } from "ai"

import { createGameSandbox } from "@/lib/daytona/utils"
import {
  loadGameMessages,
  saveGameMessages,
  saveGameTurn,
} from "@/lib/games/chat-store"
import { gameInstructions } from "@/lib/games/instructions"
import { createGameTools } from "@/lib/games/tools"

/**
 * A game's chat thread, run as one long-lived task per conversation.
 *
 * A game owns exactly one thread and the chat id is the game id, so the
 * `games` row stays the source of truth for history: `hydrateMessages` reads it
 * back at the top of every turn instead of trusting the copy the browser holds.
 *
 * Authorization happens before a session can exist, in the server actions in
 * `@/lib/games/chat-actions` — there is no Clerk session in here to scope by.
 */
export const gameChat = chat.agent({
  id: "game-chat",
  // Set on the agent rather than in `run`, so `chat.toStreamTextOptions()`
  // carries it into every turn. It never changes between turns, which makes it
  // the prompt's most valuable cache breakpoint.
  system: gameInstructions.join("\n\n"),
  cacheControl: { type: "ephemeral" },
  // Resolved per turn because each tool is bound to its game's sandbox, and the
  // chat id is the game id. Declared here as well as passed to `streamText` so
  // the SDK re-converts earlier turns' tool calls against the same set.
  tools: ({ chatId }) => createGameTools(chatId),
  hydrateMessages: async ({ chatId, trigger, incomingMessages }) => {
    const stored = await loadGameMessages(chatId)

    // Appends a genuinely new user message and no-ops otherwise. A new game is
    // created with its opening prompt already stored, and the client replays
    // that same message to ask for the first reply — this dedupes it by id.
    if (upsertIncomingMessage(stored, { trigger, incomingMessages })) {
      await saveGameMessages({ gameId: chatId, messages: stored })
    }

    return stored
  },
  // Fires once per game, on the first message of its thread — so the sandbox
  // is created exactly once and is already seeded before `run` streams a reply.
  onChatStart: async ({ chatId }) => {
    await createGameSandbox(chatId)
  },
  onTurnComplete: async ({
    chatId,
    uiMessages,
    chatAccessToken,
    lastEventId,
  }) => {
    await saveGameTurn({
      gameId: chatId,
      messages: uiMessages,
      chatAccessToken,
      chatLastEventId: lastEventId,
    })
  },
  // The run argument's `streamText`, not the one from `ai`: it carries the
  // system prompt and the `prepareStep` behind compaction, steering and
  // background injection — and merges `tools` with the managed ones, where
  // spreading `chat.toStreamTextOptions()` and then setting `tools` replaces
  // them.
  run: async ({ messages, tools, signal, streamText }) =>
    streamText({
      model: anthropic("claude-sonnet-5"),
      messages,
      tools,
      // A build is many tool calls — list, read, a write per file, fixes — and
      // the default stops after the first step.
      stopWhen: stepCountIs(50),
      // Fires on stop and on cancel. Without it, Stop only updates the UI.
      abortSignal: signal,
    }),
})
