import * as Sentry from "@sentry/node";
import { tasks } from "@trigger.dev/sdk";

// Auto-loaded by Trigger.dev before any task runs.
Sentry.init({
  // Trigger.dev ships its own OpenTelemetry setup; Sentry's default
  // integrations would fight it for the global tracer.
  defaultIntegrations: false,
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV === "production" ? "production" : "development",
});

tasks.onFailure(async ({ payload, error, ctx }) => {
  Sentry.captureException(error, {
    tags: {
      runtime: "trigger.dev",
      task: ctx.task.id,
      trigger_env: ctx.environment.slug,
    },
    extra: { payload, ctx },
  });
  // The worker may be suspended right after the run ends, so send now.
  await Sentry.flush(2000);
});
