import "server-only"

import { isClerkAPIResponseError } from "@clerk/nextjs/errors"
import { clerkClient } from "@clerk/nextjs/server"

import { creditLedger, db, type NewCreditLedgerEntry } from "@/lib/db"
import { DOLLAR } from "@/lib/billing/ledger"

const MONTHLY_GRANT = 10 * DOLLAR

// Statuses whose current period has been paid for. `past_due` is a period
// that started but whose payment failed, so it waits until it is paid.
const PAID_STATUSES = new Set(["active", "canceled"])

/**
 * Grants the org $10 for every month of its subscription it has paid for.
 *
 * Each month is keyed by its subscription item and start date, so running
 * this again — or concurrently — grants nothing new for a month already
 * granted. Only the current billing period is visible to us, so a month is
 * granted only if this runs while that month's period is current.
 */
export async function reconcileCredits(orgId: string): Promise<void> {
  let subscription
  try {
    subscription = await (
      await clerkClient()
    ).billing.getOrganizationBillingSubscription(orgId)
  } catch (error) {
    // An org that has never had a subscription has nothing to grant.
    if (isClerkAPIResponseError(error) && error.status === 404) {
      return
    }
    throw error
  }

  const now = Date.now()
  const rows: NewCreditLedgerEntry[] = subscription.subscriptionItems
    .filter(
      (item) =>
        PAID_STATUSES.has(item.status) &&
        item.plan?.hasBaseFee &&
        !item.isFreeTrial
    )
    .flatMap((item) =>
      paidMonthStarts(item, now).map((start) => ({
        orgId,
        entryKey: `month:${item.id}:${new Date(start).toISOString()}`,
        amount: MONTHLY_GRANT,
      }))
    )

  if (rows.length === 0) {
    return
  }

  await db
    .insert(creditLedger)
    .values(rows)
    .onConflictDoNothing({
      target: [creditLedger.orgId, creditLedger.entryKey],
    })
}

/**
 * Start times of the months in the item's current period that have begun.
 * A monthly plan's period is one month; an annual one's is twelve, granted
 * as each month arrives.
 */
function paidMonthStarts(
  item: { periodStart: number; periodEnd: number | null },
  now: number
) {
  const starts: number[] = []
  for (let month = 0; ; month++) {
    const start = new Date(item.periodStart)
    start.setUTCMonth(start.getUTCMonth() + month)
    if (
      start.getTime() > now ||
      (item.periodEnd !== null && start.getTime() >= item.periodEnd)
    ) {
      return starts
    }
    starts.push(start.getTime())
  }
}
