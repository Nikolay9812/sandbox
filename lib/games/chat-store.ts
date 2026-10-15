import * as Sentry from "@sentry/node"
import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"

// Imported straight from `./client` rather than `@/lib/db`: this module runs
// inside the Trigger.dev worker, where the `server-only` marker on the `@/lib/db`
// entry would throw.
import { db, games } from "@/lib/db/client"

// Lookups here are by id alone, with no org scoping, unlike `getGame`. The
// caller is the chat agent, which has no Clerk session to scope by — a game id
// only ever reaches it through a session the server actions in
// `@/lib/games/chat-actions` already authorized against the caller's org.

/**
 * The game's thread as the row holds it, which is the history every turn is
 * rebuilt from.
 *
 * Empty when the game was deleted under a live session: only an authorized
 * session can name a chat, so a missing row means the game went away after.
 */
export async function loadGameMessages(gameId: string): Promise<UIMessage[]> {
  const [game] = await db
    .select({ messages: games.messages })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  if (!game) {
    Sentry.logger.warn("Game thread not found, starting empty", {
      "game.id": gameId,
    })

    return []
  }

  return game.messages
}

/**
 * Writes the thread down without touching the session, for a turn that has
 * started but not finished — its cursor isn't known yet.
 */
export async function saveGameMessages({
  gameId,
  messages,
}: {
  gameId: string
  messages: UIMessage[]
}): Promise<void> {
  await db.update(games).set({ messages }).where(eq(games.id, gameId))
}

/**
 * Writes a finished turn: the thread, and the session a reloading browser
 * resumes it with.
 *
 * One statement, so the thread and its cursor can't diverge: a reload landing
 * between separate writes would resume from a cursor that points past messages
 * the row doesn't have yet, and replay the turn on top of itself. The token is
 * written every turn because a continuation run mints a fresh one.
 */
export async function saveGameTurn({
  gameId,
  messages,
  chatAccessToken,
  chatLastEventId,
}: {
  gameId: string
  messages: UIMessage[]
  chatAccessToken: string
  /** Left as it is when the turn ended without one. */
  chatLastEventId: string | undefined
}): Promise<void> {
  await db
    .update(games)
    .set({ messages, chatAccessToken, chatLastEventId })
    .where(eq(games.id, gameId))
}

/**
 * The org that owns a game, which is the org its turns are charged to.
 *
 * `undefined` when the game was deleted under a live session.
 */
export async function loadGameOrgId(
  gameId: string
): Promise<string | undefined> {
  const [game] = await db
    .select({ orgId: games.orgId })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  return game?.orgId
}
