/**
 * Standalone server entrypoint. Run with: npm run serve
 *
 * Reads config from environment variables and starts a Fastify server.
 * Also used as the background daemon entry (see src/daemon.ts).
 */

import { createServer } from './index.js';

const port = Number(process.env.API_PORT ?? 8000);
const host = process.env.API_HOST ?? '0.0.0.0';

const app = await createServer();
app.listen({ port, host })
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(`Vision Skills server listening on ${address}`);
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down gracefully`);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
