/**
 * Standalone server entrypoint. Run with: npm run serve
 *
 * Reads config from environment variables and starts a Fastify server.
 */

import { createServer } from './index.js';

const port = Number(process.env.API_PORT ?? 8000);
const host = process.env.API_HOST ?? '0.0.0.0';

createServer()
  .then((app) => app.listen({ port, host }))
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(`Vision Skills server listening on ${address}`);
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
