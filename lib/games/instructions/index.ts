import { runtime } from "@/lib/games/instructions/runtime"
import { workflow } from "@/lib/games/instructions/workflow"

/**
 * The game agent's instructions, in the order the system prompt presents them:
 * who the agent is and how it works first, then the environment it works in.
 */
export const gameInstructions = [workflow, runtime]
