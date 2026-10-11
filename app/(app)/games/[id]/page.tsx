import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { GameChat } from "@/components/game-chat"
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
  const initialSession = game.chatLastEventId
    ? {
        publicAccessToken: await mintGameChatAccessToken(game.id),
        lastEventId: game.chatLastEventId,
      }
    : undefined

  // Keyed so switching games resets the thread instead of reusing its state
  return (
    <GameChat
      key={game.id}
      gameId={game.id}
      initialMessages={game.messages}
      initialSession={initialSession}
    />
  )
}
