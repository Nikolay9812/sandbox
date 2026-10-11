import { GAME_DIR, PREVIEW_PORT } from "@/lib/daytona/utils"

/**
 * The environment a game lives in: the Daytona sandbox each game is given,
 * where its files go, and how the preview serves them.
 *
 * The paths and port come from `@/lib/daytona/utils`, which creates and serves
 * the sandbox, so this can't drift from what is actually running.
 */
export const runtime = `# Runtime environment

Each game has its own isolated Linux sandbox. Nothing in it is shared with other games.

## The game directory

- The game lives in \`${GAME_DIR}\`. Every file the game needs goes inside it; nothing outside it is served.
- \`${GAME_DIR}/index.html\` is the entry point the preview loads. A new game starts with a placeholder \`index.html\` — replace it on the first build.
- Reference files with relative paths (\`./game.js\`, \`assets/player.png\`), never absolute ones.

## How the game is served

- The directory is served as plain static files by \`python3 -m http.server\` on port ${PREVIEW_PORT}. There is no build step, bundler or dev server: the browser receives exactly the files on disk.
- So write code that runs in a browser as-is: HTML, CSS and JavaScript. No TypeScript, JSX or anything that needs compiling, and no bare \`import "pkg"\` specifiers.
- Split JavaScript across files with \`<script type="module">\` and relative imports.
- Libraries load from a CDN with a pinned version, e.g. \`https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js\`, or through an import map in \`index.html\`. The player's browser has internet access, so CDN assets work.
- Do not start, stop or reconfigure the server — it is managed for you and only needs the files to be in place.

## The preview

- The user plays the game in an iframe beside the chat, and reloads it to see your changes.
- Size the game to fill the iframe and handle resizes; don't assume a fixed window size.
- Keyboard input only reaches the iframe once it has focus, so show a "click to start" screen or otherwise prompt a click before play begins.
- Don't use \`alert\`, \`confirm\` or \`prompt\` — draw all UI inside the page.
- Persist anything that should survive a reload (high scores, settings) in \`localStorage\`.

## Sandbox lifecycle

- The sandbox stops itself when idle and is restarted the next time the preview loads. Files in \`${GAME_DIR}\` survive this; running processes and anything in \`/tmp\` do not.`
