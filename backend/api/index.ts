/**
 * Vercel serverless entry point.
 *
 * Wraps the existing Express app (src/app.ts) in a Node request handler —
 * no new middleware, no behavior change. The long-running server entry
 * (src/server.ts) remains the production path for VM/container hosting;
 * this file exists only so the same app can be served from Vercel Functions.
 *
 * Note: `import type` is erased at build time, so the missing @vercel/node
 * dev dependency is intentional and harmless (it exists on the Vercel build
 * runners). This directory is excluded from the backend tsconfig build.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

import app from "../src/app";

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    app(request as never, response as never, (result?: unknown) => {
      if (result instanceof Error) {
        reject(result);
        return;
      }
      resolve();
    });
  });
}
