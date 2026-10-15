const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

/** A ledger amount (billionths of a dollar) as dollars, e.g. `$8.80`. */
export function formatDollars(amount: number): string {
  return dollars.format(amount / 1_000_000_000)
}
