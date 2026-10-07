"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type UIMessage } from "ai"

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

export function ChatThread({
  gameId,
  initialMessages,
}: {
  gameId: string
  initialMessages: UIMessage[]
}) {
  const [value, setValue] = useState("")
  // The default transport sends `{ id, messages }`, the full thread the chat
  // route expects.
  const { messages, sendMessage, regenerate, status } = useChat({
    id: gameId,
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat" }),
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
