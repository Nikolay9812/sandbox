import type { NextConfig } from "next"
import { withSentryConfig } from "@sentry/nextjs/config"

const nextConfig: NextConfig = { devIndicators: false }

export default withSentryConfig(nextConfig, {
  org: "codewithantonio-hg",
  project: "sandbox",

  // Source map upload token — set in CI / the hosting provider, never committed
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client source files for better stack trace resolution
  widenClientFileUpload: true,

  // Proxy browser events through the app to get past ad-blockers. Production
  // only: the tunnel is a rewrite Next relays itself, and in dev the listeners
  // it stacks on each relayed response trip Node's MaxListenersExceededWarning
  // on every envelope the browser sends.
  tunnelRoute:
    process.env.NODE_ENV === "development" ? undefined : "/monitoring",

  // Suppress non-CI output
  silent: !process.env.CI,
})
