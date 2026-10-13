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

tasks.onStartAttempt(({ ctx }) => {
  // A worker process runs one run at a time, so the global scope is this run's
  // scope: every log emitted below it can be filtered back to the run.
  Sentry.getGlobalScope().setAttributes({
    "trigger.task.id": ctx.task.id,
    "trigger.run.id": ctx.run.id,
    "trigger.attempt": ctx.attempt.number,
    "trigger.env": ctx.environment.slug,
  });

  // The first attempt is routine; a later one means the previous one threw and
  // is the only trace of that between the failure and the final outcome.
  if (ctx.attempt.number > 1) {
    Sentry.logger.warn("Task attempt retrying", {
      "trigger.task.id": ctx.task.id,
      "trigger.run.id": ctx.run.id,
      "trigger.attempt": ctx.attempt.number,
    });
  }
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

// Logs are buffered, and a chat agent suspends between turns: without a flush
// here, a turn's logs sit in a snapshotted process until the next message —
// or are lost, if there never is one.
tasks.onWait(async () => {
  await Sentry.flush(2000);
});

tasks.onComplete(async () => {
  await Sentry.flush(2000);
});
