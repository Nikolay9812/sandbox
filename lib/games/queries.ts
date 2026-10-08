import "server-only"

import { auth } from "@clerk/nextjs/server"
import { and, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { games } from "@/lib/db/schema"

export async function listGames() {
  const { orgId } = await auth()

  if (!orgId) {
    return []
  }

  return db
    .select({ id: games.id, title: games.title })
    .from(games)
    .where(eq(games.orgId, orgId))
    .orderBy(desc(games.createdAt))
}

export type GameListItem = Awaited<ReturnType<typeof listGames>>[number]

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getGame(id: string) {
  const { orgId } = await auth()

  // Non-UUID ids would make Postgres throw on the uuid cast
  if (!orgId || !UUID_RE.test(id)) {
    return null
  }

  const [game] = await db
    .select({
      id: games.id,
      title: games.title,
      messages: games.messages,
      lastEventId: games.lastEventId,
    })
    .from(games)
    .where(and(eq(games.id, id), eq(games.orgId, orgId)))
    .limit(1)

  return game ?? null
}

export type Game = NonNullable<Awaited<ReturnType<typeof getGame>>>
