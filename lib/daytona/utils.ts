import type { Dirent } from "node:fs"
import { readdir } from "node:fs/promises"
import path from "node:path"

import {
  DaytonaGoneError,
  DaytonaNotFoundError,
  type Sandbox,
} from "@daytona/sdk"
// `@sentry/node` rather than `@sentry/nextjs`: this module runs in both the
// Trigger.dev worker and the Next.js server, and both clients register on the
// same global carrier, so the logs land on whichever one is initialized.
import * as Sentry from "@sentry/node"
import { eq } from "drizzle-orm"

import { daytona } from "@/lib/daytona/client"
// Imported straight from `./client` rather than `@/lib/db`, like the chat
// store: this module runs inside the Trigger.dev worker, where the
// `server-only` marker on the `@/lib/db` entry would throw.
import { db, games } from "@/lib/db/client"

// Where the game's source lives inside the sandbox. `/home/daytona` is the
// sandbox user's home, so this is the path a dev server would be pointed at.
// Exported because the agent is told this path in `@/lib/games/instructions` —
// the prompt and the server have to be pointed at the same directory.
export const GAME_DIR = "/home/daytona/game"

// The files every new sandbox is seeded with, copied into `GAME_DIR` as-is.
// Nothing imports them, so `trigger.config.ts` ships the folder to the worker
// explicitly, and resolving from `process.cwd()` finds it both there and in
// local dev, where the cwd is the project root.
const RUNTIME_DIR = path.join(process.cwd(), "lib/games/runtime")

// A stopped sandbox still holds its disk against the org's quota until it is
// archived, and Daytona's default wait for that is 7 days — long enough for a
// handful of idle games to fill the quota and fail every new sandbox with
// "Total disk limit exceeded". `ensureStarted` restores an archived one.
const AUTO_ARCHIVE_MINUTES = 60

/**
 * Creates the Daytona sandbox a game is built in and records it on the game.
 *
 * The sandbox is seeded with everything in `lib/games/runtime` — at least a
 * placeholder `index.html`, so the game has something servable from its very
 * first moment, before the agent has written any code.
 *
 * The sandbox id is saved last: a row with a `sandboxId` therefore always names
 * a sandbox that exists and is seeded, and a crash in between leaks an unused
 * sandbox rather than pointing the game at a half-built one. A leaked sandbox
 * still carries the `gameId` label, so deleting the game sweeps it up anyway.
 *
 * A game deleted while its sandbox is being built has no row left to save the
 * id to, and the sweep that follows the delete may already have run, so the
 * sandbox is deleted here rather than left for it.
 */
export async function createGameSandbox(
  gameId: string
): Promise<{ sandbox: Sandbox }> {
  const startedAt = performance.now()
  const sandbox = await daytona.create({
    labels: { gameId },
    autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
  })

  const seededFiles = await seedRuntime(sandbox)

  const [game] = await db
    .update(games)
    .set({ sandboxId: sandbox.id })
    .where(eq(games.id, gameId))
    .returning({ id: games.id })

  if (!game) {
    await deleteSandbox(sandbox)

    throw new Error(
      `Game ${gameId} was deleted while its sandbox was being created`
    )
  }

  Sentry.logger.info("Game sandbox created", {
    "game.id": gameId,
    "game.sandbox.id": sandbox.id,
    "game.sandbox.seeded_files": seededFiles,
    duration_ms: Math.round(performance.now() - startedAt),
  })

  return { sandbox }
}

/**
 * Deletes every sandbox belonging to a game, and returns how many there were.
 *
 * Found by the `gameId` label rather than by the row's `sandboxId`, so it also
 * catches sandboxes the row never learned about, such as one from a create
 * that crashed before saving its id. Sandboxes already on their way out are
 * skipped, so a retried sweep doesn't trip over its own earlier deletes.
 */
export async function deleteGameSandboxes(gameId: string): Promise<number> {
  const sandboxes: Sandbox[] = []

  for await (const sandbox of daytona.list({ labels: { gameId } })) {
    if (sandbox.state !== "destroyed" && sandbox.state !== "destroying") {
      sandboxes.push(sandbox)
    }
  }

  await Promise.all(sandboxes.map(deleteSandbox))

  return sandboxes.length
}

/**
 * Deletes a sandbox, treating one that is already gone as deleted — the sweep
 * and the guard in `createGameSandbox` can both reach the same sandbox.
 */
async function deleteSandbox(sandbox: Sandbox): Promise<void> {
  try {
    await sandbox.delete()
  } catch (error) {
    if (
      error instanceof DaytonaNotFoundError ||
      error instanceof DaytonaGoneError
    ) {
      return
    }

    throw error
  }
}

/**
 * Mirrors `lib/games/runtime` into the sandbox's `GAME_DIR`, folders included.
 *
 * Folders are created first, parents before children — sorting puts every
 * path after its parent, its prefix — so empty ones survive too and no upload
 * relies on its destination's parent already existing. Files then go up in a
 * single batch rather than a request each.
 */
async function seedRuntime(sandbox: Sandbox): Promise<number> {
  const entries = await readdir(RUNTIME_DIR, {
    recursive: true,
    withFileTypes: true,
  })

  // `readdir` hands back native paths; the sandbox wants posix ones, which on
  // Windows (local dev) means swapping the separators.
  const toSandboxPath = (entry: Dirent) =>
    path.posix.join(
      GAME_DIR,
      ...path
        .relative(RUNTIME_DIR, path.join(entry.parentPath, entry.name))
        .split(path.sep)
    )

  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map(toSandboxPath)
    .sort()

  for (const folder of [GAME_DIR, ...folders]) {
    await sandbox.fs.createFolder(folder, "755")
  }

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      source: path.join(entry.parentPath, entry.name),
      destination: toSandboxPath(entry),
    }))

  await sandbox.fs.uploadFiles(files)

  return files.length
}

/**
 * The game's sandbox, created if it has none and started if it was stopped.
 *
 * Every tool the agent calls needs a running sandbox and none of them should
 * have to care why one might be missing, so this is the single entry point:
 * a tool asks for the game's sandbox and either gets a usable one or an error.
 *
 * `onChatStart` already creates the sandbox before the first turn streams, so
 * the create path here is a fallback — it covers games that predate sandboxes
 * and a first turn whose creation crashed. Sandboxes also stop themselves once
 * idle, which is the common case for a thread resumed after a while.
 */
export async function getGameSandbox(
  gameId: string
): Promise<{ sandbox: Sandbox }> {
  const [game] = await db
    .select({ sandboxId: games.sandboxId })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1)

  if (!game) {
    throw new Error(`No game ${gameId} to get a sandbox for`)
  }

  if (!game.sandboxId) {
    // The fallback path. For a game created after sandboxes existed, it firing
    // means the create in `onChatStart` failed.
    Sentry.logger.warn("Game has no sandbox, creating one on demand", {
      "game.id": gameId,
    })

    return createGameSandbox(gameId)
  }

  const sandbox = await daytona.get(game.sandboxId)

  await ensureStarted(sandbox)

  return { sandbox }
}

// The port the game's static server listens on inside the sandbox. Nothing
// else in the sandbox uses it; it just has to be a value the server and the
// preview link agree on — hence exported, for whoever mints that link.
export const PREVIEW_PORT = 3000

// Daytona signs preview urls for 60 seconds by default, which would expire
// under a preview left open in a tab. An hour is their recommendation.
export const PREVIEW_URL_TTL_SECONDS = 3600

// Where the server's own output goes, so a failed start has something to
// report beyond "it isn't answering".
const SERVER_LOG = "/tmp/game-server.log"

// Roughly ten seconds of grace, spent inside the sandbox rather than in
// round-trips from here.
const START_RETRIES = 10

/**
 * Starts (or reuses) the static server for a game's sandbox, and hands back the
 * running sandbox for the caller to mint a preview url from.
 *
 * Idempotent by design — this runs on every preview load. A health check comes
 * first, and only a port with nothing on it gets a new server: a second
 * `http.server` on the same port would exit on "address already in use" and
 * take the log with it, so spawning blindly would be both wasteful and
 * misleading.
 */
export async function startGameServer(
  sandboxId: string
): Promise<{ sandbox: Sandbox }> {
  const sandbox = await daytona.get(sandboxId)

  // Sandboxes stop themselves once idle, and a stopped one serves nothing.
  await ensureStarted(sandbox)

  if (!(await serverResponds(sandbox))) {
    const startedAt = performance.now()

    // `nohup … &` hands the server off to init and closes the pipes the exec
    // is waiting on, so this returns instead of blocking for the server's
    // lifetime. The log is where to look when a preview comes back empty.
    await sandbox.process.executeCommand(
      `nohup python3 -m http.server ${PREVIEW_PORT} --directory ${GAME_DIR} > ${SERVER_LOG} 2>&1 &`
    )

    // Binding the port takes a moment longer than spawning does, and a url
    // handed back before then loads as a connection error in the iframe.
    if (!(await serverResponds(sandbox, START_RETRIES))) {
      const log = await sandbox.process.executeCommand(`cat ${SERVER_LOG}`)

      throw new Error(
        `Game server failed to start in sandbox ${sandboxId}: ${log.result.trim() || "no output"}`
      )
    }

    Sentry.logger.info("Game server started", {
      "game.sandbox.id": sandboxId,
      duration_ms: Math.round(performance.now() - startedAt),
    })
  }

  return { sandbox }
}

/**
 * Starts a sandbox that has stopped itself, and leaves a running one alone.
 *
 * A start is the slow half of a cold preview or a resumed thread, so it is
 * logged with how long it took and the state it was woken from.
 */
async function ensureStarted(sandbox: Sandbox): Promise<void> {
  if (sandbox.state === "started") {
    return
  }

  const previousState = String(sandbox.state)
  const startedAt = performance.now()

  await sandbox.start()

  Sentry.logger.info("Game sandbox started", {
    "game.sandbox.id": sandbox.id,
    "game.sandbox.previous_state": previousState,
    duration_ms: Math.round(performance.now() - startedAt),
  })
}

/**
 * Whether something is already answering HTTP on the preview port.
 *
 * `retries` is curl's own retry loop, which keeps the waiting on the sandbox
 * side — one exec that returns when the server is up, rather than a poll that
 * pays a round-trip per attempt. `--retry-connrefused` is what makes it treat
 * a port nothing has bound yet as worth retrying.
 */
async function serverResponds(sandbox: Sandbox, retries = 0): Promise<boolean> {
  const { exitCode } = await sandbox.process.executeCommand(
    `curl -fsS -o /dev/null --max-time 2 --retry ${retries} --retry-connrefused --retry-delay 1 http://localhost:${PREVIEW_PORT}/`
  )

  return exitCode === 0
}