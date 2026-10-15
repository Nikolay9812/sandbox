import { chat } from "@trigger.dev/sdk/ai"
import {
  createUIMessageStream,
  stepCountIs,
  streamText,
  type StepResult,
  type ToolSet,
  type UIMessage,
  type UIMessageStreamOptions,
} from "ai"
import { z } from "zod"

import { chargeStep, getBalance } from "@/lib/billing/ledger"
import { stepCost } from "@/lib/billing/pricing"
import { checkCredits } from "@/lib/billing/reconcile"
import { createGameSandbox } from "@/lib/daytona/utils"
import { gameModelSettings } from "@/lib/games/agent"
import {
  gameTranscriptStorage,
  loadGameOrgId,
  saveGameChatToken,
} from "@/lib/games/chat-store"
import { gameInstructions } from "@/lib/games/instructions"
import {
  DEFAULT_GAME_MODEL_ID,
  GAME_MODELS,
  type GameModelId,
} from "@/lib/games/model-catalog"
import { describeError, elapsed, logger } from "@/lib/observability"
import { createGameTools } from "@/lib/games/tools"

// Everything the browser gets to say about a turn, which is the model to run it
// on and nothing else. The id is checked against the catalog rather than taken
// as a string, so a tab naming a model this app doesn't offer — or one that
// doesn't exist — is rejected here instead of at the provider.
//
// Optional at both levels because there is no picker yet: nothing sends client
// data at all today, and a turn with none runs on `DEFAULT_GAME_MODEL_ID`.
const gameClientDataSchema = z
  .object({
    modelId: z.enum(GAME_MODELS.map((model) => model.id)).optional(),
  })
  .optional()

// A turn is a read-edit-read loop over the game's files, so it needs room for
// many steps; the default of one would stop the turn dead after the first tool
// call, before the model has said anything.
const MAX_STEPS = 48

/**
 * A game's chat thread, run as one long-lived task per conversation.
 *
 * A game owns exactly one thread and the chat id is the game id, so the
 * `games` row is the thread's storage: `gameTranscriptStorage` loads it when a
 * run boots and the runtime saves every change back to it.
 *
 * Authorization happens before a session can exist, in the server actions in
 * `@/lib/games/chat-actions` — there is no Clerk session in here to scope by.
 */
export const gameChat = chat.agent({
  id: "game-chat",
  clientDataSchema: gameClientDataSchema,
  storage: gameTranscriptStorage,
  // Fires once per game, on the first message of its thread — so the sandbox
  // is created exactly once and is already seeded before `run` streams a reply.
  onChatStart: async ({ chatId }) => {
    try {
      await createGameSandbox(chatId)
    } catch (error) {
      // Fires exactly once per game, and everything the agent does afterwards
      // needs what it builds. Failing here doesn't stop the turn — the tools
      // fall back to creating a sandbox themselves — but it does mean the first
      // turn pays that cost mid-stream, and it is the explanation for the
      // `getGameSandbox` warning that follows.
      logger.error(
        logger.fmt`Could not create the sandbox for game ${chatId}`,
        { "game.id": chatId, ...describeError(error) }
      )

      throw error
    }
  },
  // A continuation run mints a fresh session token, and a reloading browser
  // resumes the chat with whatever the row holds — so it is refreshed here, at
  // the top of every turn, before anything streams.
  onTurnStart: async ({ chatId, chatAccessToken, uiMessages, turn }) => {
    await saveGameChatToken({ gameId: chatId, chatAccessToken })

    // The top of every turn, and the one place the thread's size is visible.
    // Message *counts*, never message content: the thread is the player's
    // prompts and the agent's game source, both of which stay out of Sentry.
    logger.info(logger.fmt`Chat turn starting for game ${chatId}`, {
      "game.id": chatId,
      "chat.turn": turn,
      "chat.messages": uiMessages.length,
    })
  },
  onTurnComplete: async ({ chatId, uiMessages, lastEventId, clientData }) => {
    // Pairs with the `Chat turn starting` log above: one of each per turn, so a
    // turn that began and never ended is a gap rather than something to infer.
    logger.info(logger.fmt`Chat turn complete for game ${chatId}`, {
      "game.id": chatId,
      "gen_ai.request.model": clientData?.modelId ?? DEFAULT_GAME_MODEL_ID,
      "chat.messages": uiMessages.length,
      // A turn that ends with no cursor cannot be resumed, so a reload
      // replays it — worth being able to count.
      "chat.has_cursor": lastEventId !== undefined,
    })
  },
  // Resolved per turn rather than declared once, because the tools have to
  // write into this game's sandbox: the chat id is the game id, so each turn's
  // set is closed over the right one and the model never names a game itself.
  // Declared on the config and handed back to `streamText` below, rather than
  // only passed there: history re-converted at the top of a later turn needs
  // the same set to make sense of the tool calls already in it.
  tools: ({ chatId }) => createGameTools(chatId),
  run: async ({ chatId, messages, tools, signal, clientData }) => {
    // A turn with nothing to answer. The history ends on the agent's own reply,
    // which means whatever opened this turn added no message to it — a thread
    // submitted twice, or a tab asking for a reply it has already been given.
    // A trailing assistant message is read as a prefill for the model to carry
    // on from, and these models refuse one outright, so the turn would die at
    // the provider rather than quietly do nothing. Returning no stream ends it
    // here instead: nothing generated, nothing charged, nothing added to the
    // thread.
    if (messages.at(-1)?.role === "assistant") {
      logger.warn(
        logger.fmt`Skipped a turn with nothing to answer for game ${chatId}`,
        {
          "game.id": chatId,
          "chat.messages": messages.length,
        }
      )

      return
    }

    const modelId = clientData?.modelId ?? DEFAULT_GAME_MODEL_ID
    // Looked up per turn, since the game id is all the session carries. Taken
    // from the game's row rather than `clientData`, which the browser writes.
    const orgId = await loadGameOrgId(chatId)

    // Checked once per turn, before the model is called: a turn that starts
    // with credit runs to the end even if its steps take the balance below
    // zero, and the next one is refused here.
    if (orgId) {
      const { hasCredits, balance } = await checkCredits(orgId)
      if (!hasCredits) {
        logger.info(logger.fmt`Chat turn refused for game ${chatId}`, {
          "game.id": chatId,
          "org.id": orgId,
          "billing.balance": balance,
        })

        return fixedReply(OUT_OF_CREDITS_REPLY)
      }
    }

    return streamText({
      // Spread first, so every option below still wins. Wires up the
      // `prepareStep` behind compaction, steering and background injection —
      // all of which silently no-op without it.
      ...chat.toStreamTextOptions({ tools }),
      // Read per turn rather than fixed for the thread, so switching models
      // mid-conversation takes effect on the next message and carries the
      // history with it. Spread rather than assigned because what varies with
      // the model is `model` today and may not be only that later.
      ...gameModelSettings(modelId),
      // `instructions`, not the deprecated `system`. Passed here rather than
      // through `chat.prompt.set()` because the prompt is static — there is no
      // per-chat or dashboard-versioned part of it to resolve in a hook.
      instructions: gameInstructions,
      messages,
      // Fires on stop and on cancel. Without it, Stop only updates the UI.
      abortSignal: signal,
      stopWhen: stepCountIs(MAX_STEPS),
      // Every model call is paid for as soon as it ends, so a long build draws
      // the balance down as it goes rather than all at once at the end.
      onStepEnd: (step) => billStep({ gameId: chatId, orgId, modelId, step }),
    })
  },
})

const OUT_OF_CREDITS_REPLY =
  "You're out of credits, so I can't keep building for now. Add credits on the Billing page, then send your message again."

/**
 * A reply written by the app instead of the model.
 *
 * Shaped like what `streamText` returns as far as `chat.agent` is concerned,
 * which is `toUIMessageStream` and nothing else, so the runtime pipes it and
 * saves it to the thread exactly as it would a model's answer: the player sees
 * it in the chat, and it is still there after a reload.
 */
function fixedReply(text: string) {
  return {
    toUIMessageStream: (options: UIMessageStreamOptions<UIMessage> = {}) =>
      createUIMessageStream({
        originalMessages: options.originalMessages,
        generateId: options.generateMessageId,
        onEnd: options.onEnd ?? options.onFinish,
        execute: ({ writer }) => {
          writer.write({ type: "start" })
          writer.write({ type: "text-start", id: "reply" })
          writer.write({ type: "text-delta", id: "reply", delta: text })
          writer.write({ type: "text-end", id: "reply" })
          writer.write({ type: "finish", finishReason: "stop" })
        },
      }),
  }
}

/**
 * Charges one step to the game's org and tells the browser the new balance.
 *
 * A failure is logged rather than thrown: the step has already run and its
 * edits are in the sandbox, so failing the turn over the bill would only lose
 * the player's build without un-spending anything.
 */
async function billStep({
  gameId,
  orgId,
  modelId,
  step,
}: {
  gameId: string
  orgId: string | undefined
  modelId: GameModelId
  step: StepResult<ToolSet>
}) {
  const attributes = {
    "game.id": gameId,
    "gen_ai.request.model": modelId,
    "gen_ai.response.id": step.response.id,
  }

  if (!orgId) {
    logger.warn(
      logger.fmt`Game ${gameId} has no org to charge a step to`,
      attributes
    )
    return
  }

  const startedAt = performance.now()
  try {
    const amount = stepCost(modelId, step.usage)
    await chargeStep({ orgId, responseId: step.response.id, amount })
    const balance = await getBalance(orgId)

    // Transient: the sidebar wants the latest number, and the thread has no
    // use for a trail of old balances in its history.
    chat.response.write({
      type: "data-balance",
      data: { balance },
      transient: true,
    })

    logger.info(logger.fmt`Charged a step for game ${gameId}`, {
      ...attributes,
      "billing.amount": amount,
      "billing.balance": balance,
      duration_ms: elapsed(startedAt),
    })
  } catch (error) {
    logger.error(logger.fmt`Could not charge a step for game ${gameId}`, {
      ...attributes,
      ...describeError(error),
    })
  }
}
