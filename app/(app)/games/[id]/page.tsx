import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { ChatThread } from "@/components/chat-thread"
import { mintGameChatAccessToken } from "@/lib/games/chat-actions"
import { getGame } from "@/lib/games/queries"

export default async function GamePage(props: PageProps<"/games/[id]">) {
  await auth.protect({ unauthorizedUrl: "/sign-in" })

  const { id } = await props.params
  const game = await getGame(id)

  if (!game) {
    notFound()
  }

  // A stored cursor means the chat session exists, so hand the transport the
  // session to resume an in-flight reply from instead of starting a new one.
  const initialSessions = game.lastEventId
    ? {
        [game.id]: {
          publicAccessToken: await mintGameChatAccessToken(game.id),
          lastEventId: game.lastEventId,
        },
      }
    : undefined

  // Keyed so switching games resets the thread instead of reusing its state
  return (
    <ChatThread
      key={game.id}
      gameId={game.id}
      initialMessages={game.messages}
      initialSessions={initialSessions}
    />
  )
}
