import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { GameChat } from "@/components/game-chat"
import { GameMenu } from "@/components/game-menu"
import { getSyncedBalance } from "@/lib/billing/ledger"
import { DEFAULT_GAME_MODEL_ID, isGameModelId } from "@/lib/games/model-catalog"
import { getGame } from "@/lib/games/queries"

export default async function GamePage({
  params,
  searchParams,
}: PageProps<"/games/[id]">) {
  const { orgId } = await auth.protect({ unauthenticatedUrl: "/sign-in" })

  const { id } = await params
  const game = await getGame(id)

  if (!game || !orgId) {
    notFound()
  }

  // Synced rather than read raw, so a subscription that renewed since the last
  // grant doesn't open the game on a closed composer.
  const credits = BigInt(await getSyncedBalance(orgId))

  // Where the home page's pick lands: `createGame` puts it here rather than on
  // the row, because it is only the thread's starting point — the picker in the
  // thread takes over from it, and the URL is not rewritten when it does. It is
  // also just a query string, so it is checked rather than believed.
  const { model } = await searchParams

  return (
    // The chat fills whatever height the header leaves, so the window height
    // is set here rather than in the chat.
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <h1 className="min-w-0 flex-1 truncate text-sm">{game.title}</h1>
        <GameMenu gameId={game.id} title={game.title} />
      </header>
      <GameChat
        gameId={game.id}
        credits={credits}
        initialMessages={game.messages}
        initialModelId={isGameModelId(model) ? model : DEFAULT_GAME_MODEL_ID}
        sandboxId={game.sandboxId}
        // The chat session the last turn persisted. Absent until a game has had
        // one, and the token may already have expired — the transport refreshes
        // it through the mint action on a 401.
        initialSession={
          game.chatAccessToken
            ? {
                publicAccessToken: game.chatAccessToken,
                lastEventId: game.chatLastEventId ?? undefined,
              }
            : undefined
        }
      />
    </div>
  )
}