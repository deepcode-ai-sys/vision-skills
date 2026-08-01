/**
 * Example: Run Vision Skills as a REST service.
 *
 * Useful when your app is NOT written in Node.js (Python, PHP, Go, mobile).
 * Start this server, then call POST /v1/analyze over HTTP.
 *
 * Requires fastify: npm install fastify
 * Run: GEMINI_API_KEY=... npx tsx examples/server.ts
 *
 * Then, from any language:
 *   curl -X POST http://localhost:8000/v1/analyze \
 *     -H "Content-Type: application/json" \
 *     -H "X-API-Key: $VSKILLS_API_KEY" \
 *     -d '{"image": "https://example.com/img.jpg", "mode": "standard"}'
 */

import { createServer } from 'vision-skills/server';

async function main() {
  const app = await createServer({
    apiKey: process.env.VSKILLS_API_KEY,
    config: {
      geminiApiKey: process.env.GEMINI_API_KEY,
      // no key? use: useMockProviders: true
    },
  });

  const port = Number(process.env.PORT ?? 8000);
  // Bind loopback by default. Use 0.0.0.0 only with an API key, TLS proxy,
  // infrastructure rate limiting, and an explicit deployment review.
  await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
  console.log(`Vision Skills REST server on http://localhost:${port}`);
  console.log('Endpoints: GET /health, GET /ready, POST /v1/analyze, GET /v1/health/providers, GET /v1/cache/stats, DELETE /v1/cache');
}

main().catch(console.error);
