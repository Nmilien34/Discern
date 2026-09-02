// Process entry: connect, serve, and shut down cleanly.

import { createApp } from "./app";
import { env } from "./config/env";
import {
  connectToDatabase,
  disconnectFromDatabase,
  syncIndexes,
} from "./db/connect";
import { buildInfo } from "./lib/build-info";
import { logger } from "./lib/logger";
// Registers every model with mongoose before syncIndexes() looks for them.
// Without this the index build silently finds nothing on a process that has not
// yet handled a request touching each collection.
import "./models";

async function main(): Promise<void> {
  // Asserts the resolved database name and refuses to start if it is wrong.
  await connectToDatabase();
  await syncIndexes();

  const app = createApp();
  const build = buildInfo("discern-api");

  const server = app.listen(env.PORT, () => {
    // No `service` here: it is a base field on the logger already.
    logger.info(
      {
        port: env.PORT,
        commit: build.commitShort,
        startedAt: build.startedAt,
        nodeEnv: build.nodeEnv,
      },
      "discern-api listening",
    );
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      void disconnectFromDatabase().finally(() => process.exit(0));
    });
    // Do not let a hung connection hold the process open past Render's window.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, "fatal startup error");
    process.exit(1);
  });
}
