"use client"

import { useState, useTransition } from "react"

import { ChatComposer } from "@/components/chat-composer"
import { Button } from "@/components/ui/button"
import { createGame } from "@/lib/games/actions"
import {
  DEFAULT_GAME_MODEL_ID,
  type GameModelId,
} from "@/lib/games/model-catalog"
import { suggestions } from "@/lib/games/suggestions"

/**
 * Client boundary for the home page composer: a Server Component cannot hand
 * `ChatComposer` its `onValueChange`/`onSubmit` callbacks, so the prompt state
 * and the `createGame` call live here.
 *
 * `createGame` redirects to the new game, so the prompt is left in place — it
 * is only still on screen if the create failed. The same is true of the model:
 * the pick is state here and an argument to `createGame`, which carries it to
 * the thread — this component never sees the game it opens.
 */
export function NewGameComposer() {
  const [prompt, setPrompt] = useState("")
  const [modelId, setModelId] = useState<GameModelId>(DEFAULT_GAME_MODEL_ID)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(value: string) {
    startTransition(async () => {
      await createGame(value, modelId)
    })
  }

  // A suggestion fills the composer as well as submitting it, so the prompt
  // that is being built is the one on screen while the create is pending.
  function handleSuggestion(value: string) {
    setPrompt(value)
    handleSubmit(value)
  }

  return (
    <>
      <ChatComposer
        value={prompt}
        onValueChange={setPrompt}
        onSubmit={handleSubmit}
        modelId={modelId}
        onModelChange={setModelId}
        disabled={isPending}
      />
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.label}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full font-normal text-muted-foreground"
            disabled={isPending}
            onClick={() => handleSuggestion(suggestion.prompt)}
          >
            <suggestion.icon />
            {suggestion.label}
          </Button>
        ))}
      </div>
    </>
  )
}