// No `server-only` guard here: the chat agent in the Trigger.dev worker charges
// for its steps through this module, and the worker's bundle doesn't resolve
// the `react-server` condition that makes that guard a no-op. For the same
// reason the database comes from `@/lib/db/client` rather than `@/lib/db`.
import { eq, sql } from "drizzle-orm"

import { DOLLAR } from "@/lib/billing/format"
import { reconcileCredits } from "@/lib/billing/reconcile"
import { creditLedger, db } from "@/lib/db/client"
import { describeError, logger } from "@/lib/observability"

// Every org starts with this much. It is not a row: the ledger only records
// what changed, so an org with no rows still has it.
const FREE_CREDIT = 1 * DOLLAR

/**
 * Why a turn was refused. Shown to the player verbatim, so it says what to do
 * rather than what went wrong.
 */
export const OUT_OF_CREDITS =
  "You're out of credits. Add more from the billing page to keep building."

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
 * The org's balance, synced with its subscription first if it is empty.
 *
 * The month may have renewed since anything last looked, so an empty balance
 * is not believed until the grants are caught up. A sync that fails leaves the
 * balance as it was: the org is told it is out of credits rather than handed a
 * build nobody knows it paid for.
 */
export async function getSyncedBalance(orgId: string): Promise<number> {
  const balance = await getBalance(orgId)

  if (balance > 0) {
    return balance
  }

  try {
    await reconcileCredits(orgId)

    return await getBalance(orgId)
  } catch (error) {
    logger.error(logger.fmt`Could not sync credits for org ${orgId}`, {
      "organization.id": orgId,
      ...describeError(error),
    })

    return balance
  }
}

/** Whether the org has anything left to start a build with. */
export async function hasCreditsToBuild(orgId: string): Promise<boolean> {
  return (await getSyncedBalance(orgId)) > 0
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
