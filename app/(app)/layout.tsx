import { auth } from "@clerk/nextjs/server"

import { AppSidebar } from "@/components/app-sidebar"
import { CreditBalanceProvider } from "@/components/credit-balance"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getBalance } from "@/lib/billing/ledger"
import { listGames } from "@/lib/games/queries"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { orgId } = await auth()
  const [games, balance] = await Promise.all([
    listGames(),
    orgId ? getBalance(orgId) : null,
  ])

  return (
    <CreditBalanceProvider initialBalance={balance}>
      <SidebarProvider>
        <AppSidebar games={games} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </CreditBalanceProvider>
  )
}
