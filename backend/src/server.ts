import { createServer } from "node:http";

import app from "./app";
import { env } from "./config/env";
import { prisma } from "./database/prisma";

const server = createServer(app);

server.listen(env.PORT, () => {
  console.log(`OncoEasy backend listening on port ${env.PORT}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
  });
  try {
    await prisma.$disconnect();
    console.log("Database connections closed.");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));