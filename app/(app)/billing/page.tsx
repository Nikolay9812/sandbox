import { PricingTable } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Billing",
}

export default async function BillingPage() {
  await auth.protect({ unauthenticatedUrl: "/sign-in" })

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <h1 className="text-sm">Billing</h1>
      </header>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-4 py-10">
        <section className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Available credits</p>
          {/* Placeholder until credits are tracked. */}
          <p className="font-heading text-4xl font-semibold tabular-nums">
            $8.80
          </p>
          <p className="max-w-xl text-sm text-muted-foreground">
            Credits cover the models that build and revise your games. A scene
            already in progress can finish below zero; the next build waits for
            more credits.
          </p>
        </section>
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Keep the studio running</h2>
            <p className="text-sm text-muted-foreground">
              Builder adds $10.00 every month, and unused credits roll over.
            </p>
          </div>
          <PricingTable for="organization" />
        </section>
      </div>
    </div>
  )
}
