"use server"

import { auth as clerkAuth } from "@clerk/nextjs/server"
import { auth } from "@trigger.dev/sdk"
import { chat, type ChatStartSessionParams } from "@trigger.dev/sdk/ai"

import { getGame } from "@/lib/games/queries"
import type { gameChat } from "@/trigger/chat"

const startSession = chat.createStartSessionAction<typeof gameChat>("game-chat")

/**
 * Both actions take a chat id straight from the browser, so each one checks
 * the caller may use it. `getGame` is also the authorization check — it only
 * resolves games belonging to the caller's active organization.
 */
async function requireGame(chatId: string) {
  const { userId, orgId } = await clerkAuth()

  if (!userId || !orgId) {
    throw new Error("Unauthorized")
  }

  if (!(await getGame(chatId))) {
    throw new Error("Not Found")
  }
}

// Creates the chat session and its first run, and returns a session-scoped
// token. Idempotent on the chat id.
export async function startGameChatSession(
  params: ChatStartSessionParams<typeof gameChat>
) {
  await requireGame(params.chatId)

  return startSession(params)
}

// The transport calls this to refresh an expired session token.
export async function mintGameChatAccessToken(chatId: string) {
  await requireGame(chatId)

  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  })
}
