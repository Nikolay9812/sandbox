"use server"

import { auth } from "@clerk/nextjs/server"
import * as Sentry from "@sentry/nextjs"
import { auth as triggerAuth } from "@trigger.dev/sdk"
import {
  chat,
  type ChatStartSessionParams,
  type ChatStartSessionResult,
} from "@trigger.dev/sdk/ai"

import { checkCredits } from "@/lib/billing/reconcile"
import { getGame } from "@/lib/games/queries"
import type { gameChat } from "@/trigger/chat"

const startSession = chat.createStartSessionAction<typeof gameChat>("game-chat")

/**
 * The check the chat route handler used to run per request. It moves here
 * because these two actions are the only paths that hand the browser a token
 * for a chat session — being signed in is not the same as being entitled to
 * this game's thread, and the id arrives from the browser.
 */
async function authorizeGame(gameId: string): Promise<{ orgId: string }> {
  const { userId, orgId } = await auth()

  // Denials are logged as well as thrown: the throw reads as one more failed
  // action, while the log says which check refused whom, for which game.
  if (!userId || !orgId) {
    Sentry.logger.warn("Game chat access denied", {
      "game.id": gameId,
      "game.chat.denial": "unauthenticated",
    })

    throw new Error("Unauthorized")
  }

  // Also the ownership check — `getGame` only resolves games belonging to the
  // caller's active organization.
  if (!(await getGame(gameId))) {
    Sentry.logger.warn("Game chat access denied", {
      "game.id": gameId,
      "game.chat.denial": "not_found",
      "user.id": userId,
      "org.id": orgId,
    })

    throw new Error("Not Found")
  }

  return { orgId }
}

/**
 * Creates the chat session and triggers its first run, then returns a
 * session-scoped token. Idempotent on (environment, chatId), so two tabs
 * converge on one session.
 *
 * An org out of credits gets `{ outOfCredits: true }` instead, and no run is
 * triggered. Returned rather than thrown, because Next replaces a server
 * action's error with a generic one in production, and the thread needs to
 * tell this apart from a real failure to show the player why nothing happened.
 */
export async function startGameChatSession(
  params: ChatStartSessionParams<typeof gameChat>
): Promise<ChatStartSessionResult | { outOfCredits: true }> {
  const { orgId } = await authorizeGame(params.chatId)

  const { hasCredits, balance } = await checkCredits(orgId)
  if (!hasCredits) {
    Sentry.logger.info("Game chat session refused, out of credits", {
      "game.id": params.chatId,
      "org.id": orgId,
      "billing.balance": balance,
    })

    return { outOfCredits: true }
  }

  const session = await startSession(params)

  Sentry.logger.info("Game chat session started", { "game.id": params.chatId })

  return session
}

/**
 * Pure mint — the transport calls this on a 401/403 to refresh an expired
 * token. Runs on the server, so `TRIGGER_SECRET_KEY` never reaches the browser.
 */
export async function mintGameChatAccessToken(chatId: string) {
  await authorizeGame(chatId)

  return triggerAuth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  })
}
