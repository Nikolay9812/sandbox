import { auth } from "@clerk/nextjs/server"

import { ChatThread } from "@/components/chat-thread"
import { unauthorized } from "next/navigation"

export default async function GamePage() {
  await auth.protect({ unauthorizedUrl: "/sign-in"})

  return <ChatThread />
}