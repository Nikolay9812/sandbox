import { ApiError, runs, sessions, task } from "@trigger.dev/sdk"
import { eq } from "drizzle-orm"

import { deleteGameSandboxes } from "@/lib/daytona/utils"
// Straight from `./client` rather than `@/lib/db`, for the same reason as the
// chat store: the `server-only` marker on the `@/lib/db` entry throws here.
import { db, games } from "@/lib/db/client"
import { elapsed, logger } from "@/lib/observability"

/**
 * Tears down everything a deleted game leaves outside the database: its chat
 * session, any turn still running in it, and every sandbox it was given.
 *
 * Triggered by `deleteGame` inside the transaction that deletes the row, so
 * the row may not be gone yet when this starts. Sweeping before it is would
 * miss a sandbox created in between and saved to the row, so a run that finds
 * the row throws and tries again; a row that never goes away (the delete was
 * rolled back) runs out the retries with nothing touched.
 *
 * Everything below is safe to repeat, so a retry after a partial attempt
 * just picks up where it stopped.
 */
export const deleteGameResources = task({
  id: "delete-game-resources",
  // Generous on purpose: giving up here is exactly the stray sandbox this task
  // exists to prevent, and each attempt is cheap.
  retry: {
    maxAttempts: 10,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 60_000,
    factor: 2,
    randomize: true,
  },
  run: async ({ gameId }: { gameId: string }) => {
    const startedAt = performance.now()

    const [game] = await db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1)

    if (game) {
      throw new Error(`Game ${gameId} still exists, not cleaning it up yet`)
    }

    // The chat first, so no turn is left running to make a sandbox after the
    // sweep. One that does anyway finds no row to save it to, and
    // `createGameSandbox` deletes it itself.
    await stopGameChat(gameId)

    const sandboxes = await deleteGameSandboxes(gameId)

    logger.info(logger.fmt`Cleaned up deleted game ${gameId}`, {
      "game.id": gameId,
      "game.sandboxes_deleted": sandboxes,
      duration_ms: elapsed(startedAt),
    })
  },
})

/**
 * Closes the game's chat session and cancels the run serving it, if any.
 *
 * Closing alone ends an idle agent on its next wake, but a turn mid-stream
 * would keep calling the model, billing steps and reaching for a sandbox
 * until it finished, so the current run is cancelled as well.
 */
async function stopGameChat(gameId: string): Promise<void> {
  // The chat id is the game id, and sessions are addressable by it.
  const session = await sessions
    .close(gameId, { reason: "game deleted" })
    .catch((error: unknown) => {
      // A game whose thread never started has no session to close.
      if (error instanceof ApiError && error.status === 404) {
        return null
      }

      throw error
    })

  if (!session?.currentRunId) {
    return
  }

  const run = await runs.retrieve(session.currentRunId)

  if (!run.isCompleted) {
    await runs.cancel(run.id)
  }
}
