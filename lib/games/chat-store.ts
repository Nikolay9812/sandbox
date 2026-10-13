import * as Sentry from "@sentry/node"
import type { TranscriptStorage } from "@trigger.dev/sdk/ai"
import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"

// Imported straight from `./client` rather than `@/lib/db`: this module runs
// inside the Trigger.dev worker, where the `server-only` marker on the `@/lib/db`
// entry would throw.
import { db, games } from "@/lib/db/client"

/**
 * Where the game chat agent keeps its transcript: the game's own row.
 *
 * The thread is kept whole in `games.messages`, so `save` writes the
 * changeset's full `transcript` rather than applying its individual changes.
 *
 * Lookups here are by id alone, with no org scoping, unlike `getGame`. The
 * caller is the chat agent, which has no Clerk session to scope by — a game id
 * only ever reaches it through a session the server actions in
 * `@/lib/games/chat-actions` already authorized against the caller's org.
 */
export const gameTranscriptStorage: TranscriptStorage = {
  async load<TUIMessage extends UIMessage = UIMessage>(
    { chatId }: { chatId: string },
    opts?: { limit?: number; before?: string }
  ) {
    const [game] = await db
      .select({
        messages: games.messages,
        state: games.chatState,
        lastOutEventId: games.chatLastEventId,
        lastInEventId: games.chatLastInEventId,
        nonFinalIds: games.chatNonFinalIds,
      })
      .from(games)
      .where(eq(games.id, chatId))
      .limit(1)

    // Only an authorized session can name a chat, so a missing row means the
    // game was deleted under a live session — and the agent starts it blank.
    if (!game) {
      Sentry.logger.warn("Game transcript not found, starting empty", {
        "game.id": chatId,
      })

      return { messages: [], state: null }
    }

    const cursors = {
      lastOutEventId: game.lastOutEventId ?? undefined,
      lastInEventId: game.lastInEventId ?? undefined,
    }

    // The runtime always asks for the whole thread; `limit` and `before` are
    // only used by paged history reads.
    let messages = game.messages
    let nextCursor: string | undefined
    if (opts?.before) {
      const end = messages.findIndex((message) => message.id === opts.before)
      messages = end === -1 ? [] : messages.slice(0, end)
    }
    if (opts?.limit && messages.length > opts.limit) {
      messages = messages.slice(-opts.limit)
      nextCursor = messages[0]?.id
    }

    return {
      messages: messages as TUIMessage[],
      state: game.state ?? null,
      cursors,
      nextCursor,
      nonFinalIds: game.nonFinalIds,
    }
  },

  // One statement, so the thread and its cursor can't diverge: a reload
  // landing between separate writes would resume from a cursor that points
  // past messages the row doesn't have yet, and replay the turn on top of
  // itself.
  async save({ chatId }, { transcript, cursors }) {
    await db
      .update(games)
      .set({
        messages: transcript.entries.map((entry) => entry.message),
        chatState: transcript.state,
        chatNonFinalIds: transcript.entries
          .filter((entry) => !entry.final)
          .map((entry) => entry.id),
        // Left out (and so left as they are) when the save carries no cursor.
        chatLastEventId: cursors?.lastOutEventId,
        chatLastInEventId: cursors?.lastInEventId,
      })
      .where(eq(games.id, chatId))
  },
}

/**
 * Records the session token a reloading browser resumes the chat with.
 *
 * A continuation run mints a fresh one, so it is refreshed on every turn.
 */
export async function saveGameChatToken({
  gameId,
  chatAccessToken,
}: {
  gameId: string
  chatAccessToken: string
}): Promise<void> {
  await db.update(games).set({ chatAccessToken }).where(eq(games.id, gameId))
}
