import { createIdGenerator } from "ai"

// Ids for messages that are persisted without ever passing through the
// client: the opening prompt a game is created with, and the assistant
// replies the chat agent streams back.
export const generateMessageId = createIdGenerator({ prefix: "msg", size: 16 })
