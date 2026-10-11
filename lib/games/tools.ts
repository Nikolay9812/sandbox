import { posix } from "node:path"

import { DaytonaNotFoundError, type Sandbox } from "@daytona/sdk"
import { tool } from "ai"
import { z } from "zod"

import { GAME_DIR, getGameSandbox } from "@/lib/daytona/utils"

/**
 * The agent's file tools for one game, confined to that game's directory in
 * its Daytona sandbox.
 *
 * Built per game rather than shared, because the game id is what picks the
 * sandbox and nothing in a tool call carries it — the agent resolves this per
 * turn from the chat id, which is the game id.
 */
export function createGameTools(gameId: string) {
  // Every call in a turn shares one lookup: getting the sandbox is a database
  // read plus a Daytona round-trip, and possibly a start. A failed lookup is
  // forgotten so the next call retries instead of replaying the error.
  let sandbox: Promise<Sandbox> | undefined
  const getSandbox = () =>
    (sandbox ??= getGameSandbox(gameId).then(
      (result) => result.sandbox,
      (error: unknown) => {
        sandbox = undefined
        throw error
      }
    ))

  // The model can issue several calls in one step and they run concurrently.
  // Two edits to the same file are each a read-modify-write, so without this
  // the second would overwrite the first; queuing per path keeps both.
  const queues = new Map<string, Promise<unknown>>()
  const exclusive = <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const next = (queues.get(path) ?? Promise.resolve())
      .catch(() => {})
      .then(fn)
    queues.set(path, next)
    return next
  }

  return {
    write_file: tool({
      description:
        "Create a file in the game directory, or overwrite it entirely if it exists. Missing parent directories are created. Use for new files and full rewrites; use replace_text for targeted edits.",
      inputSchema: z.object({
        path: pathSchema,
        content: z.string().describe("The complete contents of the file."),
      }),
      execute: async ({ path, content }) => {
        const target = resolveGamePath(path)
        const data = Buffer.from(content)

        await exclusive(target, async () => {
          await (await getSandbox()).fs.uploadFile(data, target)
        })

        return `Wrote ${displayPath(target)} (${data.byteLength} bytes)`
      },
    }),

    replace_text: tool({
      description:
        "Replace an exact span of text in an existing file. old_text must match the file character for character, including whitespace and indentation, and must appear exactly once unless replace_all is set — include enough surrounding lines to make it unique.",
      inputSchema: z.object({
        path: pathSchema,
        old_text: z
          .string()
          .min(1)
          .describe("The exact text to replace, as it appears in the file."),
        new_text: z.string().describe("The text to put in its place."),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every occurrence instead of exactly one."),
      }),
      execute: async ({ path, old_text, new_text, replace_all }) => {
        const target = resolveGamePath(path)

        return exclusive(target, async () => {
          const fs = (await getSandbox()).fs
          const content = await readText(fs, target)

          // Split rather than `String.replace`, which would read `$&` and
          // friends in new_text as replacement patterns.
          const parts = content.split(old_text)
          const count = parts.length - 1

          if (count === 0) {
            throw new Error(
              `old_text was not found in ${displayPath(target)}. Read the file and copy the text exactly.`
            )
          }

          if (count > 1 && !replace_all) {
            throw new Error(
              `old_text appears ${count} times in ${displayPath(target)}. Include more surrounding text to make it unique, or set replace_all.`
            )
          }

          await fs.uploadFile(Buffer.from(parts.join(new_text)), target)

          return `Replaced ${count} occurrence${count === 1 ? "" : "s"} in ${displayPath(target)}`
        })
      },
    }),

    read_file: tool({
      description: "Read the full contents of a file in the game directory.",
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) =>
        readText((await getSandbox()).fs, resolveGamePath(path)),
    }),

    list_files: tool({
      description:
        "List the files and directories in the game directory, or in a directory inside it. Directories end in a slash; files show their size.",
      inputSchema: z.object({
        path: pathSchema
          .optional()
          .describe(
            "Directory to list, relative to the game directory. Defaults to the game directory itself."
          ),
        depth: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe(
            "How many levels deep to list. 1 lists only the directory's own entries. Defaults to 3."
          ),
      }),
      execute: async ({ path = ".", depth = 3 }) => {
        const target = resolveGamePath(path)

        try {
          const entries = await (
            await getSandbox()
          ).fs.listFiles(target, { depth })

          if (entries.length === 0) {
            return `${displayPath(target)} is empty`
          }

          return entries
            .map((entry) => {
              const relative = displayPath(
                entry.path ?? posix.join(target, entry.name)
              )
              return entry.isDir
                ? `${relative}/`
                : `${relative} (${entry.size} bytes)`
            })
            .sort()
            .join("\n")
        } catch (error) {
          throw notFound(error, `No directory at ${displayPath(target)}`)
        }
      },
    }),

    delete_file: tool({
      description:
        "Delete a file or directory in the game directory. A directory is deleted with everything in it.",
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        const target = resolveGamePath(path)

        if (target === GAME_DIR) {
          throw new Error("The game directory itself cannot be deleted.")
        }

        return exclusive(target, async () => {
          const fs = (await getSandbox()).fs

          try {
            const { isDir } = await fs.getFileDetails(target)
            await fs.deleteFile(target, isDir)

            return `Deleted ${displayPath(target)}${isDir ? "/" : ""}`
          } catch (error) {
            throw notFound(error, `Nothing to delete at ${displayPath(target)}`)
          }
        })
      },
    }),
  }
}

export type GameTools = ReturnType<typeof createGameTools>

const pathSchema = z
  .string()
  .min(1)
  .describe(
    'Path relative to the game directory, e.g. "index.html" or "js/game.js".'
  )

/**
 * Resolves a path the model gave to an absolute one inside the game directory,
 * and refuses anything that lands outside it.
 *
 * Paths are taken relative to the game directory, and an absolute path is
 * accepted only if it already points inside it. The check is lexical: the
 * agent has no way to create a symlink, so `..` is the only way out and
 * `resolve` has already folded it away by the time the prefix is compared.
 */
function resolveGamePath(path: string): string {
  const resolved = posix.resolve(GAME_DIR, path)

  if (resolved !== GAME_DIR && !resolved.startsWith(`${GAME_DIR}/`)) {
    throw new Error(
      `"${path}" is outside the game directory. Use a path relative to ${GAME_DIR}.`
    )
  }

  return resolved
}

/** The path as the model should see it: relative to the game directory. */
function displayPath(path: string): string {
  return posix.relative(GAME_DIR, path) || "."
}

async function readText(fs: Sandbox["fs"], path: string): Promise<string> {
  try {
    return (await fs.downloadFile(path)).toString("utf8")
  } catch (error) {
    throw notFound(error, `No file at ${displayPath(path)}`)
  }
}

/**
 * Swaps Daytona's not-found error for one the model can act on — the raw one
 * names the absolute sandbox path and the API call, neither of which helps.
 * Any other error passes through untouched.
 */
function notFound(error: unknown, message: string): unknown {
  return error instanceof DaytonaNotFoundError ? new Error(message) : error
}
