import { ArrowUpIcon, ChevronDownIcon, GripIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"

const models = ["Kimi K3", "Claude Opus 5", "GPT-5", "Gemini 3 Pro"]

type ChatComposerProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  disabled?: boolean
}

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  disabled,
}: ChatComposerProps) {
  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault()

        const prompt = value.trim()

        if (!prompt || disabled) {
          return
        }

        onSubmit(prompt)
      }}
    >
      <InputGroup className="bg-popover">
        <InputGroupTextarea
          name="prompt"
          required
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Describe the game you want to build…"
          rows={1}
          className="field-sizing-content max-h-48 min-h-10"
        />
        <InputGroupAddon align="block-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <InputGroupButton>
                  <GripIcon />
                  Kimi K3
                  <ChevronDownIcon />
                </InputGroupButton>
              }
            />
            <DropdownMenuContent className="w-auto">
              {models.map((model) => (
                <DropdownMenuItem key={model}>{model}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="submit"
            size="icon-lg"
            disabled={disabled || !value.trim()}
            className="ml-auto rounded-full"
          >
            <ArrowUpIcon />
          </Button>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
