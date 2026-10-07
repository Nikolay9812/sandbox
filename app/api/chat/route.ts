import { anthropic } from "@ai-sdk/anthropic"
import { auth } from "@clerk/nextjs/server"
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai"

import { getGame, saveGameMessages } from "@/lib/games/queries"

export async function POST(req: Request) {
  const { userId } = await auth()

  if (!userId) {
    return new Response("Unauthorized", { status: 401 })
  }

  // The client sends only the new message; the thread lives on the game.
  const { id, message }: { id: string; message: UIMessage } = await req.json()

  const game = await getGame(id)

  if (!game) {
    return new Response("Not found", { status: 404 })
  }

  const messages = await validateUIMessages({
    messages: [...game.messages, message],
  })

  const result = streamText({
    model: anthropic("claude-sonnet-5-5"),
    messages: await convertToModelMessages(messages),
  })

  // Run to completion even if the client disconnects, so the turn is saved.
  result.consumeStream()

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages }) => {
        await saveGameMessages(game.id, messages)
      },
    }),
  })
}
