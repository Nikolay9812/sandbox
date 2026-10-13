import { anthropic } from "@ai-sdk/anthropic"
import * as Sentry from "@sentry/node"
import { chat } from "@trigger.dev/sdk/ai"
import { stepCountIs, streamText } from "ai"

import { createGameSandbox } from "@/lib/daytona/utils"
import {
  gameTranscriptStorage,
  saveGameChatToken,
} from "@/lib/games/chat-store"
import { gameInstructions } from "@/lib/games/instructions"
import { createGameTools } from "@/lib/games/tools"

/**
 * A game's chat thread, run as one long-lived task per conversation.
 *
 * A game owns exactly one thread and the chat id is the game id, so the
 * transcript lives on the `games` row: the runtime writes every change to it
 * through `storage`, and reads it back when a later run continues the chat.
 *
 * Authorization happens before a session can exist, in the server actions in
 * `@/lib/games/chat-actions` — there is no Clerk session in here to scope by.
 */
export const gameChat = chat.agent({
  id: "game-chat",
  // A new game is created with its opening prompt already stored, and the
  // client replays that same message to ask for the first reply. The runtime
  // keys its transcript by message id and each save rewrites the whole thread,
  // so the replay replaces the stored prompt rather than doubling it.
  storage: gameTranscriptStorage,
  // Once per worker process — continuations included — so everything this run
  // reports, the error captured in `uiMessageStreamOptions.onError` and the
  // logs from deep inside the tools alike, can be found by game.
  onBoot: ({ chatId, continuation, previousRunId }) => {
    const scope = Sentry.getGlobalScope()
    scope.setTag("game.id", chatId)
    scope.setAttribute("game.id", chatId)

    // A chat moving to a new run is how a crash, an OOM or a cancel shows up
    // from the conversation's side; the previous run is where to look.
    if (continuation) {
      Sentry.logger.info("Game chat continued in a new run", {
        "game.id": chatId,
        ...(previousRunId && { "trigger.previous_run.id": previousRunId }),
      })
    }
  },
  // Fires once per game, on the first message of its thread — so the sandbox
  // is created exactly once and is already seeded before `run` streams a reply.
  onChatStart: async ({ chatId }) => {
    // A throw here ends the turn with an error chunk but leaves the run alive,
    // so the task-level `onFailure` never sees it — it is reported here or not
    // at all. `getGameSandbox` retries the create on the first tool call.
    try {
      await createGameSandbox(chatId)
    } catch (error) {
      Sentry.captureException(error)
      throw error
    }
  },
  // Each run mints its own token, so a continuation has to replace the one a
  // reloading browser would otherwise resume with.
  onTurnStart: async ({ chatId, chatAccessToken }) => {
    await saveGameChatToken({ gameId: chatId, chatAccessToken })
  },
  // One wide event per turn: enough to tell from the logs alone whether a turn
  // did any work, was cut short by the player, or stopped to ask them.
  onTurnComplete: async ({ chatId, turn, stopped, continuation, responseMessage }) => {
    const parts = responseMessage?.parts ?? []
    const toolParts = parts.filter((part) => part.type.startsWith("tool-"))

    Sentry.logger.info("Game chat turn completed", {
      "game.id": chatId,
      "game.chat.turn": turn,
      "game.chat.stopped": stopped,
      "game.chat.continuation": continuation,
      "game.chat.tool_calls": toolParts.length,
      "game.chat.asked_player": toolParts.some(
        (part) => part.type === "tool-ask_player"
      ),
      "game.chat.has_response": responseMessage !== undefined,
    })
  },
  uiMessageStreamOptions: {
    // Model API failures and tool calls that throw (anything `expected` in
    // `@/lib/games/tools` doesn't turn into a result) both land here, and the
    // turn loop keeps the run alive past them — so this is the only place they
    // are seen. The returned text is what the player sees, so it stays the AI
    // SDK's generic default rather than the raw, possibly internal, message.
    onError: (error) => {
      const name = error instanceof Error ? error.name : typeof error

      // A malformed or unknown tool call is the model's mistake, and it reads
      // the error and retries on the next step — notable, but not an issue.
      if (name === "AI_InvalidToolInputError" || name === "AI_NoSuchToolError") {
        Sentry.logger.warn("Game chat tool call rejected", {
          "error.type": name,
          "gen_ai.tool.name": (error as { toolName?: string }).toolName ?? "unknown",
        })
      } else {
        Sentry.captureException(error)
      }

      return "An error occurred."
    },
  },
  // Resolved per turn rather than declared once, because the tools have to
  // write into this game's sandbox: the chat id is the game id, so each turn's
  // set is closed over the right one and the model never names a game itself.
  // Declared on the config and handed back to `streamText` below, rather than
  // only passed there: history re-converted at the top of a later turn needs
  // the same set to make sense of the tool calls already in it.
  tools: ({ chatId }) => createGameTools(chatId),
  run: async ({ messages, tools, signal }) =>
    streamText({
      // Spread first, so every option below still wins. Wires up the
      // `prepareStep` behind compaction, steering and background injection —
      // all of which silently no-op without it.
      ...chat.toStreamTextOptions({ tools }),
      model: anthropic("claude-opus-5"),
      // `instructions`, not the deprecated `system`. Passed here rather than
      // through `chat.prompt.set()` because the prompt is static — there is no
      // per-chat or dashboard-versioned part of it to resolve in a hook.
      instructions: gameInstructions,
      messages,
      // Fires on stop and on cancel. Without it, Stop only updates the UI.
      abortSignal: signal,
      // A turn is a read-edit-read loop over the game's files, so it needs
      // room for many steps; the default of one would stop the turn dead
      // after the first tool call, before the model has said anything.
      stopWhen: stepCountIs(48),
    }),
})