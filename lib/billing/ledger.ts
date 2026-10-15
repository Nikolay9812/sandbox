import "server-only"

import { eq, sql } from "drizzle-orm"

import { creditLedger, db } from "@/lib/db"

/** One dollar in ledger units (billionths of a dollar). */
export const DOLLAR = 1_000_000_000

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
