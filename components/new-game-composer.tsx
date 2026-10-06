"use client"

import { useState, useTransition } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { createGame } from "@/lib/games/action"

export function NewGameComposer() {
  const [value, setValue] = useState("")
  const [isPending, startTransition] = useTransition()

  return (
    <ChatComposer
      value={value}
      onValueChange={setValue}
      disabled={isPending}
      onSubmit={(prompt) => {
        startTransition(async () => {
          await createGame(prompt)
          setValue("")
        })
      }}
    />
  )
}
