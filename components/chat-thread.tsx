"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useChat } from "@ai-sdk/react"
import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat"
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"

import { ChatComposer } from "@/components/chat-composer"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message"
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import {
  mintGameChatAccessToken,
  startGameChatSession,
} from "@/lib/games/chat-actions"
import type { gameChat } from "@/trigger/chat"

export function ChatThread({
  gameId,
  initialMessages,
  initialSessions,
}: {
  gameId: string
  initialMessages: UIMessage[]
  initialSessions?: Record<string, ChatSessionPersistedState>
}) {
  const [value, setValue] = useState("")
  // Talks to the `game-chat` agent directly. Only the new message goes on the
  // wire; the agent reads the rest of the thread from the game.
  const transport = useTriggerChatTransport<typeof gameChat>({
    task: "game-chat",
    accessToken: ({ chatId }) => mintGameChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startGameChatSession({ chatId, clientData }),
    sessions: initialSessions,
  })
  const { messages, sendMessage, regenerate, status } = useChat({
    id: gameId,
    messages: initialMessages,
    transport,
    // Reconnect to a reply that was still streaming when the page loaded.
    resume: initialSessions !== undefined,
  })

  // A new game arrives holding only the prompt it was created from, so ask for
  // the reply here. The ref keeps Strict Mode's double mount from asking twice.
  const requestedReply = useRef(false)

  useEffect(() => {
    if (requestedReply.current) {
      return
    }

    requestedReply.current = true

    if (initialMessages.at(-1)?.role === "user") {
      regenerate()
    }
  }, [initialMessages, regenerate])

  function handleSubmit(text: string) {
    sendMessage({ text })
    setValue("")
  }

  return (
    <div className="flex h-svh flex-col">
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl px-4 py-8">
              {messages.map((message) => (
                <MessageScrollerItem key={message.id} messageId={message.id}>
                  <Message align={message.role === "user" ? "end" : "start"}>
                    {message.role === "assistant" && (
                      <MessageAvatar className="size-8 self-start rounded-lg bg-transparent">
                        <Image
                          src="/logo.svg"
                          alt="Sandbox"
                          width={32}
                          height={32}
                          className="size-8"
                        />
                      </MessageAvatar>
                    )}
                    <MessageContent>
                      <Bubble
                        variant={
                          message.role === "user" ? "secondary" : "ghost"
                        }
                        align={message.role === "user" ? "end" : "start"}
                      >
                        <BubbleContent>
                          {message.parts.map((part, index) =>
                            part.type === "text" ? (
                              <span key={index}>{part.text}</span>
                            ) : null
                          )}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
        <ChatComposer
          value={value}
          onValueChange={setValue}
          onSubmit={handleSubmit}
          disabled={status === "submitted" || status === "streaming"}
        />
      </div>
    </div>
  )
}
