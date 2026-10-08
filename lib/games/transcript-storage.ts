import {
  reduceTranscriptChanges,
  type LoadContextEvent,
  type TranscriptLoadOptions,
  type TranscriptScope,
  type TranscriptStorage,
} from "@trigger.dev/sdk/ai"
import type { UIMessage } from "ai"
import { eq } from "drizzle-orm"

import { db } from "@/lib/db/client"
import { games } from "@/lib/db/schema"

// Runs inside the Trigger.dev worker, outside any request, so there is no
// Clerk session to scope by. The chat id is the game id, and the server
// actions only start a session or mint a token for it after checking the
// caller's organization owns the game.

async function readThread(gameId: string) {
  const [game] = await db
    .select({ messages: games.messages })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  return game?.messages ?? []
}

/**
 * Keeps a game's chat thread in `games.messages`, which stays the source of
 * truth for history: the game page renders from it, and `createGame` writes
 * the opening prompt there before any chat session exists.
 */
export const gameTranscriptStorage: TranscriptStorage = {
  async load<TUIMessage extends UIMessage>(
    { chatId }: TranscriptScope,
    opts?: TranscriptLoadOptions
  ) {
    const [game] = await db
      .select({
        messages: games.messages,
        transcriptState: games.transcriptState,
        lastEventId: games.lastEventId,
        lastInEventId: games.lastInEventId,
      })
      .from(games)
      .where(eq(games.id, chatId))
      .limit(1)

    if (!game) {
      return { messages: [], state: null }
    }

    let messages = game.messages

    if (opts?.before) {
      const index = messages.findIndex((message) => message.id === opts.before)
      messages = index === -1 ? [] : messages.slice(0, index)
    }

    let nextCursor: string | undefined

    if (opts?.limit && messages.length > opts.limit) {
      messages = messages.slice(-opts.limit)
      nextCursor = messages[0].id
    }

    return {
      messages: messages as TUIMessage[],
      state: game.transcriptState ?? null,
      cursors: {
        lastOutEventId: game.lastEventId ?? undefined,
        lastInEventId: game.lastInEventId ?? undefined,
      },
      nextCursor,
    }
  },

  // Applies the runtime's changes to the stored thread and writes the resume
  // cursors in the same statement, so a reload can never resume from a cursor
  // that is ahead of (or behind) the messages it rendered.
  async save({ chatId }, { changes, cursors }) {
    await db.transaction(async (tx) => {
      const [game] = await tx
        .select({
          messages: games.messages,
          transcriptState: games.transcriptState,
        })
        .from(games)
        .where(eq(games.id, chatId))
        .for("update")

      if (!game) {
        throw new Error(`Game ${chatId} not found`)
      }

      const next = reduceTranscriptChanges(
        {
          entries: game.messages.map((message) => ({
            id: message.id,
            final: true,
            message,
          })),
          state: game.transcriptState ?? null,
        },
        changes
      )

      await tx
        .update(games)
        .set({
          messages: next.entries.map((entry) => entry.message),
          transcriptState: next.state,
          // A turn-start save has no cursor for its answer yet. Only ever
          // move the cursors forward; clearing them would replay the stream.
          ...(cursors?.lastOutEventId && {
            lastEventId: cursors.lastOutEventId,
          }),
          ...(cursors?.lastInEventId && {
            lastInEventId: cursors.lastInEventId,
          }),
        })
        .where(eq(games.id, chatId))
    })
  },

  // The model's context comes from the stored thread, not from the browser:
  // the transport only ships the new message, and a regenerate ships none, so
  // a new game's opening prompt would otherwise never reach the model.
  async loadContext<TUIMessage extends UIMessage>(
    { chatId }: TranscriptScope,
    {
      trigger,
      incomingMessages,
      previousMessages,
    }: LoadContextEvent<unknown, TUIMessage>
  ) {
    // Once a run holds the conversation it mirrors the stored thread (it was
    // read from here and every change is saved back), and using it avoids
    // racing the previous turn's save. A run's first turn holds nothing yet.
    const thread: UIMessage[] =
      previousMessages.length > 0
        ? [...previousMessages]
        : await readThread(chatId)

    if (trigger === "regenerate-message") {
      // Drop the reply being regenerated: everything after the last user turn.
      let lastUser = thread.length - 1
      while (lastUser >= 0 && thread[lastUser].role !== "user") {
        lastUser--
      }
      thread.splice(lastUser + 1)
    }

    for (const message of incomingMessages) {
      const index = thread.findIndex((existing) => existing.id === message.id)

      if (index === -1) {
        thread.push(message)
      } else {
        thread[index] = message
      }
    }

    return thread as TUIMessage[]
  },
}
