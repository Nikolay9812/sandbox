"use client"

import { createContext, useContext, useState } from "react"

type CreditBalance = {
  /** Available credits in ledger units, or null without an active org. */
  balance: number | null
  setBalance: (balance: number) => void
}

const CreditBalanceContext = createContext<CreditBalance | null>(null)

/**
 * The org's balance, shared between whatever shows it and whatever learns it
 * changed.
 *
 * The layout reads it from the ledger once per render, but a game being built
 * spends it far more often than that: the chat agent streams the new balance
 * after every step it charges, and the thread hands it in here so the sidebar
 * follows along without a round-trip.
 */
export function CreditBalanceProvider({
  initialBalance,
  children,
}: {
  initialBalance: number | null
  children: React.ReactNode
}) {
  const [balance, setBalance] = useState(initialBalance)

  // A fresh server render — a refresh, or switching org — is newer than
  // anything streamed before it, so it replaces the local value.
  const [renderedBalance, setRenderedBalance] = useState(initialBalance)
  if (initialBalance !== renderedBalance) {
    setRenderedBalance(initialBalance)
    setBalance(initialBalance)
  }

  return (
    <CreditBalanceContext value={{ balance, setBalance }}>
      {children}
    </CreditBalanceContext>
  )
}

export function useCreditBalance(): CreditBalance {
  const context = useContext(CreditBalanceContext)
  if (!context) {
    throw new Error(
      "useCreditBalance must be used within CreditBalanceProvider"
    )
  }
  return context
}
