"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { games } from "@/lib/db/schema"

export async function createGame(formData: FormData) {
  const { orgId } = await auth.protect()

  if (!orgId) {
    throw new Error("An active organization is required to create a game")
  }

  const title = String(formData.get("prompt") ?? "").trim()

  if (!title) {
    return
  }

  await db.insert(games).values({ orgId, title })

  // Refresh the root layout so the sidebar picks up the new game.
  revalidatePath("/", "layout")
}
