"use client"

import { EllipsisIcon, PencilIcon, Trash2Icon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useState, useTransition } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { deleteGame, renameGame } from "@/lib/games/actions"

/**
 * A game's actions: rename and delete, each confirmed in a dialog of its own.
 * Used by the game page's header and by each game in the sidebar, which pass
 * their own trigger and placement.
 *
 * The dialogs are siblings of the menu rather than nested in its items, so
 * they outlive the menu closing when an item is picked.
 */
export function GameMenu({
  gameId,
  title,
  trigger = (
    <Button variant="ghost" size="icon-sm">
      <EllipsisIcon />
    </Button>
  ),
  side,
  align = "end",
}: {
  gameId: string
  title: string
  trigger?: React.ReactElement
} & Pick<React.ComponentProps<typeof DropdownMenuContent>, "side" | "align">) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} aria-label="Game options" />
        <DropdownMenuContent side={side} align={align} className="w-40">
          <DropdownMenuItem onClick={() => setDialog("rename")}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDialog("delete")}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameGameDialog
        gameId={gameId}
        title={title}
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
      />
      <DeleteGameDialog
        gameId={gameId}
        title={title}
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
      />
    </>
  )
}

// Matches the cap `renameGame` truncates to, so the field never accepts a
// title the server would then cut short.
const TITLE_MAX_LENGTH = 80

function RenameGameDialog({
  gameId,
  title,
  open,
  onOpenChange,
}: {
  gameId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [value, setValue] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const trimmed = value.trim()

  function handleOpenChange(next: boolean) {
    // Each opening starts from the current title, not whatever was typed and
    // abandoned last time.
    if (next) {
      setValue(title)
      setError(null)
    }

    onOpenChange(next)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!trimmed || trimmed === title) {
      onOpenChange(false)
      return
    }

    startTransition(async () => {
      try {
        await renameGame(gameId, trimmed)
        onOpenChange(false)
      } catch {
        // Next replaces a server action's error message in production, so
        // there is nothing more specific worth passing on.
        setError("Couldn't rename the game. Try again.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename game</DialogTitle>
            <DialogDescription>
              The new name shows here and in your recents.
            </DialogDescription>
          </DialogHeader>
          <Field data-disabled={isPending}>
            <FieldLabel htmlFor="game-title" className="sr-only">
              Title
            </FieldLabel>
            <Input
              id="game-title"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={TITLE_MAX_LENGTH}
              disabled={isPending}
              autoFocus
              autoComplete="off"
              aria-invalid={error !== null}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={isPending} />}
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isPending || !trimmed}>
              {isPending && <Spinner />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteGameDialog({
  gameId,
  title,
  open,
  onOpenChange,
}: {
  gameId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const pathname = usePathname()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleOpenChange(next: boolean) {
    // Closing mid-delete would only hide an outcome that is coming anyway.
    if (isPending) {
      return
    }

    if (next) {
      setError(null)
    }

    onOpenChange(next)
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        // Either way the dialog stays open and pending until it disappears
        // with what it was opened from: the page, which the action redirects
        // away from, or the sidebar entry, which its refresh drops.
        await deleteGame(gameId, pathname === `/games/${gameId}`)
      } catch {
        setError("Couldn't delete the game. Try again.")
      }
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete game?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{title}</span> and its
            chat will be deleted for everyone in your organization, along with
            the sandbox it was built in. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
          >
            {isPending && <Spinner />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
