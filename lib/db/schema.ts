import type { UIMessage } from "ai"
import { sql } from "drizzle-orm"
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

export const games = pgTable(
  "games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Clerk organization id (`auth().orgId`), not a foreign key.
    orgId: text("org_id").notNull(),
    title: text("title").notNull(),
    // The game's chat thread, in the `useChat` UI message format. One game has
    // exactly one thread, so it is stored inline rather than in its own table.
    messages: jsonb("messages")
      .$type<UIMessage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Trigger.dev chat session cursors, written in the same statement as
    // `messages`. `lastEventId` is where a reloaded page resumes the response
    // stream; `lastInEventId` is where a continuation run resumes its input.
    // Both are opaque and live as long as the session, so never cleared.
    lastEventId: text("last_event_id"),
    lastInEventId: text("last_in_event_id"),
    // The chat runtime's opaque transcript state (compaction summary,
    // injected context). Stored and handed back as-is.
    transcriptState: jsonb("transcript_state"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Games are always read scoped to an org, usually newest first. The
    // leading org_id also serves plain `where org_id = ?` lookups.
    index("games_org_id_created_at_idx").on(
      table.orgId,
      table.createdAt.desc()
    ),
  ]
)

export type Game = typeof games.$inferSelect
export type NewGame = typeof games.$inferInsert
