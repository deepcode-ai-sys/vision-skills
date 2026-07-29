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
 *     -d '{"image": "https://example.com/img.jpg", "mode": "standard"}'
 */

import { createServer } from 'vision-skills/server';

async function main() {
  const app = await createServer({
    config: {
      geminiApiKey: process.env.GEMINI_API_KEY,
      // no key? use: useMockProviders: true
    },
  });

  const port = Number(process.env.PORT ?? 8000);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Vision Skills REST server on http://localhost:${port}`);
  console.log('Endpoints: POST /v1/analyze, GET /health, GET /v1/health/providers');
}

main().catch(console.error);
