import { createServer } from "node:http";

import app from "./app";
import { env } from "./config/env";
import { prisma } from "./database/prisma";
import { createLogger } from "./observability/logger";

const logger = createLogger("server");

const isProduction = env.NODE_ENV === "production";

/**
 * Startup database readiness probe (Phase 4.9).
 *
 * A production server must never listen while it cannot reach its database:
 * every request would fail while monitoring shows a healthy process. The probe
 * fails fast with a non-zero exit so the orchestrator restarts/reports the
 * failure. A bounded grace window (60s, production only) tolerates normal
 * orchestrator startup races (e.g. the app becoming ready before a managed
 * database endpoint); it is not a retry loop.
 */
async function assertDatabaseReady(): Promise<void> {
  if (!isProduction) {
    return; // dev/test tolerate the database coming up later
  }

  const deadlineMs = 60_000;
  const attemptIntervalMs = 2_000;
  const startedAt = Date.now();

  for (;;) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info("database_ready", { waitedMs: Date.now() - startedAt });
      return;
    } catch (error) {
      const waitedMs = Date.now() - startedAt;
      if (waitedMs >= deadlineMs) {
        logger.error("database_unreachable_at_startup", {
          waitedMs,
          // Category only — never the connection string or credentials.
          errorName: error instanceof Error ? error.name : "Unknown"
        });
        console.error(
          "Database is unreachable at startup. Fix DATABASE_URL / database availability, then start the server again."
        );
        await prisma.$disconnect();
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, attemptIntervalMs));
    }
  }
}

const server = createServer(app);

void assertDatabaseReady().then(() => {
  server.listen(env.PORT, () => {
    logger.info("server_started", { port: env.PORT, nodeEnv: env.NODE_ENV });
  });
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("server_shutdown_started", { signal });
  server.close(() => {
    logger.info("http_server_closed");
  });
  try {
    await prisma.$disconnect();
    logger.info("database_connections_closed");
    process.exit(0);
  } catch (error) {
    logger.error("server_shutdown_failed", { errorMessage: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));