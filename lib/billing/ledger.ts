// No `server-only` guard here: the chat agent in the Trigger.dev worker charges
// for its steps through this module, and the worker's bundle doesn't resolve
// the `react-server` condition that makes that guard a no-op. For the same
// reason the database comes from `@/lib/db/client` rather than `@/lib/db`.
import { eq, sql } from "drizzle-orm"

import { DOLLAR } from "@/lib/billing/format"
import { creditLedger, db } from "@/lib/db/client"

// Every org starts with this much. It is not a row: the ledger only records
// what changed, so an org with no rows still has it.
const FREE_CREDIT = 1 * DOLLAR

/** The org's available credit in ledger units. May be negative. */
export async function getBalance(orgId: string): Promise<number> {
  const [{ total }] = await db
    .select({
      // `sum(bigint)` is a numeric, which pg returns as a string.
      total: sql`coalesce(sum(${creditLedger.amount}), 0)`.mapWith(Number),
    })
    .from(creditLedger)
    .where(eq(creditLedger.orgId, orgId))

  return FREE_CREDIT + total
}

/**
 * Takes the cost of one model step off the org's balance.
 *
 * Keyed by the step's response id, so charging the same step again — a retry,
 * a replayed callback — is a no-op rather than a second charge.
 */
export async function chargeStep({
  orgId,
  responseId,
  amount,
}: {
  orgId: string
  responseId: string
  /** What the step cost, in ledger units, as a positive number. */
  amount: number
}): Promise<void> {
  await db
    .insert(creditLedger)
    .values({ orgId, entryKey: `step:${responseId}`, amount: -amount })
    .onConflictDoNothing({
      target: [creditLedger.orgId, creditLedger.entryKey],
    })
}
