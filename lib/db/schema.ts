import type { UIMessage } from "ai"
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const games = pgTable("games", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: text().notNull(), // Clerk organization ID
  title: text().notNull(),
  messages: jsonb().$type<UIMessage[]>().notNull().default([]), // Chat thread
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})
