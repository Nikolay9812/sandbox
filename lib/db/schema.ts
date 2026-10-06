import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const games = pgTable("games", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: text().notNull(), // Clerk organization ID
  title: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})
